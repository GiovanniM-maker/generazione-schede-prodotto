'use server';

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  parseCsv,
  parseXlsx,
  extractSkuFromFilename,
  SKU_DELIMITERS,
  type SkuDelimiter,
  suggestImageType,
  isSupportedImage,
  validateRowSku,
  suggestSkuHeader,
  analyzeSources,
  computeQuality,
  NON_ADDITIONAL_FIELDS,
  extractProductFromHtml,
  type ParseResult,
  type SourceAnalysis,
  type BuiltProduct,
} from '@app/core';
import { STORAGE_BUCKETS } from '@app/config';
import type { Json } from '@app/database';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';
import { safeFetch } from '@/lib/safe-fetch';

// ---------------------------------------------------------------------------
// Server actions del wizard "Nuovo batch" v2 (modello preset v2 + pipeline SKU).
// Ogni action verifica l'appartenenza e ritorna { ok, ... } senza mai lanciare.
// L'import popola sia le righe product_attribute_values (nuovo modello) sia
// products.canonical_attributes_json (bridge attributeKey→valore) affinché la
// pipeline di generazione esistente continui a funzionare senza modifiche.
// ---------------------------------------------------------------------------

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

/** Tipi sorgente riconosciuti dal wizard. */
export type WizardSourceType = 'spreadsheet' | 'images';

const SPREADSHEET_SOURCE = 'spreadsheet_upload';
const IMAGE_SOURCE = 'images_upload';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

// ---------------------------------------------------------------------------
// 1) Elenco preset pubblicati.
// ---------------------------------------------------------------------------

export interface PublishedPresetSummary {
  id: string;
  name: string;
  sectorName: string;
  versionId: string;
  categoriesCount: number;
  attributesCount: number;
}

export async function listPublishedPresets(): Promise<ActionResult<PublishedPresetSummary[]>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Organizzazione non trovata');

  const service = getServiceClient();

  const { data: presets, error } = await service
    .from('presets')
    .select('id, name, sector_id, active_version_id')
    .eq('organization_id', org.organizationId)
    .not('active_version_id', 'is', null);
  if (error) return fail(`Lettura preset fallita: ${error.message}`);

  const versionIds = (presets ?? [])
    .map((p) => p.active_version_id)
    .filter((v): v is string => Boolean(v));
  if (versionIds.length === 0) return ok([]);

  const [{ data: versions }, { data: sectors }, { data: cats }, { data: attrs }] = await Promise.all([
    service.from('preset_versions').select('id, published_at').in('id', versionIds),
    service.from('sectors').select('id, name'),
    service.from('preset_categories').select('preset_version_id, enabled').in('preset_version_id', versionIds),
    service.from('preset_attributes').select('preset_version_id, enabled').in('preset_version_id', versionIds),
  ]);

  const publishedVersions = new Set(
    (versions ?? []).filter((v) => v.published_at !== null).map((v) => v.id),
  );
  const sectorName = new Map((sectors ?? []).map((s) => [s.id, s.name]));
  const catCount = new Map<string, number>();
  for (const c of cats ?? []) {
    if (c.enabled === false) continue;
    catCount.set(c.preset_version_id, (catCount.get(c.preset_version_id) ?? 0) + 1);
  }
  const attrCount = new Map<string, number>();
  for (const a of attrs ?? []) {
    if (a.enabled === false) continue;
    attrCount.set(a.preset_version_id, (attrCount.get(a.preset_version_id) ?? 0) + 1);
  }

  const result: PublishedPresetSummary[] = [];
  for (const p of presets ?? []) {
    const vId = p.active_version_id;
    if (!vId || !publishedVersions.has(vId)) continue;
    result.push({
      id: p.id,
      name: p.name,
      sectorName: sectorName.get(p.sector_id) ?? 'Settore',
      versionId: vId,
      categoriesCount: catCount.get(vId) ?? 0,
      attributesCount: attrCount.get(vId) ?? 0,
    });
  }
  return ok(result);
}

// ---------------------------------------------------------------------------
// 2) Creazione batch v2.
// ---------------------------------------------------------------------------

export async function createBatchV2(input: {
  name: string;
  description?: string;
  presetId: string;
}): Promise<ActionResult<{ batchId: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Organizzazione non trovata');

  const name = input.name.trim();
  if (name === '') return fail('Il nome del batch è obbligatorio');
  if (!input.presetId) return fail('Seleziona un preset');

  const service = getServiceClient();
  const { data: preset } = await service
    .from('presets')
    .select('id, organization_id, active_version_id')
    .eq('id', input.presetId)
    .maybeSingle();
  if (!preset || preset.organization_id !== org.organizationId) {
    return fail('Preset non accessibile');
  }
  if (!preset.active_version_id) return fail('Il preset non ha una versione pubblicata');

  const { data, error } = await service
    .from('batches')
    .insert({
      organization_id: org.organizationId,
      name,
      status: 'draft',
      preset_version_id: preset.active_version_id,
    })
    .select('id')
    .single();
  if (error || !data) return fail(`Creazione batch fallita: ${error?.message}`);

  await service.from('app_events').insert({
    organization_id: org.organizationId,
    user_id: user.id,
    event_name: 'batch_created',
    batch_id: data.id,
    metadata_json: { presetId: input.presetId, description: input.description ?? null },
  });

  return ok({ batchId: data.id });
}

// ---------------------------------------------------------------------------
// 3) Esploratore preset.
// ---------------------------------------------------------------------------

export interface PresetExplorerAttribute {
  id: string;
  name: string;
  dataType: string;
  isRequired: boolean;
  extractionInstruction: string | null;
  generationInstruction: string | null;
}
export interface PresetExplorerCategory {
  id: string;
  name: string;
  attributes: PresetExplorerAttribute[];
}
export interface PresetExplorer {
  sectorName: string;
  categories: PresetExplorerCategory[];
}

export async function getPresetExplorer(input: {
  presetVersionId: string;
}): Promise<ActionResult<PresetExplorer>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Organizzazione non trovata');

  const service = getServiceClient();

  const { data: version } = await service
    .from('preset_versions')
    .select('id, preset_id')
    .eq('id', input.presetVersionId)
    .maybeSingle();
  if (!version) return fail('Versione preset non trovata');

  const { data: preset } = await service
    .from('presets')
    .select('id, organization_id, sector_id')
    .eq('id', version.preset_id)
    .maybeSingle();
  if (!preset || preset.organization_id !== org.organizationId) {
    return fail('Preset non accessibile');
  }

  const [{ data: sector }, { data: presetCats }, { data: presetAttrs }] = await Promise.all([
    service.from('sectors').select('id, name').eq('id', preset.sector_id).maybeSingle(),
    service
      .from('preset_categories')
      .select('category_id, display_order, enabled')
      .eq('preset_version_id', input.presetVersionId),
    service
      .from('preset_attributes')
      .select(
        'attribute_id, category_id, is_required, display_order, enabled, extraction_instruction_override, generation_instruction_override',
      )
      .eq('preset_version_id', input.presetVersionId),
  ]);

  const categoryIds = (presetCats ?? []).map((c) => c.category_id);
  const attributeIds = (presetAttrs ?? []).map((a) => a.attribute_id);

  const [{ data: categories }, { data: attributes }] = await Promise.all([
    categoryIds.length
      ? service.from('categories').select('id, name').in('id', categoryIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    attributeIds.length
      ? service
          .from('attributes')
          .select('id, name, data_type, default_extraction_instruction, default_generation_instruction')
          .in('id', attributeIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            data_type: string;
            default_extraction_instruction: string | null;
            default_generation_instruction: string | null;
          }[],
        }),
  ]);

  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const attrById = new Map((attributes ?? []).map((a) => [a.id, a]));

  const catOrder = new Map((presetCats ?? []).map((c) => [c.category_id, c.display_order]));
  const orderedCatIds = [...(presetCats ?? [])]
    .filter((c) => c.enabled !== false)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((c) => c.category_id);

  const groups = new Map<string, PresetExplorerAttribute[]>();
  const OTHER = '__other__';
  for (const pa of [...(presetAttrs ?? [])]
    .filter((a) => a.enabled !== false)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))) {
    const attr = attrById.get(pa.attribute_id);
    if (!attr) continue;
    const key = pa.category_id && catName.has(pa.category_id) ? pa.category_id : OTHER;
    const entry: PresetExplorerAttribute = {
      id: attr.id,
      name: attr.name,
      dataType: attr.data_type,
      isRequired: pa.is_required,
      extractionInstruction: pa.extraction_instruction_override ?? attr.default_extraction_instruction,
      generationInstruction: pa.generation_instruction_override ?? attr.default_generation_instruction,
    };
    const arr = groups.get(key);
    if (arr) arr.push(entry);
    else groups.set(key, [entry]);
  }

  const outCategories: PresetExplorerCategory[] = [];
  for (const cid of orderedCatIds) {
    const attrs = groups.get(cid);
    if (!attrs || attrs.length === 0) continue;
    outCategories.push({ id: cid, name: catName.get(cid) ?? 'Categoria', attributes: attrs });
  }
  // Categorie eventualmente non elencate in preset_categories ma con attributi.
  for (const [cid, attrs] of groups) {
    if (cid === OTHER) continue;
    if (orderedCatIds.includes(cid)) continue;
    outCategories.push({ id: cid, name: catName.get(cid) ?? 'Categoria', attributes: attrs });
  }
  const other = groups.get(OTHER);
  if (other && other.length > 0) {
    outCategories.push({ id: OTHER, name: 'Altri attributi', attributes: other });
  }
  void catOrder;

  return ok({ sectorName: sector?.name ?? 'Settore', categories: outCategories });
}

