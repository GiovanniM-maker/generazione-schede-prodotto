'use server';

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  parseCsv,
  parseXlsx,
  extractSkuFromFilename,
  suggestImageType,
  isSupportedImage,
  validateRowSku,
  suggestSkuHeader,
  analyzeSources,
  computeQuality,
  NON_ADDITIONAL_FIELDS,
  type ParseResult,
  type SourceAnalysis,
  type BuiltProduct,
} from '@app/core';
import { STORAGE_BUCKETS } from '@app/config';
import type { Json } from '@app/database';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';

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
const IMAGE_SOURCE = 'image_upload';

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
  if (error || !data) return null;
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
      previewRows: parsed.rows.slice(0, 10),
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
}

export async function confirmImportV2(input: {
  batchId: string;
  skuHeader: string;
  attributeMapping: Record<string, string>; // attributeId -> header
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
      if (!name) name = sku;

      const hasImages = imageBySku.has(sku);
      const built: BuiltProduct = {
        externalId: sku,
        parentExternalId: null,
        name,
        productType: null,
        category,
        sku,
        rawInput: row,
        canonicalAttributes: canonical,
        facts: [],
      };
      const quality = computeQuality(built, { hasImages });

      // Eleggibilità SECTOR-AGNOSTICA: SKU presente + almeno 2 fatti aggiuntivi
      // (attributi mappati non-identificativi). Allineata al guard della pipeline,
      // così Food/Pharma (chiavi diverse da Moda) vengono correttamente accodati.
      const additionalFacts = pavRows.filter((p) => {
        const a = attrById.get(p.attribute_id);
        return a && a.key && !NON_ADDITIONAL_FIELDS.has(a.key);
      }).length;
      const eligible = Boolean(sku) && additionalFacts >= 2;

      if (input.options.excludeIncomplete && !eligible) {
        invalid++;
        continue;
      }

      const { data: productRow, error: pErr } = await service
        .from('products')
        .insert({
          organization_id: orgId,
          batch_id: input.batchId,
          sku,
          name,
          category,
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

  await service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'mapping_confirmed',
    batch_id: input.batchId,
    metadata_json: { imported, valid, invalid, imageOnly },
  });

  return ok({ imported, valid, invalid, imageOnly });
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