// ---------------------------------------------------------------------------
// 4) Selezione sorgenti.
// ---------------------------------------------------------------------------

async function getOrCreateBatchSource(
  service: ReturnType<typeof getServiceClient>,
  orgId: string,
  batchId: string,
  sourceType: string,
): Promise<string | null> {
  const { data: existing } = await service
    .from('batch_sources')
    .select('id')
    .eq('batch_id', batchId)
    .eq('source_type', sourceType)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await service
    .from('batch_sources')
    .insert({
      organization_id: orgId,
      batch_id: batchId,
      source_type: sourceType,
      status: 'pending',
      configuration_json: {},
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('getOrCreateBatchSource insert failed', { sourceType, error: error?.message });
    return null;
  }
  return data.id;
}

export async function setBatchSources(input: {
  batchId: string;
  sourceTypes: WizardSourceType[];
}): Promise<ActionResult<{ sourceType: string }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');

  const wantSpreadsheet = input.sourceTypes.includes('spreadsheet');
  const wantImages = input.sourceTypes.includes('images');
  if (!wantSpreadsheet && !wantImages) return fail('Seleziona almeno una fonte');

  const service = getServiceClient();

  if (wantSpreadsheet) await getOrCreateBatchSource(service, orgId, input.batchId, SPREADSHEET_SOURCE);
  if (wantImages) await getOrCreateBatchSource(service, orgId, input.batchId, IMAGE_SOURCE);

  const sourceType = wantSpreadsheet && wantImages ? 'mixed' : wantSpreadsheet ? 'spreadsheet' : 'images';
  await service.from('batches').update({ source_type: sourceType, status: 'sources_selected' }).eq('id', input.batchId);

  return ok({ sourceType });
}

// ---------------------------------------------------------------------------
// 5) Upload file.
// ---------------------------------------------------------------------------

export interface UploadedFileSummary {
  filename: string;
  sku: string | null;
  status: string;
  problem: string | null;
}
export interface UploadSpreadsheetResult {
  kind: 'spreadsheet';
  headers: string[];
  previewRows: Array<Record<string, string>>;
  suggestedSkuHeader: string | null;
  totalRows: number;
  file: UploadedFileSummary;
}
export interface UploadImagesResult {
  kind: 'images';
  files: UploadedFileSummary[];
  validCount: number;
  invalidCount: number;
}

async function persistSourceFile(
  service: ReturnType<typeof getServiceClient>,
  orgId: string,
  batchId: string,
  bucket: string,
  file: File,
  buffer: Buffer,
  ext: string,
): Promise<{ id: string } | { error: string }> {
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const path = `${orgId}/${batchId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
  const { error: upErr } = await service.storage.from(bucket).upload(path, buffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) return { error: `Upload fallito: ${upErr.message}` };
  const { data: sf, error: sfErr } = await service
    .from('source_files')
    .insert({
      organization_id: orgId,
      batch_id: batchId,
      storage_bucket: bucket,
      storage_path: path,
      original_filename: file.name,
      mime_type: file.type || (ext === '.csv' ? 'text/csv' : 'application/octet-stream'),
      size_bytes: buffer.byteLength,
      sha256,
      status: 'ready',
    })
    .select('id')
    .single();
  if (sfErr || !sf) return { error: `Registrazione file fallita: ${sfErr?.message}` };
  return { id: sf.id };
}

export async function uploadBatchFiles(
  formData: FormData,
): Promise<ActionResult<UploadSpreadsheetResult | UploadImagesResult>> {
  const batchId = String(formData.get('batchId') ?? '');
  const sourceType = String(formData.get('sourceType') ?? '');
  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return fail('Batch non accessibile');

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return fail('Nessun file caricato');

  // Limiti anti-abuso / robustezza: dimensione per file e numero di file.
  const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
  const MAX_IMAGES_PER_UPLOAD = 200;
  const MAX_ROWS = 50_000;
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) return fail(`File troppo grande: ${tooBig.name} (massimo 20 MB per file).`);
  if (sourceType === 'images' && files.length > MAX_IMAGES_PER_UPLOAD) {
    return fail(`Troppe immagini in un solo caricamento (massimo ${MAX_IMAGES_PER_UPLOAD}). Caricale a blocchi.`);
  }

  const service = getServiceClient();

  // ----- Spreadsheet -----
  if (sourceType === 'spreadsheet') {
    const file = files[0]!;
    const ext = extname(file.name).toLowerCase();
    if (ext !== '.csv' && ext !== '.xlsx') {
      return fail('Formato non supportato: usa CSV o XLSX');
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const persisted = await persistSourceFile(service, orgId, batchId, STORAGE_BUCKETS.sourceFiles, file, buffer, ext);
    if ('error' in persisted) return fail(persisted.error);

    let parsed: ParseResult;
    try {
      parsed = ext === '.csv' ? parseCsv(buffer) : await parseXlsx(buffer);
    } catch (e) {
      return fail(`Lettura file fallita: ${e instanceof Error ? e.message : 'errore'}`);
    }
    if (parsed.rows.length > MAX_ROWS) {
      return fail(`Troppe righe (${parsed.rows.length}). Massimo ${MAX_ROWS} per file: dividi il catalogo.`);
    }

    const batchSourceId = await getOrCreateBatchSource(service, orgId, batchId, SPREADSHEET_SOURCE);
    if (!batchSourceId) return fail('Registrazione sorgente fallita');

    // Rimpiazza eventuali item precedenti dello spreadsheet (re-upload).
    await service.from('source_items').delete().eq('batch_source_id', batchSourceId);
    await service.from('source_items').insert({
      organization_id: orgId,
      batch_source_id: batchSourceId,
      source_file_id: persisted.id,
      filename: file.name,
      mime_type: file.type || null,
      size_bytes: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      detected_sku: null,
      status: 'ready',
      metadata_json: { headers: parsed.headers, rowCount: parsed.rows.length } as unknown as Json,
    });
    await service.from('batch_sources').update({ status: 'ready' }).eq('id', batchSourceId);

    return ok<UploadSpreadsheetResult>({
      kind: 'spreadsheet',
      headers: parsed.headers,
      previewRows: parsed.rows.slice(0, 100),
      suggestedSkuHeader: suggestSkuHeader(parsed.headers),
      totalRows: parsed.rows.length,
      file: {
        filename: file.name,
        sku: null,
        status: 'ready',
        problem: parsed.rows.length === 0 ? 'Nessuna riga dati rilevata' : null,
      },
    });
  }

  // ----- Immagini -----
  if (sourceType === 'images') {
    const batchSourceId = await getOrCreateBatchSource(service, orgId, batchId, IMAGE_SOURCE);
    if (!batchSourceId) return fail('Registrazione sorgente fallita');

    const summaries: UploadedFileSummary[] = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const file of files) {
      const ext = extname(file.name).toLowerCase();

      // .zip: estrazione non ancora disponibile.
      if (ext === '.zip') {
        summaries.push({
          filename: file.name,
          sku: null,
          status: 'in_arrivo',
          problem: 'Estrazione ZIP in arrivo: carica le immagini singolarmente',
        });
        invalidCount++;
        continue;
      }

      if (!isSupportedImage(file.name)) {
        summaries.push({
          filename: file.name,
          sku: null,
          status: 'formato_non_supportato',
          problem: 'Formato immagine non supportato (usa jpg, jpeg, png, webp)',
        });
        invalidCount++;
        continue;
      }

      const sku = extractSkuFromFilename(file.name);
      const buffer = Buffer.from(await file.arrayBuffer());
      const persisted = await persistSourceFile(
        service,
        orgId,
        batchId,
        STORAGE_BUCKETS.productAssets,
        file,
        buffer,
        ext,
      );
      if ('error' in persisted) {
        summaries.push({ filename: file.name, sku, status: 'errore', problem: persisted.error });
        invalidCount++;
        continue;
      }

      const status = sku ? 'valid' : 'missing_sku';
      await service.from('source_items').insert({
        organization_id: orgId,
        batch_source_id: batchSourceId,
        source_file_id: persisted.id,
        filename: file.name,
        mime_type: file.type || null,
        size_bytes: buffer.byteLength,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        detected_sku: sku,
        status,
        metadata_json: { imageType: suggestImageType(file.name) } as unknown as Json,
      });

      if (sku) validCount++;
      else invalidCount++;
      summaries.push({
        filename: file.name,
        sku,
        status,
        problem: sku ? null : 'SKU assente nel nome file: rinomina come {SKU}_descrizione.jpg',
      });
    }

    await service.from('batch_sources').update({ status: 'ready' }).eq('id', batchSourceId);

    return ok<UploadImagesResult>({ kind: 'images', files: summaries, validCount, invalidCount });
  }

  return fail('Tipo sorgente non valido');
}

// ---------------------------------------------------------------------------
// UPLOAD IMMAGINI VELOCE: upload diretto client→storage con URL firmati, in
// parallelo. Evita di far passare i byte dal server (limite 25MB) e la lentezza
// del loop sequenziale. Flusso:
//   1) createImageUploadTargets → URL firmati + validazione nome/SKU
//   2) il client carica i file in parallelo direttamente su storage
//   3) registerUploadedImages → registra i metadati (source_files/source_items)
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES_BATCH = 400;

export interface ImageUploadTarget {
  name: string;
  valid: boolean;
  problem: string | null;
  sku: string | null;
  bucket: string;
  path: string | null;
  token: string | null;
}

export async function createImageUploadTargets(input: {
  batchId: string;
  files: { name: string; size: number; type: string }[];
}): Promise<ActionResult<{ targets: ImageUploadTarget[] }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  if (input.files.length === 0) return fail('Nessun file');
  if (input.files.length > MAX_IMAGES_BATCH) {
    return fail(`Troppe immagini in un solo caricamento (max ${MAX_IMAGES_BATCH}).`);
  }
  const service = getServiceClient();
  const bucket = STORAGE_BUCKETS.productAssets;

  const targets = await Promise.all(
    input.files.map(async (f): Promise<ImageUploadTarget> => {
      if (f.size > MAX_IMAGE_BYTES) {
        return { name: f.name, valid: false, problem: 'File troppo grande (max 20 MB)', sku: null, bucket, path: null, token: null };
      }
      if (!isSupportedImage(f.name)) {
        return { name: f.name, valid: false, problem: 'Formato non supportato (jpg, png, webp)', sku: null, bucket, path: null, token: null };
      }
      const sku = extractSkuFromFilename(f.name);
      const path = `${orgId}/${input.batchId}/${crypto.randomUUID()}-${sanitizeFilename(f.name)}`;
      const { data: signed, error } = await service.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !signed) {
        return { name: f.name, valid: false, problem: 'Preparazione upload fallita', sku, bucket, path: null, token: null };
      }
      return {
        name: f.name,
        valid: true,
        problem: sku ? null : 'SKU assente nel nome file: rinomina come {SKU}_descrizione.jpg',
        sku,
        bucket,
        path: signed.path,
        token: signed.token,
      };
    }),
  );

  return ok({ targets });
}

export async function registerUploadedImages(input: {
  batchId: string;
  items: { name: string; path: string; size: number; type: string; sha256?: string; sku: string | null }[];
}): Promise<ActionResult<UploadImagesResult>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  if (input.items.length === 0) return ok({ kind: 'images', files: [], validCount: 0, invalidCount: 0 });
  const service = getServiceClient();
  const bucket = STORAGE_BUCKETS.productAssets;
  const batchSourceId = await getOrCreateBatchSource(service, orgId, input.batchId, IMAGE_SOURCE);
  if (!batchSourceId) return fail('Registrazione sorgente fallita');

  // Inserimento in blocco dei source_files (2 query totali, non N).
  const { data: files, error: sfErr } = await service
    .from('source_files')
    .insert(
      input.items.map((it) => ({
        organization_id: orgId,
        batch_id: input.batchId,
        storage_bucket: bucket,
        storage_path: it.path,
        original_filename: it.name,
        // Colonne NOT NULL: garantiamo sempre un valore (il client li fornisce,
        // ma teniamo un fallback difensivo lato server).
        mime_type: it.type && it.type.trim() ? it.type : 'application/octet-stream',
        sha256: it.sha256 && it.sha256.trim() ? it.sha256 : 'unknown',
        size_bytes: it.size,
        status: 'ready',
      })),
    )
    .select('id, storage_path');
  if (sfErr) return fail(`Registrazione file fallita: ${sfErr.message}`);
  const idByPath = new Map((files ?? []).map((f) => [f.storage_path, f.id] as const));

  let validCount = 0;
  let invalidCount = 0;
  const summaries: UploadedFileSummary[] = [];
  const itemRows = input.items
    .map((it) => {
      const sourceFileId = idByPath.get(it.path);
      if (!sourceFileId) return null;
      const status = it.sku ? 'valid' : 'missing_sku';
      if (it.sku) validCount++;
      else invalidCount++;
      summaries.push({
        filename: it.name,
        sku: it.sku,
        status,
        problem: it.sku ? null : 'SKU assente nel nome file: rinomina come {SKU}_descrizione.jpg',
      });
      return {
        organization_id: orgId,
        batch_source_id: batchSourceId,
        source_file_id: sourceFileId,
        filename: it.name,
        mime_type: it.type || undefined,
        size_bytes: it.size,
        detected_sku: it.sku,
        status,
        metadata_json: { imageType: suggestImageType(it.name) } as unknown as Json,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (itemRows.length > 0) {
    await service.from('source_items').insert(itemRows);
  }
  await service.from('batch_sources').update({ status: 'ready' }).eq('id', batchSourceId);

  return ok({ kind: 'images', files: summaries, validCount, invalidCount });
}

/**
 * Ri-estrae lo SKU dai nomi file delle immagini già caricate usando il
 * separatore scelto dall'utente (es. "-" per "100356-image_IT.jpg" → "100356").
 * Aggiorna detected_sku + status dei source_items. Va usata PRIMA della conferma
 * import (quando i prodotti non sono ancora creati).
 */
export async function reparseImageSkus(input: {
  batchId: string;
  delimiter: string;
}): Promise<ActionResult<UploadImagesResult>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();
  const items = await loadImageItems(service, input.batchId);
  if (items.length === 0) return ok({ kind: 'images', files: [], validCount: 0, invalidCount: 0 });

  const delimiter: SkuDelimiter | string = SKU_DELIMITERS.includes(input.delimiter as SkuDelimiter)
    ? input.delimiter
    : '_';

  let validCount = 0;
  let invalidCount = 0;
  const files: UploadedFileSummary[] = [];
  const updates = items.map((it) => {
    const sku = extractSkuFromFilename(it.filename, delimiter);
    const status = sku ? 'valid' : 'missing_sku';
    if (sku) validCount++;
    else invalidCount++;
    files.push({
      filename: it.filename,
      sku,
      status,
      problem: sku ? null : 'SKU non riconosciuto con questo separatore',
    });
    return { id: it.id, sku, status };
  });

  const CHUNK = 20;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await Promise.all(
      updates
        .slice(i, i + CHUNK)
        .map((u) =>
          service.from('source_items').update({ detected_sku: u.sku, status: u.status }).eq('id', u.id),
        ),
    );
  }

  return ok({ kind: 'images', files, validCount, invalidCount });
}

// ---------------------------------------------------------------------------
// Helper: carica e riparsa lo spreadsheet del batch.
// ---------------------------------------------------------------------------

interface LoadedSpreadsheet {
  parsed: ParseResult;
  sourceItemId: string;
  isCsv: boolean;
}

async function loadBatchSpreadsheet(
  service: ReturnType<typeof getServiceClient>,
  batchId: string,
): Promise<LoadedSpreadsheet | null> {
  const { data: bs } = await service
    .from('batch_sources')
    .select('id')
    .eq('batch_id', batchId)
    .eq('source_type', SPREADSHEET_SOURCE)
    .maybeSingle();
  if (!bs) return null;
  const { data: item } = await service
    .from('source_items')
    .select('id, source_file_id, filename')
    .eq('batch_source_id', bs.id)
    .maybeSingle();
  if (!item || !item.source_file_id) return null;
  const { data: sf } = await service
    .from('source_files')
    .select('storage_bucket, storage_path, original_filename')
    .eq('id', item.source_file_id)
    .maybeSingle();
  if (!sf) return null;
  const { data: blob, error } = await service.storage.from(sf.storage_bucket).download(sf.storage_path);
  if (error || !blob) return null;
  const buffer = Buffer.from(await blob.arrayBuffer());
  const isCsv = sf.original_filename.toLowerCase().endsWith('.csv');
  const parsed = isCsv ? parseCsv(buffer) : await parseXlsx(buffer);
  return { parsed, sourceItemId: item.id, isCsv };
}

async function loadImageItems(
  service: ReturnType<typeof getServiceClient>,
  batchId: string,
): Promise<Array<{ id: string; filename: string; detected_sku: string | null }>> {
  const { data: bs } = await service
    .from('batch_sources')
    .select('id')
    .eq('batch_id', batchId)
    .eq('source_type', IMAGE_SOURCE)
    .maybeSingle();
  if (!bs) return [];
  const { data: items } = await service
    .from('source_items')
    .select('id, filename, detected_sku')
    .eq('batch_source_id', bs.id);
  return items ?? [];
}

// ---------------------------------------------------------------------------
// 6) Analisi sorgenti.
// ---------------------------------------------------------------------------

export async function analyzeBatch(input: {
  batchId: string;
}): Promise<ActionResult<SourceAnalysis & { suggestedSkuHeader: string | null }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const spreadsheet = await loadBatchSpreadsheet(service, input.batchId);
  const imageItems = await loadImageItems(service, input.batchId);

  const fileSkus: string[] = [];
  let rowsWithoutSku = 0;
  let suggestedSkuHeader: string | null = null;
  if (spreadsheet) {
    suggestedSkuHeader = suggestSkuHeader(spreadsheet.parsed.headers);
    if (suggestedSkuHeader) {
      for (const row of spreadsheet.parsed.rows) {
        const sku = (row[suggestedSkuHeader] ?? '').trim();
        if (sku === '') rowsWithoutSku++;
        else fileSkus.push(sku);
      }
    } else {
      rowsWithoutSku = spreadsheet.parsed.rows.length;
    }
  }

  const imageSkus = imageItems.map((i) => i.detected_sku).filter((s): s is string => Boolean(s));
  const filesWithoutSku = imageItems.filter((i) => !i.detected_sku).map((i) => i.filename);

  const analysis = analyzeSources({ fileSkus, imageSkus, filesWithoutSku, rowsWithoutSku });
  await service.from('batches').update({ status: 'analysis' }).eq('id', input.batchId);

  return ok({ ...analysis, suggestedSkuHeader });
}

// ---------------------------------------------------------------------------
// Attributi del preset del batch (id + chiave + tipo) per mapping e bridge.
// ---------------------------------------------------------------------------

export interface PresetAttributeOption {
  id: string;
  key: string | null;
  name: string;
  dataType: string;
  isRequired: boolean;
}

async function loadPresetAttributes(
  service: ReturnType<typeof getServiceClient>,
  presetVersionId: string,
): Promise<PresetAttributeOption[]> {
  const { data: presetAttrs } = await service
    .from('preset_attributes')
    .select('attribute_id, is_required, display_order, enabled')
    .eq('preset_version_id', presetVersionId);
  const enabled = (presetAttrs ?? []).filter((a) => a.enabled !== false);
  const ids = enabled.map((a) => a.attribute_id);
  if (ids.length === 0) return [];
  const { data: attrs } = await service
    .from('attributes')
    .select('id, key, name, data_type')
    .in('id', ids);
  const attrById = new Map((attrs ?? []).map((a) => [a.id, a]));
  return enabled
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((pa) => {
      const attr = attrById.get(pa.attribute_id);
      return {
        id: pa.attribute_id,
        key: attr?.key ?? null,
        name: attr?.name ?? 'Attributo',
        dataType: attr?.data_type ?? 'text',
        isRequired: pa.is_required,
      };
    })
    .filter((a) => a.name !== undefined);
}

export async function getBatchPresetAttributes(input: {
  batchId: string;
}): Promise<ActionResult<{ attributes: PresetAttributeOption[]; headers: string[]; suggestedSkuHeader: string | null }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', input.batchId)
    .maybeSingle();
  if (!batch?.preset_version_id) return fail('Preset del batch non trovato');

  const attributes = await loadPresetAttributes(service, batch.preset_version_id);
  const spreadsheet = await loadBatchSpreadsheet(service, input.batchId);
  const headers = spreadsheet?.parsed.headers ?? [];
  return ok({ attributes, headers, suggestedSkuHeader: suggestSkuHeader(headers) });
}

// ---------------------------------------------------------------------------
// 7) Import definitivo.
// ---------------------------------------------------------------------------

/** Chiave canonica per il bridge: usa la chiave attributo se presente, altrimenti uno slug del nome. */
function canonicalKey(attr: PresetAttributeOption): string {
  if (attr.key && attr.key.trim() !== '') return attr.key;
  return attr.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface ImportResultV2 {
  imported: number;
  valid: number;
  invalid: number;
  imageOnly: number;
  /** Prodotti collegati a una categoria merceologica dell'organizzazione. */
  categoriesMatched: number;
  /** Nomi di categoria presenti nel file ma non riconosciuti (da creare). */
  unmatchedCategories: string[];
}

/** Normalizza un nome di categoria per il match (case/accenti/spazi). */
function normalizeCategoryName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Match ROBUSTO del valore categoria dal file verso le categorie del catalogo:
 * esatto \u2192 contenimento \u2192 sovrapposizione token. Evita che "Grocery " o
 * "Vini rossi" restino non collegati per una differenza minima.
 */
function makeCategoryMatcher(entries: Array<{ id: string; name: string }>) {
  const byNorm = new Map<string, string>();
  const toks = entries.map((e) => ({
    id: e.id,
    tokens: new Set(normalizeCategoryName(e.name).split(' ').filter(Boolean)),
  }));
  for (const e of entries) {
    const k = normalizeCategoryName(e.name);
    if (!byNorm.has(k)) byNorm.set(k, e.id);
  }
  return (raw: string): string | null => {
    const norm = normalizeCategoryName(raw);
    if (!norm) return null;
    const exact = byNorm.get(norm);
    if (exact) return exact;
    const valSet = new Set(norm.split(' ').filter(Boolean));
    let best: { id: string; score: number } | null = null;
    for (const c of toks) {
      if (c.tokens.size === 0) continue;
      const catNorm = [...c.tokens].join(' ');
      const contains = norm.includes(catNorm) || catNorm.includes(norm);
      let inter = 0;
      for (const t of valSet) if (c.tokens.has(t)) inter++;
      const union = new Set([...valSet, ...c.tokens]).size;
      const jaccard = union ? inter / union : 0;
      const score = (contains ? 0.5 : 0) + jaccard;
      if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
    }
    return best && best.score >= 0.5 ? best.id : null;
  };
}

export async function confirmImportV2(input: {
  batchId: string;
  skuHeader: string;
  attributeMapping: Record<string, string>; // attributeId -> header
  /** Colonna del file che contiene la categoria merceologica (opzionale). */
  categoryHeader?: string;
  /** Colonna del "codice padre": raggruppa le varianti (colore/taglia) di uno stesso prodotto. */
  parentHeader?: string;
  /** Colonne libere del file da importare come fatti (attributo creato al volo). */
  extraColumns?: Array<{ header: string; name: string }>;
  options: { includeImageOnly: boolean; excludeIncomplete: boolean };
}): Promise<ActionResult<ImportResultV2>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', input.batchId)
    .maybeSingle();
  const presetVersionId = batch?.preset_version_id ?? null;

  const attributes = presetVersionId ? await loadPresetAttributes(service, presetVersionId) : [];
  const attrById = new Map(attributes.map((a) => [a.id, a]));

  // Mappa nome-categoria -> id, per collegare i prodotti alle categorie
  // merceologiche dell'organizzazione (settore del preset). I nomi non
  // riconosciuti vengono segnalati (l'utente potrà crearli dalla lista).
  const categoryEntries: Array<{ id: string; name: string }> = [];
  let sectorId: string | null = null;
  if (presetVersionId) {
    const { data: pv } = await service
      .from('preset_versions')
      .select('preset_id')
      .eq('id', presetVersionId)
      .maybeSingle();
    if (pv?.preset_id) {
      const { data: preset } = await service
        .from('presets')
        .select('sector_id')
        .eq('id', pv.preset_id)
        .maybeSingle();
      sectorId = preset?.sector_id ?? null;
    }
    if (sectorId) {
      const { data: cats } = await service
        .from('categories')
        .select('id, name, owner_organization_id')
        .eq('sector_id', sectorId)
        .or(`owner_organization_id.is.null,owner_organization_id.eq.${orgId}`);
      // Preferisci la categoria dell'org rispetto a quella di sistema con lo
      // stesso nome (owner non nullo prima).
      const sorted = (cats ?? []).slice().sort((a, b) =>
        a.owner_organization_id === b.owner_organization_id ? 0 : a.owner_organization_id ? -1 : 1,
      );
      const seen = new Set<string>();
      for (const c of sorted) {
        const k = normalizeCategoryName(c.name);
        if (seen.has(k)) continue;
        seen.add(k);
        categoryEntries.push({ id: c.id, name: c.name });
      }
    }
  }
  const matchCategoryId = makeCategoryMatcher(categoryEntries);
  let categoriesMatched = 0;
  const unmatchedCategories = new Set<string>();

  // Colonne LIBERE del file: importa qualsiasi campo come fatto, creando al volo
  // un attributo fattuale se non esiste (es. "descrizione materiale", "prezzo").
  // Ogni fatto in più arricchisce la generazione (e resta sotto l'audit).
  const usedHeaders = new Set<string>([
    input.skuHeader,
    input.categoryHeader ?? '',
    ...Object.values(input.attributeMapping),
  ]);
  const extraColMap = new Map<string, PresetAttributeOption>();
  if (sectorId && input.extraColumns && input.extraColumns.length > 0) {
    for (const ec of input.extraColumns.slice(0, 40)) {
      const header = ec.header?.trim();
      const attrName = (ec.name || header || '').trim().slice(0, 120);
      if (!header || !attrName || usedHeaders.has(header) || extraColMap.has(header)) continue;
      const { data: existing } = await service
        .from('attributes')
        .select('id, key, name')
        .eq('sector_id', sectorId)
        .eq('status', 'active')
        .eq('name', attrName)
        .or(`owner_organization_id.is.null,owner_organization_id.eq.${orgId}`)
        .limit(1)
        .maybeSingle();
      let attr = existing ?? null;
      if (!attr) {
        const { data: created } = await service
          .from('attributes')
          .insert({
            sector_id: sectorId,
            owner_organization_id: orgId,
            name: attrName,
            attribute_kind: 'factual',
            data_type: 'text',
            default_extraction_instruction: `Estrai "${attrName}" dalle fonti: solo il dato dichiarato, non stimare.`,
            default_generation_instruction: `Usa "${attrName}" nel testo solo se presente tra i fatti verificati.`,
            is_system: false,
            status: 'active',
            version: 1,
          })
          .select('id, key, name')
          .single();
        attr = created ?? null;
      }
      if (attr) {
        const opt: PresetAttributeOption = {
          id: attr.id,
          key: attr.key ?? null,
          name: attr.name,
          dataType: 'text',
          isRequired: false,
        };
        extraColMap.set(header, opt);
        // Anche i campi liberi contano come fatti "aggiuntivi" per l'eleggibilità.
        if (!attrById.has(opt.id)) {
          attrById.set(opt.id, { ...opt, key: opt.key ?? canonicalKey(opt) });
        }
      }
    }
  }

  const spreadsheet = await loadBatchSpreadsheet(service, input.batchId);
  const imageItems = await loadImageItems(service, input.batchId);

  // Mappa SKU immagine -> source_item.id (per i link).
  const imageBySku = new Map<string, string[]>();
  for (const item of imageItems) {
    if (!item.detected_sku) continue;
    const arr = imageBySku.get(item.detected_sku);
    if (arr) arr.push(item.id);
    else imageBySku.set(item.detected_sku, [item.id]);
  }

  // Prima di ripulire, salva i fatti che l'utente ha confermato o rifiutato a
  // mano (es. attributi visivi inferiti dalle immagini). Il re-import non deve
  // cancellare questo lavoro: verranno ripristinati sul prodotto ricreato con
  // lo stesso SKU. Chiave logica: (sku, attribute_id).
  interface PavSnapshot {
    sku: string;
    attribute_id: string;
    value_json: Json;
    status: string;
    source_type: string | null;
    source_item_id: string | null;
  }
  const confirmedSnapshots: PavSnapshot[] = [];
  {
    const { data: existingProducts } = await service
      .from('products')
      .select('id, sku')
      .eq('batch_id', input.batchId);
    const skuByProductId = new Map(
      (existingProducts ?? []).map((p) => [p.id, p.sku] as const),
    );
    const existingProductIds = (existingProducts ?? []).map((p) => p.id);
    if (existingProductIds.length > 0) {
      const { data: existingPavs } = await service
        .from('product_attribute_values')
        .select('product_id, attribute_id, value_json, status, source_type, source_item_id')
        .in('product_id', existingProductIds)
        .in('status', ['confirmed', 'rejected']);
      for (const pav of existingPavs ?? []) {
        const sku = skuByProductId.get(pav.product_id);
        if (!sku) continue;
        confirmedSnapshots.push({
          sku,
          attribute_id: pav.attribute_id,
          value_json: pav.value_json,
          status: pav.status,
          source_type: pav.source_type,
          source_item_id: pav.source_item_id,
        });
      }
    }
  }

  // Pulisci import precedenti dello stesso batch (re-import).
  await service.from('products').delete().eq('batch_id', input.batchId);

  let imported = 0;
  let valid = 0;
  let invalid = 0;
  let imageOnly = 0;
  const importedSkus = new Set<string>();
  // sku -> id del prodotto ricreato (per ripristinare i fatti confermati).
  const newProductIdBySku = new Map<string, string>();

  if (spreadsheet && input.skuHeader) {
    for (const row of spreadsheet.parsed.rows) {
      const skuRaw = row[input.skuHeader];
      if (validateRowSku(skuRaw) !== null) {
        invalid++;
        continue;
      }
      const sku = (skuRaw ?? '').trim();
      if (importedSkus.has(sku)) {
        // SKU duplicato: la prima riga vince, le successive sono scartate.
        invalid++;
        continue;
      }

      // Costruisci gli attributi canonici (bridge) e le righe PAV.
      const canonical: Record<string, string> = { sku };
      const pavRows: Array<{ attribute_id: string; value: string }> = [];
      let name: string | null = null;
      let category: string | null = null;

      for (const [attributeId, header] of Object.entries(input.attributeMapping)) {
        if (!header) continue;
        const attr = attrById.get(attributeId);
        if (!attr) continue;
        const value = (row[header] ?? '').trim();
        if (value === '') continue;
        canonical[canonicalKey(attr)] = value;
        pavRows.push({ attribute_id: attributeId, value });
        if (attr.key === 'product_name' && !name) name = value;
        if (attr.key === 'category' && !category) category = value;
      }
      // Colonne libere: ogni valore diventa un fatto passato all'AI.
      for (const [header, attr] of extraColMap) {
        const value = (row[header] ?? '').trim();
        if (value === '') continue;
        const ck = canonicalKey(attr);
        if (canonical[ck] !== undefined) continue; // già valorizzato altrove
        canonical[ck] = value;
        pavRows.push({ attribute_id: attr.id, value });
      }

      // La colonna Categoria dedicata (se scelta) ha la priorità: è il modo
      // esplicito con cui l'utente assegna la categoria, indipendentemente dagli
      // attributi del preset.
      if (input.categoryHeader) {
        const catVal = (row[input.categoryHeader] ?? '').trim();
        if (catVal) category = catVal;
      }
      if (!name) name = sku;

      // Codice padre (varianti): raggruppa colore/taglia dello stesso prodotto.
      let parentExternalId: string | null = null;
      if (input.parentHeader) {
        const pv = (row[input.parentHeader] ?? '').trim();
        if (pv && pv !== sku) parentExternalId = pv;
      }

      const hasImages = imageBySku.has(sku);
      const built: BuiltProduct = {
        externalId: sku,
        parentExternalId,
        name,
        productType: null,
        category,
        sku,
        rawInput: row,
        canonicalAttributes: canonical,
        facts: [],
      };
      const quality = computeQuality(built, { hasImages });

      // Eleggibilità SECTOR-AGNOSTICA: SKU presente + almeno 2 fatti aggiuntivi.
      // Conta come fatto anche le COLONNE LIBERE (senza key) e gli attributi non
      // identificativi: solo sku/nome/categoria non contano. Senza questo, un CSV
      // con dati solo in colonne libere risultava "informazioni non sufficienti".
      const additionalFacts = pavRows.filter((p) => {
        const a = attrById.get(p.attribute_id);
        return !a || !a.key || !NON_ADDITIONAL_FIELDS.has(a.key);
      }).length;
      const eligible = Boolean(sku) && additionalFacts >= 2;

      if (input.options.excludeIncomplete && !eligible) {
        invalid++;
        continue;
      }

      // Collega il prodotto alla categoria merceologica dell'org (match robusto).
      let categoryId: string | null = null;
      if (category) {
        const matched = matchCategoryId(category);
        if (matched) {
          categoryId = matched;
          categoriesMatched++;
        } else {
          unmatchedCategories.add(category.trim());
        }
      }

      const { data: productRow, error: pErr } = await service
        .from('products')
        .insert({
          organization_id: orgId,
          batch_id: input.batchId,
          sku,
          name,
          category,
          category_id: categoryId,
          parent_external_id: parentExternalId,
          preset_version_id: presetVersionId,
          external_id: sku,
          raw_input_json: row as unknown as Json,
          canonical_attributes_json: canonical as unknown as Json,
          data_quality_score: quality.score,
          verification_status: eligible ? 'eligible' : 'excluded',
        })
        .select('id')
        .single();
      if (pErr || !productRow) {
        invalid++;
        continue;
      }
      imported++;
      importedSkus.add(sku);
      newProductIdBySku.set(sku, productRow.id);
      if (quality.eligible) valid++;
      else invalid++;

      if (pavRows.length > 0) {
        await service.from('product_attribute_values').insert(
          pavRows.map((r) => ({
            organization_id: orgId,
            product_id: productRow.id,
            attribute_id: r.attribute_id,
            value_json: r.value as unknown as Json,
            status: 'provided',
            source_type: 'spreadsheet',
            source_item_id: spreadsheet.sourceItemId,
          })),
        );
      }

      // Link alle immagini con SKU corrispondente (match esatto).
      const imgIds = imageBySku.get(sku) ?? [];
      if (imgIds.length > 0) {
        await service.from('product_source_links').insert(
          imgIds.map((id) => ({
            organization_id: orgId,
            product_id: productRow.id,
            source_item_id: id,
            link_type: 'sku_exact',
          })),
        );
      }
    }
  }

  // Prodotti solo-immagini: SKU presenti nelle immagini ma non nel file.
  if (input.options.includeImageOnly) {
    for (const [sku, imgIds] of imageBySku) {
      if (importedSkus.has(sku)) continue;
      const canonical: Record<string, string> = { sku };
      const built: BuiltProduct = {
        externalId: sku,
        parentExternalId: null,
        name: sku,
        productType: null,
        category: null,
        sku,
        rawInput: {},
        canonicalAttributes: canonical,
        facts: [],
      };
      const quality = computeQuality(built, { hasImages: true });

      const { data: productRow, error: pErr } = await service
        .from('products')
        .insert({
          organization_id: orgId,
          batch_id: input.batchId,
          sku,
          name: sku,
          category: null,
          preset_version_id: presetVersionId,
          external_id: sku,
          raw_input_json: {} as unknown as Json,
          canonical_attributes_json: canonical as unknown as Json,
          data_quality_score: quality.score,
          verification_status: 'excluded',
        })
        .select('id')
        .single();
      if (pErr || !productRow) continue;
      imported++;
      imageOnly++;
      invalid++;
      importedSkus.add(sku);
      newProductIdBySku.set(sku, productRow.id);

      await service.from('product_source_links').insert(
        imgIds.map((id) => ({
          organization_id: orgId,
          product_id: productRow.id,
          source_item_id: id,
          link_type: 'sku_exact',
        })),
      );
    }
  }

  // Ripristina i fatti confermati/rifiutati a mano sul prodotto ricreato con lo
  // stesso SKU. Se il re-import ha già inserito una PAV per quello stesso
  // attributo (da spreadsheet, status 'provided'), la sovrascrive con lo stato
  // più forte confermato dall'utente; altrimenti la reinserisce.
  for (const snap of confirmedSnapshots) {
    const newProductId = newProductIdBySku.get(snap.sku);
    if (!newProductId) continue;
    const { data: existing } = await service
      .from('product_attribute_values')
      .select('id')
      .eq('product_id', newProductId)
      .eq('attribute_id', snap.attribute_id)
      .maybeSingle();
    if (existing) {
      await service
        .from('product_attribute_values')
        .update({ status: snap.status, value_json: snap.value_json })
        .eq('id', existing.id);
    } else {
      await service.from('product_attribute_values').insert({
        organization_id: orgId,
        product_id: newProductId,
        attribute_id: snap.attribute_id,
        value_json: snap.value_json,
        status: snap.status,
        source_type: snap.source_type ?? 'image',
        source_item_id: snap.source_item_id,
      });
    }
  }

  await service
    .from('batches')
    .update({
      status: 'input_review',
      total_products: imported,
      valid_products: valid,
      invalid_products: invalid,
    })
    .eq('id', input.batchId);

  const unmatched = [...unmatchedCategories];
  await service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'mapping_confirmed',
    batch_id: input.batchId,
    metadata_json: {
      imported,
      valid,
      invalid,
      imageOnly,
      categoriesMatched,
      unmatchedCategories: unmatched.length,
    },
  });

  return ok({
    imported,
    valid,
    invalid,
    imageOnly,
    categoriesMatched,
    unmatchedCategories: unmatched.slice(0, 50),
  });
}

// ---------------------------------------------------------------------------
// 8) Prodotti del batch (verifica dati).
// ---------------------------------------------------------------------------

export interface BatchProductRow {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  quality: number;
  attributesCount: number;
  imagesCount: number;
  status: string;
}

/** Categorie disponibili per il settore del preset del batch (per la mappatura manuale). */
export async function getBatchCategoryOptions(input: {
  batchId: string;
}): Promise<ActionResult<{ categories: Array<{ id: string; name: string }> }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();
  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', input.batchId)
    .maybeSingle();
  if (!batch?.preset_version_id) return ok({ categories: [] });
  const { data: pv } = await service
    .from('preset_versions')
    .select('preset_id')
    .eq('id', batch.preset_version_id)
    .maybeSingle();
  if (!pv?.preset_id) return ok({ categories: [] });
  const { data: preset } = await service
    .from('presets')
    .select('sector_id')
    .eq('id', pv.preset_id)
    .maybeSingle();
  if (!preset?.sector_id) return ok({ categories: [] });
  const { data: cats } = await service
    .from('categories')
    .select('id, name')
    .eq('sector_id', preset.sector_id)
    .eq('status', 'active')
    .or(`owner_organization_id.is.null,owner_organization_id.eq.${orgId}`)
    .order('name', { ascending: true });
  return ok({ categories: (cats ?? []).map((c) => ({ id: c.id, name: c.name })) });
}

/** Assegna manualmente una categoria a uno o più prodotti (deterministico). */
export async function setProductsCategoryAction(input: {
  batchId: string;
  productIds: string[];
  categoryId: string | null;
}): Promise<ActionResult<{ updated: number }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  if (input.productIds.length === 0) return ok({ updated: 0 });
  const service = getServiceClient();

  let categoryName: string | null = null;
  if (input.categoryId) {
    const { data: cat } = await service
      .from('categories')
      .select('id, name')
      .eq('id', input.categoryId)
      .maybeSingle();
    if (!cat) return fail('Categoria non valida');
    categoryName = cat.name;
  }

  const { error } = await service
    .from('products')
    .update({ category_id: input.categoryId, category: categoryName })
    .eq('batch_id', input.batchId)
    .in('id', input.productIds);
  if (error) return fail(`Aggiornamento categoria fallito: ${error.message}`);
  return ok({ updated: input.productIds.length });
}

export async function getBatchProductsV2(input: {
  batchId: string;
}): Promise<ActionResult<{ products: BatchProductRow[] }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data: products } = await service
    .from('products')
    .select('id, sku, name, category, data_quality_score, verification_status')
    .eq('batch_id', input.batchId)
    .order('data_quality_score', { ascending: false });

  const productIds = (products ?? []).map((p) => p.id);
  const attrCount = new Map<string, number>();
  const imgCount = new Map<string, number>();
  if (productIds.length > 0) {
    const [{ data: pavs }, { data: links }] = await Promise.all([
      service.from('product_attribute_values').select('product_id').in('product_id', productIds),
      service.from('product_source_links').select('product_id, link_type').in('product_id', productIds),
    ]);
    for (const pav of pavs ?? []) attrCount.set(pav.product_id, (attrCount.get(pav.product_id) ?? 0) + 1);
    for (const l of links ?? []) {
      if (l.link_type !== 'sku_exact') continue;
      imgCount.set(l.product_id, (imgCount.get(l.product_id) ?? 0) + 1);
    }
  }

  const rows: BatchProductRow[] = (products ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    quality: p.data_quality_score,
    attributesCount: attrCount.get(p.id) ?? 0,
    imagesCount: imgCount.get(p.id) ?? 0,
    status: p.verification_status ?? 'sconosciuto',
  }));

  return ok({ products: rows });
}

// ---------------------------------------------------------------------------
// IMPORT DA URL (MVP: fetch + dati strutturati JSON-LD/OpenGraph).
// Per ogni URL: scarica l'HTML (fetch SSRF-safe), estrae i FATTI (nome, brand,
// prezzo, attributi, immagini), crea il prodotto + i product_attribute_values
// (source_type 'url') e scarica le immagini nella stessa pipeline OCR.
// Riusa gli helper di confirmImportV2 (categorie, eleggibilità, qualità).
// L'AI poi RIscrive la prosa: non copiamo il testo della pagina sorgente.
// ---------------------------------------------------------------------------

const MAX_URLS_PER_IMPORT = 60;
const URL_IMAGES_PER_PRODUCT = 6;
const URL_FETCH_CONCURRENCY = 4;

export interface UrlImportResult {
  imported: number;
  failed: number;
  imagesAttached: number;
  failures: Array<{ url: string; reason: string }>;
}

/** Esegue `fn` sugli item con al più `limit` in parallelo, preservando l'ordine. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function extFromContentType(ct: string): string | null {
  const t = ct.toLowerCase();
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('png')) return '.png';
  if (t.includes('webp')) return '.webp';
  return null;
}

function slugFromUrl(rawUrl: string, index: number): string {
  try {
    const u = new URL(rawUrl);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) {
      const slug = seg
        .replace(/\.[a-z0-9]{1,6}$/i, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      if (slug) return slug;
    }
  } catch {
    /* ignore */
  }
  return `url-${index + 1}`;
}

export async function importFromUrls(input: {
  batchId: string;
  urls: string[];
}): Promise<ActionResult<UrlImportResult>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  // Normalizza gli URL: uno per riga, http(s), deduplicati, con un tetto.
  const urls = [...new Set(
    (input.urls ?? [])
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u)),
  )].slice(0, MAX_URLS_PER_IMPORT);
  if (urls.length === 0) return fail('Incolla almeno un URL valido (http/https).');

  // Contesto preset: settore, categorie dell'org, attributi.
  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', input.batchId)
    .maybeSingle();
  const presetVersionId = batch?.preset_version_id ?? null;
  const presetAttrs = presetVersionId ? await loadPresetAttributes(service, presetVersionId) : [];
  const attrById = new Map(presetAttrs.map((a) => [a.id, a]));

  let sectorId: string | null = null;
  const categoryIdByName = new Map<string, string>();
  if (presetVersionId) {
    const { data: pv } = await service.from('preset_versions').select('preset_id').eq('id', presetVersionId).maybeSingle();
    if (pv?.preset_id) {
      const { data: preset } = await service.from('presets').select('sector_id').eq('id', pv.preset_id).maybeSingle();
      sectorId = preset?.sector_id ?? null;
    }
    if (sectorId) {
      const { data: cats } = await service
        .from('categories')
        .select('id, name, owner_organization_id')
        .eq('sector_id', sectorId)
        .or(`owner_organization_id.is.null,owner_organization_id.eq.${orgId}`);
      for (const c of cats ?? []) {
        const key = normalizeCategoryName(c.name);
        if (!categoryIdByName.has(key) || c.owner_organization_id !== null) categoryIdByName.set(key, c.id);
      }
    }
  }

  // SKU già presenti nel batch: evita collisioni con l'unicità (batch, external_id).
  const takenSkus = new Set<string>();
  {
    const { data: existing } = await service.from('products').select('sku').eq('batch_id', input.batchId);
    for (const p of existing ?? []) if (p.sku) takenSkus.add(p.sku);
  }

  // Cache find-or-create attributo fattuale per nome (nel settore del preset).
  const factCache = new Map<string, PresetAttributeOption | null>();
  async function resolveFactAttribute(name: string): Promise<PresetAttributeOption | null> {
    const clean = name.trim().slice(0, 120);
    if (!clean || !sectorId) return null;
    const cacheKey = clean.toLowerCase();
    if (factCache.has(cacheKey)) return factCache.get(cacheKey) ?? null;
    const { data: existing } = await service
      .from('attributes')
      .select('id, key, name')
      .eq('sector_id', sectorId)
      .eq('status', 'active')
      .eq('name', clean)
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${orgId}`)
      .limit(1)
      .maybeSingle();
    let attr = existing ?? null;
    if (!attr) {
      const { data: created } = await service
        .from('attributes')
        .insert({
          sector_id: sectorId,
          owner_organization_id: orgId,
          name: clean,
          attribute_kind: 'factual',
          data_type: 'text',
          default_extraction_instruction: `Estrai "${clean}" dalle fonti: solo il dato dichiarato, non stimare.`,
          default_generation_instruction: `Usa "${clean}" nel testo solo se presente tra i fatti verificati.`,
          is_system: false,
          status: 'active',
          version: 1,
        })
        .select('id, key, name')
        .single();
      attr = created ?? null;
    }
    const opt: PresetAttributeOption | null = attr
      ? { id: attr.id, key: attr.key ?? null, name: attr.name, dataType: 'text', isRequired: false }
      : null;
    if (opt && !attrById.has(opt.id)) attrById.set(opt.id, opt);
    factCache.set(cacheKey, opt);
    return opt;
  }

  // Fase 1: fetch + estrazione in parallelo.
  const extracted = await mapPool(urls, URL_FETCH_CONCURRENCY, async (url) => {
    const res = await safeFetch(url, { maxBytes: 3_000_000, accept: 'text/html,application/xhtml+xml' });
    if (!res.ok) return { url, error: res.error ?? 'fetch fallito' };
    const html = new TextDecoder('utf-8').decode(res.bytes);
    const data = extractProductFromHtml(html, res.finalUrl);
    if (!data.name) return { url, error: 'Nessun dato prodotto riconosciuto (né JSON-LD né Open Graph).' };
    return { url, data };
  });

  const bucket = STORAGE_BUCKETS.productAssets;
  const failures: Array<{ url: string; reason: string }> = [];
  let imported = 0;
  let valid = 0;
  let imagesAttached = 0;
  let imageBatchSourceId: string | null = null;

  // Fase 2: creazione prodotti + fatti + immagini (sequenziale per coerenza).
  for (let i = 0; i < extracted.length; i++) {
    const item = extracted[i]!;
    if ('error' in item) {
      failures.push({ url: item.url, reason: item.error ?? 'Errore sconosciuto' });
      continue;
    }
    const { url, data } = item;

    // SKU univoco nel batch.
    let sku = (data.sku ? sanitizeFilename(data.sku).replace(/\.[a-z0-9]+$/i, '') : '').trim() || slugFromUrl(url, i);
    sku = sku.slice(0, 64);
    if (takenSkus.has(sku)) {
      let n = 2;
      while (takenSkus.has(`${sku}-${n}`)) n++;
      sku = `${sku}-${n}`;
    }
    takenSkus.add(sku);

    // Attributi/fatti → PAV + canonical.
    const canonical: Record<string, string> = { sku };
    const pavRows: Array<{ attribute_id: string; value: string }> = [];
    const facts: Record<string, string> = { ...data.attributes };
    if (data.brand) facts['Brand'] = data.brand;
    if (data.price) facts['Prezzo'] = data.price;
    const category: string | null = facts['Categoria'] ?? null;

    for (const [name, value] of Object.entries(facts)) {
      const v = (value ?? '').trim();
      if (!v || name.toLowerCase() === 'categoria') continue;
      const attr = await resolveFactAttribute(name);
      if (!attr) continue;
      const ck = canonicalKey(attr);
      if (canonical[ck] !== undefined) continue;
      canonical[ck] = v;
      pavRows.push({ attribute_id: attr.id, value: v });
    }

    const name = data.name ?? sku;
    const built: BuiltProduct = {
      externalId: sku,
      parentExternalId: null,
      name,
      productType: null,
      category,
      sku,
      rawInput: { url },
      canonicalAttributes: canonical,
      facts: [],
    };
    const quality = computeQuality(built, { hasImages: data.imageUrls.length > 0 });
    const additionalFacts = pavRows.filter((p) => {
      const a = attrById.get(p.attribute_id);
      return !a || !a.key || !NON_ADDITIONAL_FIELDS.has(a.key);
    }).length;
    const eligible = Boolean(sku) && additionalFacts >= 2;

    let categoryId: string | null = null;
    if (category) {
      const matched = categoryIdByName.get(normalizeCategoryName(category));
      if (matched) categoryId = matched;
    }

    const { data: productRow, error: pErr } = await service
      .from('products')
      .insert({
        organization_id: orgId,
        batch_id: input.batchId,
        sku,
        name,
        category,
        category_id: categoryId,
        preset_version_id: presetVersionId,
        external_id: sku,
        raw_input_json: { url } as unknown as Json,
        canonical_attributes_json: canonical as unknown as Json,
        data_quality_score: quality.score,
        verification_status: eligible ? 'eligible' : 'excluded',
      })
      .select('id')
      .single();
    if (pErr || !productRow) {
      failures.push({ url, reason: `Creazione prodotto fallita: ${pErr?.message ?? 'sconosciuto'}` });
      continue;
    }
    imported++;
    if (eligible) valid++;

    if (pavRows.length > 0) {
      await service.from('product_attribute_values').insert(
        pavRows.map((r) => ({
          organization_id: orgId,
          product_id: productRow.id,
          attribute_id: r.attribute_id,
          value_json: r.value as unknown as Json,
          status: 'provided',
          source_type: 'url',
        })),
      );
    }

    // Immagini: scarica (SSRF-safe) → storage → source_files/source_items → link.
    for (const imgUrl of data.imageUrls.slice(0, URL_IMAGES_PER_PRODUCT)) {
      const img = await safeFetch(imgUrl, { maxBytes: 8_000_000, accept: 'image/*' });
      if (!img.ok || !img.contentType.toLowerCase().startsWith('image/')) continue;
      const ext = extFromContentType(img.contentType);
      if (!ext) continue;
      const buf = Buffer.from(img.bytes);
      const sha = createHash('sha256').update(buf).digest('hex');
      const path = `${orgId}/${input.batchId}/${crypto.randomUUID()}-url${ext}`;
      const up = await service.storage.from(bucket).upload(path, buf, { contentType: img.contentType, upsert: false });
      if (up.error) continue;
      if (!imageBatchSourceId) {
        imageBatchSourceId = await getOrCreateBatchSource(service, orgId, input.batchId, IMAGE_SOURCE);
      }
      if (!imageBatchSourceId) continue;
      const filename = `${sku}${ext}`;
      const { data: sf } = await service
        .from('source_files')
        .insert({
          organization_id: orgId,
          batch_id: input.batchId,
          storage_bucket: bucket,
          storage_path: path,
          original_filename: filename,
          mime_type: img.contentType,
          sha256: sha,
          size_bytes: buf.byteLength,
          status: 'ready',
        })
        .select('id')
        .single();
      if (!sf) continue;
      const { data: si } = await service
        .from('source_items')
        .insert({
          organization_id: orgId,
          batch_source_id: imageBatchSourceId,
          source_file_id: sf.id,
          filename,
          mime_type: img.contentType,
          size_bytes: buf.byteLength,
          detected_sku: sku,
          status: 'valid',
          metadata_json: { imageType: suggestImageType(filename), fromUrl: imgUrl } as unknown as Json,
        })
        .select('id')
        .single();
      if (!si) continue;
      await service.from('product_source_links').insert({
        organization_id: orgId,
        product_id: productRow.id,
        source_item_id: si.id,
        link_type: 'sku_exact',
      });
      imagesAttached++;
    }
  }

  if (imageBatchSourceId) {
    await service.from('batch_sources').update({ status: 'ready' }).eq('id', imageBatchSourceId);
  }

  // Porta il batch in revisione dati, come confirmImportV2, così i passi
  // successivi (campione → generazione) funzionano senza modifiche.
  if (imported > 0) {
    await service
      .from('batches')
      .update({ status: 'input_review', total_products: imported, valid_products: valid, invalid_products: imported - valid })
      .eq('id', input.batchId);
    await service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'url_import_confirmed',
      batch_id: input.batchId,
      metadata_json: { imported, valid, imagesAttached, failed: failures.length } as unknown as Json,
    });
  }

  return ok({ imported, failed: failures.length, imagesAttached, failures: failures.slice(0, 20) });
}
