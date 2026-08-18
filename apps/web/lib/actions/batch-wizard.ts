'use server';

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  NON_ADDITIONAL_FIELDS,
  SKU_DELIMITERS,
  analyzeSources,
  chunk,
  computeQuality,
  extractProductFromHtml,
  extractProductFromPdfText,
  analizzaListaIncollata,
  righeDaTabella,
  suggerisciColonneListaSku,
  type MappaturaListaSku,
  type RigaListaSku,
  normalizzaSku,
  proponiRaggruppamento,
  raggruppa,
  anteprimaCosti,
  confidenzaCampo,
  valutaConferma,
  ordinaPerLaScelta,
  livelloDelDominio,
  esitoDeciso,
  IN_CODA,
  MAX_TENTATIVI,
  type CandidatoSalvato,
  extractSkuFromFilename,
  isSupportedImage,
  logWrite,
  mustWrite,
  normalizeCategoryName,
  parseCsv,
  parseXlsx,
  pickCategoryVocabulary,
  suggestImageType,
  suggestNameHeader,
  suggestSkuHeader,
  unisciVarianti,
  validateRowSku,
  type BuiltProduct,
  type CategoryRow,
  type ParseResult,
  type SkuDelimiter,
  type SourceAnalysis,
  type VarianteUnita,
} from '@app/core';
import { STORAGE_BUCKETS } from '@app/config';
import type { Json } from '@app/database';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';
import { safeFetch } from '@/lib/safe-fetch';
import { estraiTestoDaPdf } from '@/lib/pdf';
import { getFornitoreRicerca } from '@/lib/ricerca-brave';
import { eseguiScaglione, type Materializza } from '@/lib/coda-sku';
import { scaricaImmaginiDaPagina } from '@/lib/immagini-da-web';
import { writeOrTrace } from '@app/pipeline';

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

  await logWrite('app_events.insert', service.from('app_events').insert({
    organization_id: org.organizationId,
    user_id: user.id,
    event_name: 'batch_created',
    batch_id: data.id,
    metadata_json: { presetId: input.presetId, description: input.description ?? null },
  }));

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
  // NB: nessun 'sources_selected' — non esiste nell'enum batch_status e faceva
  // fallire l'update IN SILENZIO (anche source_type non veniva salvato).
  const salvato = await mustWrite('batches.update', service.from('batches').update({ source_type: sourceType }).eq('id', input.batchId));
  if (!salvato.ok) return fail(`Fonti non salvate: ${salvato.error}`);

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
  /** Colonna che sembra contenere il nome del prodotto (mai quella dello SKU). */
  suggestedNameHeader: string | null;
  /** I fogli dell'Excel: vuoto per i CSV. Serve a poterne scegliere un altro. */
  sheets: string[];
  /** Il foglio letto. Senza questo, l'utente non sa nemmeno cosa ha importato. */
  sheet: string | null;
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

    // Si legge PRIMA di salvare: un file che verrà rifiutato non ha motivo di
    // finire su storage e di occupare spazio per sempre.
    let parsed: ParseResult;
    try {
      parsed = ext === '.csv' ? parseCsv(buffer) : await parseXlsx(buffer);
    } catch (e) {
      return fail(`Lettura file fallita: ${e instanceof Error ? e.message : 'errore'}`);
    }
    if (parsed.rows.length > MAX_ROWS) {
      return fail(`Troppe righe (${parsed.rows.length}). Massimo ${MAX_ROWS} per file: dividi il catalogo.`);
    }
    // Un file senza righe dati non e' un catalogo. Prima veniva accettato con
    // la spunta verde e i tre passi successivi mostravano "ok" prima che
    // l'import confessasse "Nessun prodotto importato": quattro schermate di
    // rassicurazione su niente.
    if (parsed.rows.length === 0) {
      return fail(
        parsed.headers.length === 0
          ? 'Il file è vuoto: non contiene né intestazioni né righe.'
          : 'Il file ha solo la riga di intestazione, nessun prodotto. Controlla di aver esportato anche i dati.',
      );
    }

    const persisted = await persistSourceFile(service, orgId, batchId, STORAGE_BUCKETS.sourceFiles, file, buffer, ext);
    if ('error' in persisted) return fail(persisted.error);

    const batchSourceId = await getOrCreateBatchSource(service, orgId, batchId, SPREADSHEET_SOURCE);
    if (!batchSourceId) return fail('Registrazione sorgente fallita');

    // Rimpiazza eventuali item precedenti dello spreadsheet (re-upload).
    // Se la pulizia non passa il file precedente resta collegato: l'analisi
    // vedrebbe due spreadsheet e SKU doppi.
    const ripulito = await mustWrite('source_items.delete', service.from('source_items').delete().eq('batch_source_id', batchSourceId));
    if (!ripulito.ok) return fail(`Sorgente precedente non rimossa: ${ripulito.error}`);
    // status DEVE essere un valore dell'enum source_item_status ('valid', …):
    // 'ready' NON è valido e faceva fallire l'insert IN SILENZIO, lasciando lo
    // spreadsheet senza source_item → l'analisi non trovava gli SKU del file.
    const { error: itemErr } = await service.from('source_items').insert({
      organization_id: orgId,
      batch_source_id: batchSourceId,
      source_file_id: persisted.id,
      filename: file.name,
      mime_type: file.type || null,
      size_bytes: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      detected_sku: null,
      status: 'valid',
      metadata_json: { headers: parsed.headers, rowCount: parsed.rows.length } as unknown as Json,
    });
    if (itemErr) return fail(`Registrazione file non riuscita: ${itemErr.message}`);
    const pronta = await mustWrite('batch_sources.update', service.from('batch_sources').update({ status: 'ready' }).eq('id', batchSourceId));
    if (!pronta.ok) return fail(`Sorgente non collegata al batch: ${pronta.error}`);

    return ok<UploadSpreadsheetResult>({
      kind: 'spreadsheet',
      headers: parsed.headers,
      previewRows: parsed.rows.slice(0, 100),
      suggestedSkuHeader: suggestSkuHeader(parsed.headers),
      suggestedNameHeader: suggestNameHeader(parsed.headers, suggestSkuHeader(parsed.headers)),
      sheets: parsed.sheets ?? [],
      sheet: parsed.sheet ?? null,
      totalRows: parsed.rows.length,
      file: {
        filename: file.name,
        sku: null,
        status: 'ready',
        problem: null,
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
      const reg = await mustWrite('source_items.insert', service.from('source_items').insert({
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
      }));
      // Se l'immagine non viene registrata, il file e' su storage ma il batch non
      // lo vede: e' esattamente il guasto che produceva "solo immagini".
      if (!reg.ok) return fail(`Registrazione immagine "${file.name}" non riuscita: ${reg.error}`);

      if (sku) validCount++;
      else invalidCount++;
      summaries.push({
        filename: file.name,
        sku,
        status,
        problem: sku ? null : 'SKU assente nel nome file: rinomina come {SKU}_descrizione.jpg',
      });
    }

    const pronta = await mustWrite('batch_sources.update', service.from('batch_sources').update({ status: 'ready' }).eq('id', batchSourceId));
    if (!pronta.ok) return fail(`Sorgente non collegata al batch: ${pronta.error}`);

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
    const reg = await mustWrite('source_items.insert', service.from('source_items').insert(itemRows));
    if (!reg.ok) return fail(`Registrazione delle immagini non riuscita: ${reg.error}`);
  }
  const pronta = await mustWrite('batch_sources.update', service.from('batch_sources').update({ status: 'ready' }).eq('id', batchSourceId));
  if (!pronta.ok) return fail(`Sorgente non collegata al batch: ${pronta.error}`);

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

  // Se uno di questi aggiornamenti fallisce, l'immagine resta con lo SKU
  // vecchio: l'anteprima direbbe una cosa e il database un'altra. Meglio
  // dirlo subito che scoprirlo al momento della generazione.
  let updateErrors = 0;
  for (const slice of chunk(updates, 20)) {
    const results = await Promise.all(
      slice.map((u) =>
        mustWrite(
          'source_items.update',
          service
            .from('source_items')
            .update({ detected_sku: u.sku, status: u.status })
            .eq('id', u.id),
        ),
      ),
    );
    updateErrors += results.filter((r) => !r.ok).length;
  }
  if (updateErrors > 0) {
    return fail(`${updateErrors} immagini non aggiornate con il nuovo separatore. Riprova.`);
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
  /** Il nome del file come l'ha caricato l'utente: serve per riconoscerlo. */
  filename: string;
}

async function loadBatchSpreadsheet(
  service: ReturnType<typeof getServiceClient>,
  batchId: string,
  foglio?: string | null,
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
  const parsed = isCsv ? parseCsv(buffer) : await parseXlsx(buffer, { sheet: foglio ?? null });
  return { parsed, sourceItemId: item.id, isCsv, filename: item.filename ?? sf.original_filename };
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
  // 'analysis' non esiste nell'enum batch_status (update falliva in silenzio):
  // dopo l'analisi delle sorgenti il batch è in fase di mappatura.
  const inMappatura = await mustWrite('batches.update', service.from('batches').update({ status: 'mapping' }).eq('id', input.batchId));
  if (!inMappatura.ok) return fail(`Analisi non conclusa, stato non aggiornato: ${inMappatura.error}`);

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
  /**
   * Prodotti importati senza i loro fatti perche' il database ha rifiutato la
   * scrittura. Finiva solo nella telemetria: chi importava non lo sapeva, e
   * scopriva il buco a generazione fatta.
   */
  factsInsertErrors: number;
  /**
   * Prodotti rimasti col codice al posto del nome perché nel file non è stata
   * indicata una colonna nome. Era il caso di *tutti* i prodotti di ogni
   * catalogo, e nessuno lo diceva.
   */
  senzaNome: number;
  /** Prodotti collegati a una categoria merceologica dell'organizzazione. */
  categoriesMatched: number;
  /** Nomi di categoria presenti nel file ma non riconosciuti (da creare). */
  unmatchedCategories: string[];
  /**
   * Le righe che non sono entrate, con il perché.
   *
   * Prima ne restava solo il numero, e in interfaccia era etichettato «da
   * rivedere» — una parola che promette una revisione che non esiste da nessuna
   * parte. Sono righe **scartate**, e chi importa un listino ha il diritto di
   * sapere quali: senza l'elenco, l'unico modo di scoprirlo è confrontare a
   * mano il file con il catalogo importato.
   *
   * L'elenco è tagliato: serve a capire *cosa* è successo, non a rifare
   * l'import.
   */
  scartate: RigaScartata[];
}

export interface RigaScartata {
  /** Il codice della riga, quando c'era. */
  sku: string | null;
  motivo: 'codice non valido' | 'codice ripetuto nel file' | 'dati insufficienti';
}

/** Oltre questo numero l'elenco smette di aiutare e diventa un muro. */
const MAX_SCARTATE = 50;

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

export interface PresetCategoryScope {
  entries: Array<{ id: string; name: string }>;
  sectorId: string | null;
  /** true = sono le categorie del preset; false = ripiego sul settore. */
  fromPreset: boolean;
}

/**
 * Categorie utilizzabili in un batch: SOLO quelle del preset scelto.
 *
 * Prima si prendevano tutte le categorie del SETTORE (quelle di sistema più
 * quelle dell'organizzazione). Risultato: chi sceglieva un preset con il
 * proprio vocabolario ("Ciocc/Caffè", "Panett/Gastr") si vedeva comunque
 * proporre — e assegnare — le categorie di base del settore ("Pasta e riso",
 * "Vini", "Snack"), che in quel preset non esistono e non hanno attributi.
 *
 * Il preset è il vocabolario del batch: se una categoria non è nel preset non
 * deve comparire. Unico ripiego: preset senza categorie configurate, dove
 * senza elenco l'utente non potrebbe mappare nulla.
 */
async function loadPresetCategoryScope(
  service: ReturnType<typeof getServiceClient>,
  orgId: string,
  presetVersionId: string | null,
): Promise<PresetCategoryScope> {
  if (!presetVersionId) return { entries: [], sectorId: null, fromPreset: false };

  const { data: pv } = await service
    .from('preset_versions')
    .select('preset_id')
    .eq('id', presetVersionId)
    .maybeSingle();
  if (!pv?.preset_id) return { entries: [], sectorId: null, fromPreset: false };

  const { data: preset } = await service
    .from('presets')
    .select('sector_id, organization_id')
    .eq('id', pv.preset_id)
    .maybeSingle();
  if (!preset || preset.organization_id !== orgId) {
    return { entries: [], sectorId: null, fromPreset: false };
  }
  const sectorId = preset.sector_id ?? null;
  const toRows = (
    rows: Array<{ id: string; name: string; owner_organization_id: string | null }> | null,
  ): CategoryRow[] =>
    (rows ?? []).map((c) => ({ id: c.id, name: c.name, ownerOrganizationId: c.owner_organization_id }));

  const { data: presetCats } = await service
    .from('preset_categories')
    .select('category_id, enabled')
    .eq('preset_version_id', presetVersionId);
  const ids = (presetCats ?? [])
    .filter((c) => c.enabled !== false)
    .map((c) => c.category_id)
    .filter((id): id is string => Boolean(id));

  const { data: fromPresetRows } = ids.length
    ? await service
        .from('categories')
        .select('id, name, owner_organization_id')
        .in('id', ids)
        .eq('status', 'active')
    : { data: null };

  // Il ripiego sul settore serve solo se il preset non ha categorie: evita di
  // caricarlo quando non serve.
  const needSectorFallback = (fromPresetRows ?? []).length === 0 && Boolean(sectorId);
  const { data: sectorRows } = needSectorFallback
    ? await service
        .from('categories')
        .select('id, name, owner_organization_id')
        .eq('sector_id', sectorId as string)
        .eq('status', 'active')
        .or(`owner_organization_id.is.null,owner_organization_id.eq.${orgId}`)
    : { data: null };

  const vocabulary = pickCategoryVocabulary({
    presetCategories: toRows(fromPresetRows),
    sectorCategories: toRows(sectorRows),
  });
  return { ...vocabulary, sectorId };
}

export async function confirmImportV2(input: {
  batchId: string;
  skuHeader: string;
  /**
   * Colonna del file che contiene il NOME del prodotto.
   *
   * Il nome non è un attributo del preset ma l'identità della riga, come lo SKU
   * e la categoria. Trattarlo da attributo è la ragione per cui è sparito:
   * l'import cercava un attributo `product_name` che non è mai esistito, e il
   * ripiego «chiamalo come il suo codice» scattava per ogni prodotto.
   */
  nameHeader?: string;
  attributeMapping: Record<string, string>; // attributeId -> header
  /** Colonna del file che contiene la categoria merceologica (opzionale). */
  categoryHeader?: string;
  /** Rimappatura manuale dei valori categoria non riconosciuti: valore file → categoryId. */
  categoryOverrides?: Record<string, string>;
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
  const categoryScope = await loadPresetCategoryScope(service, orgId, presetVersionId);
  const categoryEntries = categoryScope.entries;
  const sectorId = categoryScope.sectorId;
  const matchCategoryId = makeCategoryMatcher(categoryEntries);
  const catNameById = new Map(categoryEntries.map((e) => [e.id, e.name] as const));
  let categoriesMatched = 0;
  // Quanti prodotti hanno perso i fatti per un errore di scrittura (deve restare 0).
  let factsInsertErrors = 0;
  /** Prodotti rimasti col codice al posto del nome: va detto a chi importa. */
  let senzaNome = 0;
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

  // Pulisci import precedenti dello stesso batch (re-import). Se la pulizia
  // non passa, i nuovi inserimenti sbattono contro la unique (batch, sku) e
  // l'import finisce a zero prodotti dichiarando di essere riuscito.
  const ripulito = await mustWrite('products.delete', service.from('products').delete().eq('batch_id', input.batchId));
  if (!ripulito.ok) return fail(`Import precedente non rimosso: ${ripulito.error}`);

  let imported = 0;
  let valid = 0;
  let invalid = 0;
  const scartate: RigaScartata[] = [];
  const segnaScarto = (sku: string | null, motivo: RigaScartata['motivo']) => {
    if (scartate.length < MAX_SCARTATE) scartate.push({ sku, motivo });
  };
  let imageOnly = 0;
  const importedSkus = new Set<string>();
  // sku -> id del prodotto ricreato (per ripristinare i fatti confermati).
  const newProductIdBySku = new Map<string, string>();

  // -------------------------------------------------------------------------
  // Import a LOTTI.
  // Prima si faceva una scrittura per prodotto, più una per i fatti e una per
  // i link immagine: su 500+ righe sono oltre 1500 round-trip e l'import
  // superava il tempo massimo della funzione. Ora si costruisce tutto in
  // memoria e si scrive a blocchi. Se un blocco fallisce si ripiega riga per
  // riga, così una sola riga malformata non fa perdere le altre del blocco.
  // -------------------------------------------------------------------------
  // I prodotti portano i JSON grezzi della riga: blocchi più piccoli per non
  // gonfiare la singola richiesta. Fatti e link sono righe sottili.
  const WRITE_CHUNK = 100;
  const THIN_CHUNK = 500;

  interface PendingProduct {
    sku: string;
    eligible: boolean;
    imageOnly: boolean;
    insert: Record<string, unknown>;
    pavRows: Array<{ attribute_id: string; value: string }>;
    pavSourceItemId: string | null;
    imgIds: string[];
  }
  const pending: PendingProduct[] = [];

  if (spreadsheet && input.skuHeader) {
    for (const row of spreadsheet.parsed.rows) {
      const skuRaw = row[input.skuHeader];
      if (validateRowSku(skuRaw) !== null) {
        invalid++;
        segnaScarto((skuRaw ?? '').trim() || null, 'codice non valido');
        continue;
      }
      const sku = (skuRaw ?? '').trim();
      if (importedSkus.has(sku)) {
        // SKU duplicato: la prima riga vince, le successive sono scartate.
        invalid++;
        segnaScarto(sku, 'codice ripetuto nel file');
        continue;
      }

      // Costruisci gli attributi canonici (bridge) e le righe PAV.
      const canonical: Record<string, string> = { sku };
      const pavRows: Array<{ attribute_id: string; value: string }> = [];
      // Un attributo può avere un solo valore per prodotto (vincolo unico sul
      // database): il primo trovato vince. Senza questo controllo due colonne
      // che puntano allo stesso attributo farebbero rifiutare tutti i fatti.
      const seenAttributes = new Set<string>();
      const addFact = (attributeId: string, value: string) => {
        if (seenAttributes.has(attributeId)) return;
        seenAttributes.add(attributeId);
        pavRows.push({ attribute_id: attributeId, value });
      };
      let name: string | null = null;
      let category: string | null = null;

      for (const [attributeId, header] of Object.entries(input.attributeMapping)) {
        if (!header) continue;
        // La colonna del nome non diventa anche un fatto: il nome e' l'identita'
        // della riga, non un dato del prodotto. Infilarlo fra i fatti farebbe
        // scrivere all'AI frasi sul titolo che sta scrivendo. L'interfaccia lo
        // impedisce gia', ma il wizard e' uno dei chiamanti, non l'unico.
        if (input.nameHeader && header === input.nameHeader) continue;
        const attr = attrById.get(attributeId);
        if (!attr) continue;
        const value = (row[header] ?? '').trim();
        if (value === '') continue;
        canonical[canonicalKey(attr)] = value;
        addFact(attributeId, value);
        if (attr.key === 'category' && !category) category = value;
      }
      // Colonne libere: ogni valore diventa un fatto passato all'AI.
      for (const [header, attr] of extraColMap) {
        const value = (row[header] ?? '').trim();
        if (value === '') continue;
        const ck = canonicalKey(attr);
        if (canonical[ck] !== undefined) continue; // già valorizzato altrove
        canonical[ck] = value;
        addFact(attr.id, value);
      }

      // La colonna Nome dedicata: è il modo esplicito con cui l'utente dice
      // come si chiama il prodotto. Prima non c'era e ci si ritrovava un
      // catalogo di codici a barre.
      if (input.nameHeader) {
        const nomeVal = (row[input.nameHeader] ?? '').trim();
        if (nomeVal) name = nomeVal;
      }

      // La colonna Categoria dedicata (se scelta) ha la priorità: è il modo
      // esplicito con cui l'utente assegna la categoria, indipendentemente dagli
      // attributi del preset.
      if (input.categoryHeader) {
        const catVal = (row[input.categoryHeader] ?? '').trim();
        if (catVal) category = catVal;
      }
      // Ripiego, non regola: senza una colonna nome il prodotto si chiama come
      // il suo codice. Prima era il caso normale, ora è l'eccezione — e il
      // conteggio qui sotto lo dice a chi importa.
      if (!name) {
        name = sku;
        senzaNome++;
      }

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
        segnaScarto(sku || null, 'dati insufficienti');
        continue;
      }

      // Collega il prodotto alla categoria merceologica dell'org. Prima la
      // rimappatura manuale (override dell'utente), poi il match robusto.
      let categoryId: string | null = null;
      if (category) {
        const override = input.categoryOverrides?.[category.trim()];
        if (override) {
          categoryId = override;
          categoriesMatched++;
        } else {
          const matched = matchCategoryId(category);
          if (matched) {
            categoryId = matched;
            categoriesMatched++;
          } else {
            unmatchedCategories.add(category.trim());
          }
        }
        // Mostra il nome del catalogo quando la categoria è stata risolta.
        if (categoryId) category = catNameById.get(categoryId) ?? category;
      }

      importedSkus.add(sku);
      pending.push({
        sku,
        eligible,
        imageOnly: false,
        insert: {
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
        },
        pavRows,
        pavSourceItemId: spreadsheet.sourceItemId,
        // Link alle immagini con SKU corrispondente (match esatto).
        imgIds: imageBySku.get(sku) ?? [],
      });
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

      importedSkus.add(sku);
      pending.push({
        sku,
        eligible: false,
        imageOnly: true,
        insert: {
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
        },
        pavRows: [],
        pavSourceItemId: null,
        imgIds,
      });
    }
  }

  // --- Le varianti smettono di essere prodotti -----------------------------
  //
  // Fin qui ogni riga del file è un prodotto. Ma otto righe che dichiarano lo
  // stesso codice padre sono UN articolo in otto colori: come otto prodotti
  // costano otto crediti e producono otto descrizioni quasi identiche, che
  // sulle pagine del cliente sono contenuto duplicato.
  //
  // Il modello a due livelli c'era già nello schema — `product_variants`,
  // `parent_external_id` — e non lo usava nessuno: la colonna veniva scritta e
  // letta solo dall'export, come colonna. Qui diventa una struttura.
  //
  // Del prodotto restano SOLO i fatti veri per tutte le sue varianti. Quelli su
  // cui le varianti differiscono sono, per definizione, ciò che le distingue, e
  // scendono alla variante: se salissero, la scheda direbbe «rosso» anche del
  // blu, e nessun controllo a valle se ne accorgerebbe.
  const varianti: Array<{ skuProdotto: string; righe: VarianteUnita[] }> = [];
  {
    const perSku = new Map<string, PendingProduct>();
    for (const p of pending) perSku.set(p.sku, p);

    const uniti = unisciVarianti(
      pending.map((p) => ({
        sku: p.sku,
        externalId: String(p.insert.external_id ?? p.sku),
        parentExternalId: (p.insert.parent_external_id as string | null) ?? null,
        name: String(p.insert.name ?? p.sku),
        category: (p.insert.category as string | null) ?? null,
        canonicalAttributes: (p.insert.canonical_attributes_json ?? {}) as Record<string, string>,
      })),
    );

    const nuovo: PendingProduct[] = [];
    for (const u of uniti) {
      const righe = u.skuOriginali.map((s) => perSku.get(s)).filter((p): p is PendingProduct => !!p);
      if (righe.length === 0) continue;
      if (u.varianti.length === 0) {
        nuovo.push(righe[0]!);
        continue;
      }

      const rappresentante = perSku.get(u.sku) ?? righe[0]!;
      const righeVarianti = righe.filter((r) => r.sku !== u.sku);
      const rigaPadre = perSku.get(u.sku) ?? null;

      // Stessa regola dei fatti canonici, applicata ai fatti veri e propri:
      // un attributo sale al prodotto solo se TUTTE le varianti lo portano con
      // lo stesso identico valore. Più quelli dichiarati sulla riga del padre,
      // che sono del prodotto perché ce li ha messi il cliente.
      const conteggio = new Map<string, { n: number; row: { attribute_id: string; value: string } }>();
      for (const r of righeVarianti) {
        for (const pav of r.pavRows) {
          const k = `${pav.attribute_id}\u0000${pav.value}`;
          const v = conteggio.get(k);
          if (v) v.n++;
          else conteggio.set(k, { n: 1, row: pav });
        }
      }
      const pavComuni = [...conteggio.values()]
        .filter((v) => v.n === righeVarianti.length)
        .map((v) => v.row);
      const giaPresenti = new Set(pavComuni.map((p) => p.attribute_id));
      for (const pav of rigaPadre?.pavRows ?? []) {
        if (!giaPresenti.has(pav.attribute_id)) pavComuni.push(pav);
      }

      nuovo.push({
        ...rappresentante,
        sku: u.sku,
        eligible: righe.some((r) => r.eligible),
        imageOnly: righe.every((r) => r.imageOnly),
        insert: {
          ...rappresentante.insert,
          sku: u.sku,
          external_id: u.externalId,
          name: u.name,
          category: u.category,
          parent_external_id: null,
          canonical_attributes_json: u.canonicalAttributes as unknown as Json,
        },
        pavRows: pavComuni,
        // Le foto di tutte le varianti restano al prodotto: assegnarle alla
        // singola variante richiede che la fonte dichiari a quale colore
        // appartengono, e nessuna delle fonti attuali lo dichiara.
        imgIds: [...new Set(righe.flatMap((r) => r.imgIds))],
      });
      varianti.push({ skuProdotto: u.sku, righe: u.varianti });
    }

    pending.length = 0;
    pending.push(...nuovo);
  }

  // --- Scrittura a blocchi -------------------------------------------------
  {
    const idBySku = new Map<string, string>();
    for (const slice of chunk(pending, WRITE_CHUNK)) {
      const { data, error } = await service
        .from('products')
        .insert(slice.map((p) => p.insert))
        .select('id, sku');
      if (error) {
        // Il blocco è saltato per colpa di UNA riga: riprova una per una così
        // le altre entrano comunque.
        console.error(`[import] blocco prodotti rifiutato, ripiego riga per riga: ${error.message}`);
        for (const p of slice) {
          const { data: one } = await service
            .from('products')
            .insert(p.insert)
            .select('id, sku')
            .maybeSingle();
          if (one?.id && one.sku) idBySku.set(one.sku, one.id);
        }
        continue;
      }
      for (const r of data ?? []) if (r.sku) idBySku.set(r.sku, r.id);
    }

    const inserted = pending.filter((p) => idBySku.has(p.sku));
    for (const p of inserted) {
      const id = idBySku.get(p.sku);
      if (!id) continue;
      imported++;
      newProductIdBySku.set(p.sku, id);
      // Conta gli idonei con la STESSA eleggibilità usata per verification_status
      // (sku + ≥2 fatti, incluse le colonne libere). computeQuality è tarato sui
      // campi moda e dava 0 idonei sui cataloghi food → conteggio errato.
      if (p.imageOnly) {
        imageOnly++;
        invalid++;
      } else if (p.eligible) {
        valid++;
      } else {
        invalid++;
      }
    }
    invalid += pending.length - inserted.length;

    // Le varianti. Senza questa scrittura il raggruppamento sarebbe solo un
    // risparmio: il catalogo saprebbe di avere un prodotto e avrebbe perso i
    // codici delle sue otto colorazioni, che sono ciò che il cliente vende.
    const righeVarianti = varianti.flatMap((v) => {
      const productId = idBySku.get(v.skuProdotto);
      if (!productId) return [];
      return v.righe.map((r) => ({
        product_id: productId,
        external_id: r.externalId,
        sku: r.sku,
        color: r.attributiVariante['color'] ?? r.attributiVariante['colore'] ?? null,
        size: r.attributiVariante['size'] ?? r.attributiVariante['taglia'] ?? null,
        variant_attributes_json: r.attributiVariante as unknown as Json,
      }));
    });
    for (const slice of chunk(righeVarianti, THIN_CHUNK)) {
      await writeOrTrace(
        service,
        'product_variants.insert(import)',
        service.from('product_variants').insert(slice),
        { organizationId: orgId, batchId: input.batchId },
      );
    }

    // I FATTI sono il cuore della generazione: se l'insert fallisce il prodotto
    // resta senza dati ("informazioni non sufficienti"). Logghiamo l'errore
    // invece di perderlo in silenzio.
    const pavAll = inserted.flatMap((p) =>
      p.pavRows.map((r) => ({
        organization_id: orgId,
        product_id: idBySku.get(p.sku) as string,
        attribute_id: r.attribute_id,
        value_json: r.value as unknown as Json,
        status: 'provided',
        source_type: 'spreadsheet',
        source_item_id: p.pavSourceItemId,
      })),
    );
    for (const slice of chunk(pavAll, THIN_CHUNK)) {
      const { error } = await service.from('product_attribute_values').insert(slice);
      if (!error) continue;
      // Una riga rifiutata annulla l'intero blocco: riprova prodotto per
      // prodotto, così resta senza fatti solo quello davvero problematico.
      console.error(`[import] blocco fatti rifiutato, ripiego per prodotto: ${error.message}`);
      const byProduct = new Map<string, typeof slice>();
      for (const r of slice) {
        const group = byProduct.get(r.product_id);
        if (group) group.push(r);
        else byProduct.set(r.product_id, [r]);
      }
      for (const [productId, rows] of byProduct) {
        // Ultimo tentativo: se anche questo non passa il prodotto resta senza
        // fatti, cioe' senza niente da cui scrivere. Va a verbale.
        const salvati = await writeOrTrace(
          service,
          'product_attribute_values.insert(import)',
          service.from('product_attribute_values').insert(rows),
          { organizationId: orgId, batchId: input.batchId, refId: productId },
        );
        if (!salvati) factsInsertErrors++;
      }
    }

    const linkAll = inserted.flatMap((p) =>
      p.imgIds.map((sourceItemId) => ({
        organization_id: orgId,
        product_id: idBySku.get(p.sku) as string,
        source_item_id: sourceItemId,
        link_type: 'sku_exact',
      })),
    );
    for (const slice of chunk(linkAll, THIN_CHUNK)) {
      // Senza il collegamento la foto e' caricata ma nessuno la trova: niente
      // analisi visiva, niente immagine nella scheda.
      await writeOrTrace(
        service,
        'product_source_links.insert(import)',
        service.from('product_source_links').insert(slice),
        { organizationId: orgId, batchId: input.batchId, refId: null },
      );
    }
  }

  // Ripristina i fatti confermati/rifiutati a mano sul prodotto ricreato con lo
  // stesso SKU. Se il re-import ha già inserito una PAV per quello stesso
  // attributo (da spreadsheet, status 'provided'), la sovrascrive con lo stato
  // più forte confermato dall'utente; altrimenti la reinserisce.
  // Anche qui a lotti: una lettura sola per sapere cosa esiste già, poi un
  // inserimento a blocchi per i mancanti (gli aggiornamenti restano puntuali,
  // ma sono pochi: solo i fatti già riscritti dal file).
  {
    const restorable = confirmedSnapshots
      .map((snap) => ({ snap, productId: newProductIdBySku.get(snap.sku) }))
      .filter((r): r is { snap: PavSnapshot; productId: string } => Boolean(r.productId));

    const existingIdByKey = new Map<string, string>();
    const productIds = [...new Set(restorable.map((r) => r.productId))];
    for (const slice of chunk(productIds, THIN_CHUNK)) {
      const { data } = await service
        .from('product_attribute_values')
        .select('id, product_id, attribute_id')
        .in('product_id', slice);
      for (const r of data ?? []) existingIdByKey.set(`${r.product_id}|${r.attribute_id}`, r.id);
    }

    const toInsert: Array<Record<string, unknown>> = [];
    for (const { snap, productId } of restorable) {
      const existingId = existingIdByKey.get(`${productId}|${snap.attribute_id}`);
      if (existingId) {
        // Sono le conferme fatte a mano dall'utente: perderle in silenzio
        // significa fargli rifare il lavoro senza dirglielo.
        await writeOrTrace(
          service,
          'product_attribute_values.update(ripristino)',
          service.from('product_attribute_values')
            .update({ status: snap.status, value_json: snap.value_json })
            .eq('id', existingId),
          { organizationId: orgId, batchId: input.batchId, refId: productId },
        );
      } else {
        toInsert.push({
          organization_id: orgId,
          product_id: productId,
          attribute_id: snap.attribute_id,
          value_json: snap.value_json,
          status: snap.status,
          source_type: snap.source_type ?? 'image',
          source_item_id: snap.source_item_id,
        });
      }
    }
    for (const slice of chunk(toInsert, THIN_CHUNK)) {
      await writeOrTrace(
        service,
        'product_attribute_values.insert(ripristino)',
        service.from('product_attribute_values').insert(slice),
        { organizationId: orgId, batchId: input.batchId, refId: null },
      );
    }
  }

  // Senza questo passaggio il batch resta indietro di un passo e il wizard
  // riporta l'utente alla mappatura che ha appena confermato.
  const avanzato = await mustWrite('batches.update', service
    .from('batches')
    .update({
      status: 'input_review',
      total_products: imported,
      valid_products: valid,
      invalid_products: invalid,
    })
    .eq('id', input.batchId));
  if (!avanzato.ok) return fail(`Stato del batch non aggiornato: ${avanzato.error}`);

  const unmatched = [...unmatchedCategories];
  await logWrite('app_events.insert', service.from('app_events').insert({
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
      // Tracciato nello storico: se >0 alcuni prodotti sono senza fatti.
      factsInsertErrors,
    },
  }));

  return ok({
    imported,
    valid,
    invalid,
    imageOnly,
    // Prodotti entrati senza fatti perche' la scrittura e' stata rifiutata:
    // finiva solo nella telemetria, quindi l'utente non lo sapeva.
    factsInsertErrors,
    /** Prodotti che si chiamano come il loro codice: manca la colonna nome. */
    senzaNome,
    categoriesMatched,
    unmatchedCategories: unmatched.slice(0, 50),
    scartate,
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

/** Categorie del preset del batch (per la mappatura manuale). */
export async function getBatchCategoryOptions(input: {
  batchId: string;
}): Promise<
  ActionResult<{ categories: Array<{ id: string; name: string }>; fromPreset: boolean }>
> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();
  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', input.batchId)
    .maybeSingle();
  const scope = await loadPresetCategoryScope(service, orgId, batch?.preset_version_id ?? null);
  const categories = scope.entries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  return ok({ categories, fromPreset: scope.fromPreset });
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
    // La categoria deve appartenere al preset del batch: altrimenti il prodotto
    // finirebbe in una categoria senza attributi, e la generazione non avrebbe
    // nulla da estrarre.
    const { data: batch } = await service
      .from('batches')
      .select('preset_version_id')
      .eq('id', input.batchId)
      .maybeSingle();
    const scope = await loadPresetCategoryScope(service, orgId, batch?.preset_version_id ?? null);
    const cat = scope.entries.find((c) => c.id === input.categoryId);
    if (!cat) return fail('Categoria non presente nel preset di questo batch');
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

// ---------------------------------------------------------------------------
// Il contesto comune agli import "un documento = un prodotto" (URL e PDF).
//
// Prima stava tutto dentro importFromUrls. Quando è arrivato l'import da PDF
// la scelta era copiare centosessanta righe o estrarle: copiate, avrebbero
// smesso di somigliarsi alla prima correzione fatta da una parte sola.
// ---------------------------------------------------------------------------

interface ContestoImport {
  presetVersionId: string | null;
  attrById: Map<string, PresetAttributeOption>;
  categoryIdByName: Map<string, string>;
  /** Uno SKU libero nel batch: aggiunge -2, -3… finché non collide più. */
  skuUnico(base: string): string;
  /** Trova o crea l'attributo fattuale con questo nome, nel settore del preset. */
  risolviAttributoFattuale(name: string): Promise<PresetAttributeOption | null>;
}

async function creaContestoImport(
  service: ReturnType<typeof getServiceClient>,
  orgId: string,
  batchId: string,
): Promise<ContestoImport> {
  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', batchId)
    .maybeSingle();
  const presetVersionId = batch?.preset_version_id ?? null;
  const presetAttrs = presetVersionId ? await loadPresetAttributes(service, presetVersionId) : [];
  const attrById = new Map(presetAttrs.map((a) => [a.id, a]));

  const scope = await loadPresetCategoryScope(service, orgId, presetVersionId);
  const sectorId = scope.sectorId;
  const categoryIdByName = new Map(
    scope.entries.map((c) => [normalizeCategoryName(c.name), c.id] as const),
  );

  // SKU già presenti nel batch: evita collisioni con l'unicità (batch, external_id).
  const takenSkus = new Set<string>();
  {
    const { data: existing } = await service.from('products').select('sku').eq('batch_id', batchId);
    for (const p of existing ?? []) if (p.sku) takenSkus.add(p.sku);
  }

  const factCache = new Map<string, PresetAttributeOption | null>();

  return {
    presetVersionId,
    attrById,
    categoryIdByName,
    skuUnico(base: string): string {
      let sku = base.slice(0, 64);
      if (takenSkus.has(sku)) {
        let n = 2;
        while (takenSkus.has(`${sku}-${n}`)) n++;
        sku = `${sku}-${n}`;
      }
      takenSkus.add(sku);
      return sku;
    },
    async risolviAttributoFattuale(name: string): Promise<PresetAttributeOption | null> {
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
    },
  };
}

/**
 * Crea il prodotto e i suoi fatti a partire da coppie etichetta → valore.
 * `facts` sono i FATTI dichiarati dalla fonte: qui non si inventa niente, si
 * risolve ogni etichetta in un attributo e si scrive il valore com'è.
 */
async function creaProdottoDaiFatti(
  service: ReturnType<typeof getServiceClient>,
  args: {
    orgId: string;
    batchId: string;
    ctx: ContestoImport;
    sku: string;
    name: string;
    facts: Record<string, string>;
    /** Cosa è stato ricevuto in ingresso: l'URL, il nome del file PDF… */
    rawInput: Record<string, string>;
    /** Finisce in product_attribute_values.source_type: 'url', 'pdf', … */
    sourceType: string;
    hasImages: boolean;
  },
): Promise<{ ok: true; productId: string; eligible: boolean } | { ok: false; error: string }> {
  const { orgId, batchId, ctx, sku, name, facts, sourceType } = args;

  const canonical: Record<string, string> = { sku };
  const pavRows: Array<{ attribute_id: string; value: string }> = [];
  const category: string | null = facts['Categoria'] ?? null;

  for (const [etichetta, valore] of Object.entries(facts)) {
    const v = (valore ?? '').trim();
    if (!v || etichetta.toLowerCase() === 'categoria') continue;
    const attr = await ctx.risolviAttributoFattuale(etichetta);
    if (!attr) continue;
    const ck = canonicalKey(attr);
    if (canonical[ck] !== undefined) continue;
    canonical[ck] = v;
    pavRows.push({ attribute_id: attr.id, value: v });
  }

  const built: BuiltProduct = {
    externalId: sku,
    parentExternalId: null,
    name,
    productType: null,
    category,
    sku,
    rawInput: args.rawInput,
    canonicalAttributes: canonical,
    facts: [],
  };
  const quality = computeQuality(built, { hasImages: args.hasImages });
  const additionalFacts = pavRows.filter((p) => {
    const a = ctx.attrById.get(p.attribute_id);
    return !a || !a.key || !NON_ADDITIONAL_FIELDS.has(a.key);
  }).length;
  const eligible = Boolean(sku) && additionalFacts >= 2;

  const categoryId = category ? (ctx.categoryIdByName.get(normalizeCategoryName(category)) ?? null) : null;

  const { data: productRow, error: pErr } = await service
    .from('products')
    .insert({
      organization_id: orgId,
      batch_id: batchId,
      sku,
      name,
      category,
      category_id: categoryId,
      preset_version_id: ctx.presetVersionId,
      external_id: sku,
      raw_input_json: args.rawInput as unknown as Json,
      canonical_attributes_json: canonical as unknown as Json,
      data_quality_score: quality.score,
      verification_status: eligible ? 'eligible' : 'excluded',
    })
    .select('id')
    .single();
  if (pErr || !productRow) {
    return { ok: false, error: `Creazione prodotto fallita: ${pErr?.message ?? 'sconosciuto'}` };
  }

  if (pavRows.length > 0) {
    // I fatti sono la ragione per cui il prodotto e' generabile: se non
    // arrivano, il prodotto risulta importato ma non ha niente da dire.
    await writeOrTrace(
      service,
      `product_attribute_values.insert(${sourceType})`,
      service.from('product_attribute_values').insert(
        pavRows.map((r) => ({
          organization_id: orgId,
          product_id: productRow.id,
          attribute_id: r.attribute_id,
          value_json: r.value as unknown as Json,
          status: 'provided',
          source_type: sourceType,
        })),
      ),
      { organizationId: orgId, batchId, refId: productRow.id },
    );
  }

  return { ok: true, productId: productRow.id, eligible };
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

  const ctx = await creaContestoImport(service, orgId, input.batchId);

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

    const base = (data.sku ? sanitizeFilename(data.sku).replace(/\.[a-z0-9]+$/i, '') : '').trim() || slugFromUrl(url, i);
    const sku = ctx.skuUnico(base);

    const facts: Record<string, string> = { ...data.attributes };
    if (data.brand) facts['Brand'] = data.brand;
    if (data.price) facts['Prezzo'] = data.price;

    const creato = await creaProdottoDaiFatti(service, {
      orgId,
      batchId: input.batchId,
      ctx,
      sku,
      name: data.name ?? sku,
      facts,
      rawInput: { url },
      sourceType: 'url',
      hasImages: data.imageUrls.length > 0,
    });
    if (!creato.ok) {
      failures.push({ url, reason: creato.error });
      continue;
    }
    const productRow = { id: creato.productId };
    imported++;
    if (creato.eligible) valid++;

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
      // Senza il collegamento la foto e' a database ma nessuno la trova:
      // niente analisi visiva, niente immagine nella scheda.
      await writeOrTrace(
        service,
        'product_source_links.insert(url)',
        service.from('product_source_links').insert({
          organization_id: orgId,
          product_id: productRow.id,
          source_item_id: si.id,
          link_type: 'sku_exact',
        }),
        { organizationId: orgId, batchId: input.batchId, refId: productRow.id },
      );
      imagesAttached++;
    }
  }

  if (imageBatchSourceId) {
    await writeOrTrace(
      service,
      'batch_sources.update(pronta)',
      service.from('batch_sources').update({ status: 'ready' }).eq('id', imageBatchSourceId),
      { organizationId: orgId, batchId: input.batchId, refId: imageBatchSourceId },
    );
  }

  // Porta il batch in revisione dati, come confirmImportV2, così i passi
  // successivi (campione → generazione) funzionano senza modifiche.
  if (imported > 0) {
    const avanzatoUrl = await mustWrite('batches.update', service
      .from('batches')
      .update({ status: 'input_review', total_products: imported, valid_products: valid, invalid_products: imported - valid })
      .eq('id', input.batchId));
    if (!avanzatoUrl.ok) return fail(`Stato del batch non aggiornato: ${avanzatoUrl.error}`);
    await logWrite('app_events.insert', service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'url_import_confirmed',
      batch_id: input.batchId,
      metadata_json: { imported, valid, imagesAttached, failed: failures.length } as unknown as Json,
    }));
  }

  return ok({ imported, failed: failures.length, imagesAttached, failures: failures.slice(0, 20) });
}

// ---------------------------------------------------------------------------
// IMPORT DA PDF (schede tecniche: un documento = un prodotto).
//
// Il PDF viene letto come TESTO (apps/web/lib/pdf.ts), e dal testo si prendono
// solo le coppie etichetta → valore dichiarate nel documento
// (extractProductFromPdfText, in @app/core). La prosa del fornitore non entra:
// la scheda la riscrive l'AI dai fatti, come per tutte le altre fonti.
//
// Il file resta allegato al prodotto (source_files / source_items /
// product_source_links), così chi verifica un dato può aprire il documento da
// cui è stato letto. Il mime è `application/pdf`, quindi la pipeline visiva —
// che filtra per `image/*` — lo ignora: nessuna foto finta da analizzare.
// ---------------------------------------------------------------------------

const PDF_SOURCE = 'pdf_upload';
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PER_UPLOAD = 50;

export interface PdfImportResult {
  imported: number;
  failed: number;
  /** Importati ma con meno di due fatti: la scheda non si può ancora generare. */
  senzaFatti: number;
  failures: Array<{ file: string; reason: string }>;
}

export async function importFromPdfs(formData: FormData): Promise<ActionResult<PdfImportResult>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const batchId = String(formData.get('batchId') ?? '');
  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return fail('Batch non accessibile');

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return fail('Nessun PDF caricato.');
  if (files.length > MAX_PDF_PER_UPLOAD) {
    return fail(`Troppi PDF in un solo caricamento (massimo ${MAX_PDF_PER_UPLOAD}). Caricali a blocchi.`);
  }

  const service = getServiceClient();
  const ctx = await creaContestoImport(service, orgId, batchId);
  const bucket = STORAGE_BUCKETS.sourceFiles;

  const failures: Array<{ file: string; reason: string }> = [];
  let imported = 0;
  let valid = 0;
  let batchSourceId: string | null = null;

  for (const file of files) {
    if (extname(file.name).toLowerCase() !== '.pdf') {
      failures.push({ file: file.name, reason: 'Non è un PDF.' });
      continue;
    }
    if (file.size > MAX_PDF_BYTES) {
      failures.push({ file: file.name, reason: `Troppo grande (massimo ${MAX_PDF_BYTES / (1024 * 1024)} MB).` });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Si legge PRIMA di salvare: un file illeggibile non ha motivo di occupare
    // spazio su storage per sempre. È la stessa regola dello spreadsheet.
    const testo = await estraiTestoDaPdf(new Uint8Array(buffer));
    if (!testo.ok) {
      failures.push({ file: file.name, reason: testo.error });
      continue;
    }
    if (testo.testo.trim().length === 0) {
      failures.push({
        file: file.name,
        reason: 'Il PDF non contiene testo: è una scansione. Serve un PDF con testo selezionabile.',
      });
      continue;
    }

    const dati = extractProductFromPdfText(testo.testo, {
      titoloProbabile: testo.titoloProbabile,
      filename: file.name,
    });
    if (!dati.name && !dati.sku) {
      failures.push({ file: file.name, reason: 'Nessun nome né codice articolo riconosciuto nel documento.' });
      continue;
    }

    const base = (dati.sku ? sanitizeFilename(dati.sku).replace(/\.[a-z0-9]+$/i, '') : '').trim();
    const sku = ctx.skuUnico(base || sanitizeFilename(file.name).replace(/\.pdf$/i, ''));

    // Le stesse etichette dell'import da URL: «Brand» e «Prezzo». Scriverne
    // altre creerebbe attributi gemelli, e lo stesso dato finirebbe in due
    // campi diversi a seconda di come è entrato.
    const facts: Record<string, string> = { ...dati.attributes };
    if (dati.brand) facts['Brand'] = dati.brand;
    if (dati.price) facts['Prezzo'] = dati.price;

    const creato = await creaProdottoDaiFatti(service, {
      orgId,
      batchId,
      ctx,
      sku,
      name: dati.name ?? sku,
      facts,
      rawInput: { pdf: file.name },
      sourceType: 'pdf',
      hasImages: false,
    });
    if (!creato.ok) {
      failures.push({ file: file.name, reason: creato.error });
      continue;
    }
    imported++;
    if (creato.eligible) valid++;

    // Il documento resta allegato: è la prova di ogni fatto letto.
    const salvato = await persistSourceFile(service, orgId, batchId, bucket, file, buffer, '.pdf');
    if ('error' in salvato) continue;
    if (!batchSourceId) batchSourceId = await getOrCreateBatchSource(service, orgId, batchId, PDF_SOURCE);
    if (!batchSourceId) continue;
    const { data: si } = await service
      .from('source_items')
      .insert({
        organization_id: orgId,
        batch_source_id: batchSourceId,
        source_file_id: salvato.id,
        filename: file.name,
        mime_type: 'application/pdf',
        size_bytes: buffer.byteLength,
        detected_sku: sku,
        status: 'valid',
        metadata_json: {
          pagine: testo.pagine,
          troncato: testo.troncato,
          righeRiconosciute: dati.righeRiconosciute,
          righeTotali: dati.righeTotali,
          origineNome: dati.source,
        } as unknown as Json,
      })
      .select('id')
      .single();
    if (!si) continue;
    await writeOrTrace(
      service,
      'product_source_links.insert(pdf)',
      service.from('product_source_links').insert({
        organization_id: orgId,
        product_id: creato.productId,
        source_item_id: si.id,
        link_type: 'pdf_source',
      }),
      { organizationId: orgId, batchId, refId: creato.productId },
    );
  }

  if (batchSourceId) {
    await writeOrTrace(
      service,
      'batch_sources.update(pronta)',
      service.from('batch_sources').update({ status: 'ready' }).eq('id', batchSourceId),
      { organizationId: orgId, batchId, refId: batchSourceId },
    );
  }

  if (imported > 0) {
    const avanzato = await mustWrite(
      'batches.update',
      service
        .from('batches')
        .update({
          status: 'input_review',
          source_type: 'pdf',
          total_products: imported,
          valid_products: valid,
          invalid_products: imported - valid,
        })
        .eq('id', batchId),
    );
    if (!avanzato.ok) return fail(`Stato del batch non aggiornato: ${avanzato.error}`);
    await logWrite(
      'app_events.insert',
      service.from('app_events').insert({
        organization_id: orgId,
        user_id: user.id,
        event_name: 'pdf_import_confirmed',
        batch_id: batchId,
        metadata_json: { imported, valid, failed: failures.length } as unknown as Json,
      }),
    );
  }

  return {
    ok: true,
    data: { imported, failed: failures.length, senzaFatti: imported - valid, failures: failures.slice(0, 20) },
  };
}

// ---------------------------------------------------------------------------
// FONTE «LISTA SKU»: dal codice al prodotto.
//
// Lo SKU è un codice pubblico assegnato dal produttore: identifica l'articolo
// anche fuori dal gestionale del cliente, quindi è direttamente la chiave di
// ricerca. Si cerca quello, non una descrizione.
//
// Si risolve a livello di PRODOTTO, non di variante: otto codici colore dello
// stesso modello puntano alla stessa pagina, e risolverli otto volte vorrebbe
// dire pagare otto ricerche per leggere otto volte le stesse cose — con in più
// il rischio che due di quelle otto si aggancino a pagine diverse e il prodotto
// finisca con fatti in contraddizione con sé stesso.
//
// Niente qui decide da solo: identità incerta vuol dire coda di conferma, e i
// campi non si scrivono finché non è risolta.
// ---------------------------------------------------------------------------

const SKU_LIST_SOURCE = 'sku_list';

export interface AnteprimaListaSku {
  skuCaricati: number;
  prodotti: number;
  varianti: number;
  /** La regola proposta, se ce n'è una che regge. */
  regola: string | null;
  forza: number;
  motivi: string[];
  creditiConRaggruppamento: number;
  creditiSenzaRaggruppamento: number;
  /** Quante ricerche verranno fatte: una per prodotto. */
  risoluzioni: number;
}

/**
 * Cosa succederebbe con questa lista, prima di spendere.
 *
 * È qui che il cliente vede il vantaggio del raggruppamento in cifre, e va
 * mostrato qui e non spiegato altrove: è l'unico momento in cui il numero
 * cambia una sua decisione.
 */
export async function anteprimaListaSku(input: {
  batchId: string;
  testo?: string;
  /** Le righe già mappate dal foglio, in alternativa al testo incollato. */
  righeFoglio?: Array<Record<string, string>>;
  mappatura?: MappaturaListaSku;
  raggruppa: boolean;
}): Promise<ActionResult<AnteprimaListaSku>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');

  const righe = righeDellaLista(input);
  if (righe.length === 0) return fail('Nessun codice da importare.');

  const codici = righe.map((r) => r.sku);
  // Il codice modello dichiarato in colonna È la verità e non si indovina: solo
  // quando manca si prova a ricavare una regola dai codici.
  const conModello = righe.filter((r) => r.codiceModello);
  const proposta = conModello.length > 0 ? null : proponiRaggruppamento(codici);
  const gruppiDichiarati = new Set(conModello.map((r) => r.codiceModello as string)).size;
  const prodotti = !input.raggruppa
    ? codici.length
    : conModello.length > 0
      ? gruppiDichiarati + (codici.length - conModello.length)
      : (proposta?.prodotti ?? codici.length);
  const varianti = input.raggruppa ? codici.length - prodotti : 0;
  const costi = anteprimaCosti(codici.length, prodotti);

  return ok({
    skuCaricati: codici.length,
    prodotti,
    varianti,
    regola: conModello.length > 0 ? 'Codice modello dichiarato nel file' : (proposta?.regola.descrizione ?? null),
    forza: conModello.length > 0 ? 1 : (proposta?.forza ?? 0),
    motivi:
      conModello.length > 0
        ? ['Il raggruppamento viene dalla colonna del file: non c’è niente da indovinare.']
        : (proposta?.motivi ?? []),
    creditiConRaggruppamento: costi.creditiRaggruppati,
    creditiSenzaRaggruppamento: costi.creditiSenzaRaggruppamento,
    risoluzioni: prodotti,
  });
}

export interface FoglioListaSku {
  intestazioni: string[];
  /** Le prime righe, per far vedere all'utente cosa sta mappando. */
  anteprima: Array<Record<string, string>>;
  righeTotali: number;
  /** Solo un suggerimento: la mappatura la conferma l'utente. */
  suggerita: MappaturaListaSku;
  /** Le righe complete: tornano al client e poi all'import. */
  righe: Array<Record<string, string>>;
}

/**
 * Legge il foglio di codici e propone la mappatura. Non scrive niente.
 *
 * Il file NON viene salvato: contiene i codici del cliente e basta, e a
 * differenza di un listino non c'è niente da riesaminare dopo. Conservarlo
 * vorrebbe dire tenere dati che non servono a nessuno.
 */
export async function leggiFoglioListaSku(
  formData: FormData,
): Promise<ActionResult<FoglioListaSku>> {
  const batchId = String(formData.get('batchId') ?? '');
  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return fail('Batch non accessibile');

  const file = formData.getAll('files').find((f): f is File => f instanceof File);
  if (!file) return fail('Nessun file caricato.');
  const ext = extname(file.name).toLowerCase();
  if (ext !== '.csv' && ext !== '.xlsx') return fail('Formato non supportato: usa CSV o XLSX.');
  if (file.size > 20 * 1024 * 1024) return fail('File troppo grande (massimo 20 MB).');

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: ParseResult;
  try {
    parsed = ext === '.csv' ? parseCsv(buffer) : await parseXlsx(buffer);
  } catch (e) {
    return fail(`Lettura file fallita: ${e instanceof Error ? e.message : 'errore'}`);
  }
  if (parsed.rows.length === 0) {
    return fail(
      parsed.headers.length === 0
        ? 'Il file è vuoto.'
        : 'Il file ha solo la riga di intestazione, nessun codice.',
    );
  }

  return ok({
    intestazioni: parsed.headers,
    anteprima: parsed.rows.slice(0, 5),
    righeTotali: parsed.rows.length,
    suggerita: suggerisciColonneListaSku(parsed.headers),
    righe: parsed.rows.slice(0, MAX_RIGHE_FOGLIO),
  });
}

/** Oltre questo, il foglio non è una lista di codici: è un catalogo. */
const MAX_RIGHE_FOGLIO = 2000;

/**
 * Le righe da lavorare, incollate o mappate da un foglio.
 *
 * Un posto solo perché le due strade producano la stessa cosa: se divergessero,
 * lo stesso catalogo darebbe risultati diversi a seconda di come è entrato.
 */
function righeDellaLista(input: {
  testo?: string;
  righeFoglio?: Array<Record<string, string>>;
  mappatura?: MappaturaListaSku;
}): RigaListaSku[] {
  if (input.righeFoglio && input.mappatura) {
    return righeDaTabella(input.righeFoglio, input.mappatura);
  }
  return analizzaListaIncollata(input.testo ?? '');
}

// ---------------------------------------------------------------------------
// LA CODA A SCAGLIONI.
//
// Una lista di cinquecento codici sono cinquecento ricerche e almeno il doppio
// di pagine da leggere: non entra in una richiesta sola, e per un po' il codice
// se l'è cavata tagliando la lista a venticinque — con un commento che lo
// spiegava, che è il modo elegante di avere un prodotto che non fa quello che
// dice.
//
// Adesso la lavorazione si svolge in più giri:
//
//   avviaListaSku    mette in coda TUTTE le righe e non cerca niente;
//   proseguiListaSku ne lavora quante ne stanno nel tempo di una richiesta;
//   progressoListaSku dice a che punto è.
//
// Lo stato non sta nella pagina di chi ha lanciato la lavorazione: sta nel
// registro. Da lì viene la ripresa — chiudere il browser a metà costa il giro
// in corso e nient'altro — e da lì viene la cache, perché la stessa domanda
// fatta due volte si risponde una volta sola.
// ---------------------------------------------------------------------------

export interface ProgressoListaSku {
  /** Le righe messe in coda per questa lavorazione. */
  totale: number;
  /** Quelle che hanno una risposta, anche negativa. */
  fatte: number;
  inCoda: number;
  risolti: number;
  conRiserva: number;
  daConfermare: number;
  nonTrovati: number;
  /** Righe che aspettano un altro tentativo: NON sono prodotti inesistenti. */
  daRiprovare: number;
  /** Righe che hanno finito i tentativi e non verranno riprese da sole. */
  esaurite: number;
  /** Righe risposte con una ricerca già fatta invece che con una nuova. */
  riprese: number;
  importati: number;
  varianti: number;
  immaginiScaricate: number;
  /** Prodotti importati da cui non è arrivata nessuna foto: validi, ma senza. */
  senzaImmagini: number;
  /** `true` quando non c'è più niente da lavorare. */
  finita: boolean;
  failures: Array<{ sku: string; reason: string }>;
}

/**
 * A che punto è la lavorazione, letto dal registro.
 *
 * Tutto quello che serve a chi guarda viene da qui e non da un conteggio tenuto
 * in memoria durante il giro: un conteggio in memoria sparisce con la pagina, e
 * chi riapre la lavorazione il giorno dopo si vedrebbe una lista a zero pur
 * avendo quattrocento prodotti in catalogo.
 */
async function leggiProgresso(
  service: ReturnType<typeof getServiceClient>,
  batchId: string,
): Promise<ProgressoListaSku> {
  const { data: righe } = await service
    .from('sku_resolutions')
    .select('esito, tentativi, da_cache, motivo, codice_originale, sku_membri, product_id')
    .eq('batch_id', batchId)
    .order('creato_il', { ascending: true });

  const p: ProgressoListaSku = {
    totale: 0,
    fatte: 0,
    inCoda: 0,
    risolti: 0,
    conRiserva: 0,
    daConfermare: 0,
    nonTrovati: 0,
    daRiprovare: 0,
    esaurite: 0,
    riprese: 0,
    importati: 0,
    varianti: 0,
    immaginiScaricate: 0,
    senzaImmagini: 0,
    finita: true,
    failures: [],
  };

  for (const r of righe ?? []) {
    p.totale++;
    if (r.da_cache) p.riprese++;
    if (r.product_id) {
      p.importati++;
      const membri = (r.sku_membri ?? []).length;
      if (membri > 1) p.varianti += membri;
    }
    switch (r.esito) {
      case 'risolto':
        p.risolti++;
        break;
      case 'risolto-con-riserva':
        p.conRiserva++;
        break;
      case 'coda-conferma':
        p.daConfermare++;
        break;
      case 'non-trovato':
        p.nonTrovati++;
        if (r.motivo) p.failures.push({ sku: r.codice_originale, reason: r.motivo });
        break;
      case 'errore':
        if ((r.tentativi ?? 0) >= MAX_TENTATIVI) p.esaurite++;
        else p.daRiprovare++;
        if (r.motivo) p.failures.push({ sku: r.codice_originale, reason: r.motivo });
        break;
      default:
        p.inCoda++;
    }
    if (esitoDeciso(r.esito)) p.fatte++;
  }

  p.finita = p.inCoda === 0 && p.daRiprovare === 0;
  p.failures = p.failures.slice(0, 20);

  const foto = await contaFotoDaWeb(service, batchId);
  p.immaginiScaricate = foto.immagini;
  p.senzaImmagini = Math.max(0, p.importati - foto.prodottiConFoto);
  return p;
}

/** Quante foto sono arrivate dalle pagine, e quanti prodotti ne hanno almeno una. */
async function contaFotoDaWeb(
  service: ReturnType<typeof getServiceClient>,
  batchId: string,
): Promise<{ immagini: number; prodottiConFoto: number }> {
  const { data: sorgente } = await service
    .from('batch_sources')
    .select('id')
    .eq('batch_id', batchId)
    .eq('source_type', IMAGE_SOURCE)
    .limit(1)
    .maybeSingle();
  if (!sorgente) return { immagini: 0, prodottiConFoto: 0 };

  const { data: voci } = await service
    .from('source_items')
    .select('id')
    .eq('batch_source_id', sorgente.id);
  const ids = (voci ?? []).map((v) => v.id);
  if (ids.length === 0) return { immagini: 0, prodottiConFoto: 0 };

  const { data: link } = await service
    .from('product_source_links')
    .select('product_id')
    .in('source_item_id', ids);
  return {
    immagini: ids.length,
    prodottiConFoto: new Set((link ?? []).map((l) => l.product_id)).size,
  };
}

export async function progressoListaSku(input: {
  batchId: string;
}): Promise<ActionResult<ProgressoListaSku>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  return ok(await leggiProgresso(getServiceClient(), input.batchId));
}

/** Un elemento di lavoro: un prodotto, cioè UNA ricerca. */
interface VoceDiLavoro {
  codice: string;
  marca: string | null;
  sku: string[];
  domini: string[];
}

/**
 * Da una lista di codici agli elementi da cercare.
 *
 * Un gruppo di varianti = un prodotto = UNA ricerca. Otto codici colore dello
 * stesso modello puntano alla stessa pagina, e risolverli otto volte vorrebbe
 * dire pagare otto ricerche per leggere otto volte le stesse cose — con in più
 * il rischio che due di quelle otto si aggancino a pagine diverse e il prodotto
 * finisca con fatti in contraddizione con sé stesso.
 */
function pianificaLavoro(
  righe: RigaListaSku[],
  raggruppaVarianti: boolean,
  dominiLavorazione: string[],
): VoceDiLavoro[] {
  const perSku = new Map(righe.map((r) => [r.sku, r] as const));
  const dichiarati = righe.filter((r) => r.codiceModello);
  let gruppi: { gruppi: Array<{ codiceModello: string; sku: string[] }>; nonRaggruppati: string[] };

  // Se il file dichiara il codice modello, quella è la verità e non si indovina
  // niente. La regola derivata dai codici serve solo quando la colonna non c'è.
  if (!raggruppaVarianti) {
    gruppi = { gruppi: [], nonRaggruppati: righe.map((r) => r.sku) };
  } else if (dichiarati.length > 0) {
    const perModello = new Map<string, string[]>();
    const soli: string[] = [];
    for (const r of righe) {
      if (!r.codiceModello) {
        soli.push(r.sku);
        continue;
      }
      perModello.set(r.codiceModello, [...(perModello.get(r.codiceModello) ?? []), r.sku]);
    }
    const veri: Array<{ codiceModello: string; sku: string[] }> = [];
    for (const [codiceModello, sku] of perModello) {
      // Un modello con un figlio solo non è un gruppo: è un prodotto.
      if (sku.length >= 2) veri.push({ codiceModello, sku });
      else soli.push(...sku);
    }
    gruppi = { gruppi: veri, nonRaggruppati: soli };
  } else {
    const proposta = proponiRaggruppamento(righe.map((r) => r.sku));
    gruppi = proposta
      ? raggruppa(righe.map((r) => r.sku), proposta.regola)
      : { gruppi: [], nonRaggruppati: righe.map((r) => r.sku) };
  }

  // L'ambito dichiarato sulla riga vale INSIEME a quello della lavorazione: chi
  // lo scrive per riga di solito ha fornitori diversi per prodotti diversi.
  const ambitoDi = (sku: string[]): string[] => [
    ...new Set([...(dominiLavorazione ?? []), ...sku.flatMap((s) => perSku.get(s)?.domini ?? [])]),
  ];

  return [
    ...gruppi.gruppi.map((g) => ({
      codice: g.codiceModello,
      marca: perSku.get(g.sku[0]!)?.marca ?? null,
      sku: g.sku,
      domini: ambitoDi(g.sku),
    })),
    ...gruppi.nonRaggruppati.map((s) => ({
      codice: s,
      marca: perSku.get(s)?.marca ?? null,
      sku: [s],
      domini: ambitoDi([s]),
    })),
  ];
}

function aBlocchi<T>(elementi: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < elementi.length; i += n) out.push(elementi.slice(i, i + n));
  return out;
}

/**
 * Mette in coda la lista. Non cerca niente: torna subito.
 *
 * Rilanciarla sulla stessa lavorazione NON rifà quello che è già stato fatto —
 * le righe già in registro restano com'erano, comprese quelle già risolte. È
 * quello che rende innocuo il tasto «riprendi», e che evita che un doppio clic
 * paghi due volte la stessa ricerca.
 */
export async function avviaListaSku(input: {
  batchId: string;
  testo?: string;
  righeFoglio?: Array<Record<string, string>>;
  mappatura?: MappaturaListaSku;
  raggruppa: boolean;
  domini: string[];
}): Promise<ActionResult<ProgressoListaSku>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');

  const righe = righeDellaLista(input);
  if (righe.length === 0) return fail('Nessun codice da importare.');

  const service = getServiceClient();
  const lavoro = pianificaLavoro(righe, input.raggruppa, input.domini ?? []);

  const { data: gia } = await service
    .from('sku_resolutions')
    .select('codice_normalizzato, marca_normalizzata')
    .eq('batch_id', input.batchId);
  const viste = new Set(
    (gia ?? []).map((r) => `${r.codice_normalizzato}|${r.marca_normalizzata}`),
  );

  const nuove: Array<Record<string, unknown>> = [];
  for (const item of lavoro) {
    const codiceNormalizzato = normalizzaSku(item.codice).normalizzato;
    const marcaNormalizzata = (item.marca ?? '').trim().toLowerCase();
    const chiave = `${codiceNormalizzato}|${marcaNormalizzata}`;
    if (viste.has(chiave)) continue;
    viste.add(chiave);
    nuove.push({
      organization_id: orgId,
      batch_id: input.batchId,
      codice_normalizzato: codiceNormalizzato,
      marca_normalizzata: marcaNormalizzata,
      codice_originale: item.codice,
      marca_originale: item.marca,
      sku_membri: item.sku,
      ambito: item.domini,
      esito: IN_CODA,
      tentativi: 0,
      candidati_json: [] as unknown as Json,
    });
  }

  for (const pezzo of aBlocchi(nuove, 500)) {
    const scritto = await mustWrite(
      'sku_resolutions.insert(coda)',
      service.from('sku_resolutions').insert(pezzo),
    );
    if (!scritto.ok) return fail(`Coda non creata: ${scritto.error}`);
  }

  await getOrCreateBatchSource(service, orgId, input.batchId, SKU_LIST_SOURCE);
  await logWrite(
    'app_events.insert',
    service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'sku_list_enqueued',
      batch_id: input.batchId,
      metadata_json: { messiInCoda: nuove.length, prodotti: lavoro.length } as unknown as Json,
    }),
  );

  return ok(await leggiProgresso(service, input.batchId));
}

/**
 * Lavora un giro della coda.
 *
 * Chi chiama la richiama finché `finita` non è vera. Chiamarla su una coda già
 * finita non fa niente e non costa niente: è il caso normale quando due schede
 * del browser guardano la stessa lavorazione.
 */
export async function proseguiListaSku(input: {
  batchId: string;
}): Promise<ActionResult<ProgressoListaSku>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');

  const service = getServiceClient();
  const ctx = await creaContestoImport(service, orgId, input.batchId);
  let sorgenteImmagini: string | null = null;

  const materializza: Materializza = async (riga, esitoRisoluzione) => {
    const dati = esitoRisoluzione.estratto;
    const scelto = esitoRisoluzione.risoluzione.scelto;
    if (!dati || !scelto) return { ok: false, error: 'Pagina agganciata ma non rileggibile.' };

    const facts: Record<string, string> = { ...dati.attributes };
    if (dati.brand) facts['Brand'] = dati.brand;
    if (dati.price) facts['Prezzo'] = dati.price;

    const membri = (riga.sku_membri ?? []).length > 0 ? riga.sku_membri : [riga.codice_originale];
    const skuProdotto = ctx.skuUnico(membri.length > 1 ? riga.codice_originale : membri[0]!);
    const creato = await creaProdottoDaiFatti(service, {
      orgId,
      batchId: input.batchId,
      ctx,
      sku: skuProdotto,
      name: dati.name ?? riga.codice_originale,
      facts,
      rawInput: { codice: riga.codice_originale, url: scelto.url },
      // Un dato trovato sul sito del produttore e uno trovato su un marketplace
      // non pesano uguale, e la differenza deve arrivare fino all'audit dei
      // claim: da una terza parte «biologico» non si può scrivere.
      sourceType:
        scelto.livelloDominio === 'produttore' || scelto.livelloDominio === 'fornitore'
          ? 'ricerca-ufficiale'
          : 'ricerca-terza-parte',
      hasImages: dati.imageUrls.length > 0,
    });
    if (!creato.ok) return { ok: false, error: creato.error };

    // Il prodotto nato da questa riga, scritto nel registro: senza, riprendendo
    // la lavorazione non si saprebbe più quali righe hanno prodotto qualcosa, e
    // il conto degli importati verrebbe da una memoria che non c'è più.
    await mustWrite(
      'sku_resolutions.update(prodotto)',
      service.from('sku_resolutions').update({ product_id: creato.productId }).eq('id', riga.id),
    );

    if (membri.length > 1) {
      await writeOrTrace(
        service,
        'product_variants.insert(lista-sku)',
        service.from('product_variants').insert(
          membri.map((s) => ({
            product_id: creato.productId,
            external_id: s,
            sku: s,
            color: null,
            size: null,
            variant_attributes_json: {} as unknown as Json,
          })),
        ),
        { organizationId: orgId, batchId: input.batchId, refId: creato.productId },
      );
    }

    // Le foto della pagina agganciata. Un prodotto risolto da cui non arriva
    // nessuna immagine NON è un errore: resta valido, e si conta a parte.
    if (dati.images.length > 0) {
      if (!sorgenteImmagini) {
        sorgenteImmagini = await getOrCreateBatchSource(service, orgId, input.batchId, IMAGE_SOURCE);
      }
      if (sorgenteImmagini) {
        await scaricaImmaginiDaPagina(dati.images, {
          orgId,
          batchId: input.batchId,
          productId: creato.productId,
          batchSourceId: sorgenteImmagini,
          urlPagina: scelto.url,
          livelloDominio: scelto.livelloDominio,
          sku: skuProdotto,
          valoriVariante: membri.length > 1 ? membri : [],
        });
      }
    }

    // La confidenza di ogni campo tiene conto di quanto è sicuro l'aggancio: un
    // dato letto perfettamente da una pagina agganciata con riserva resta un
    // dato debole, e finisce fra i dubbi come tale.
    await logWrite(
      'product_attribute_values.update(confidenza identita)',
      service
        .from('product_attribute_values')
        .update({ confidence: confidenzaCampo(1, esitoRisoluzione.risoluzione.punteggioIdentita) })
        .eq('product_id', creato.productId),
    );

    return { ok: true };
  };

  const giro = await eseguiScaglione(
    { service, ricerca: getFornitoreRicerca(), materializza },
    { orgId, batchId: input.batchId },
  );

  if (sorgenteImmagini) {
    await writeOrTrace(
      service,
      'batch_sources.update(pronta)',
      service.from('batch_sources').update({ status: 'ready' }).eq('id', sorgenteImmagini),
      { organizationId: orgId, batchId: input.batchId, refId: sorgenteImmagini },
    );
  }

  await aggiornaBatchDaiProdotti(service, input.batchId);
  // Un registro che non si lascia scrivere non è un giro andato male: è un giro
  // che non si può ripetere senza ripagare le stesse ricerche. Va detto, non
  // ritentato in silenzio.
  if (giro.interrotto) return fail(`Lavorazione interrotta: ${giro.interrotto}`);
  const progresso = await leggiProgresso(service, input.batchId);

  // L'evento a fine coda, una volta sola: i giri successivi non lavorano più
  // niente e quindi non lo riemettono.
  if (progresso.finita && giro.lavorate > 0) {
    await logWrite(
      'app_events.insert',
      service.from('app_events').insert({
        organization_id: orgId,
        user_id: user.id,
        event_name: 'sku_list_import_confirmed',
        batch_id: input.batchId,
        metadata_json: {
          imported: progresso.importati,
          varianti: progresso.varianti,
          risolti: progresso.risolti,
          conRiserva: progresso.conRiserva,
          daConfermare: progresso.daConfermare,
          nonTrovati: progresso.nonTrovati,
          riprese: progresso.riprese,
        } as unknown as Json,
      }),
    );
  }

  return ok(progresso);
}

/** Porta il batch al passo dopo quando ci sono prodotti da rivedere. */
async function aggiornaBatchDaiProdotti(
  service: ReturnType<typeof getServiceClient>,
  batchId: string,
): Promise<void> {
  const { data: prodotti } = await service
    .from('products')
    .select('verification_status')
    .eq('batch_id', batchId);
  const totale = (prodotti ?? []).length;
  if (totale === 0) return;
  const validi = (prodotti ?? []).filter((p) => p.verification_status === 'eligible').length;

  const { data: batch } = await service
    .from('batches')
    .select('status')
    .eq('id', batchId)
    .maybeSingle();
  // Lo stato si muove solo in avanti e solo da fermo: una coda che prosegue
  // mentre l'utente è già oltre non deve riportarlo indietro al passo 3.
  const status = batch?.status === 'draft' ? 'input_review' : batch?.status;

  await logWrite(
    'batches.update(lista-sku)',
    service
      .from('batches')
      .update({
        status,
        source_type: 'sku_list',
        total_products: totale,
        valid_products: validi,
        invalid_products: totale - validi,
      })
      .eq('id', batchId),
  );
}

// ---------------------------------------------------------------------------
// LA CODA DI CONFERMA DELL'IDENTITÀ.
//
// Quando i segnali non bastano — lo stesso codice presso due produttori, due
// candidati che si equivalgono — il sistema non sceglie e mette il codice qui.
// Nessun campo è stato scritto: è la regola che impedisce una scheda in cui
// ogni dato è sbagliato pur essendo stato letto benissimo.
// ---------------------------------------------------------------------------

export interface RigaDaConfermare {
  id: string;
  codice: string;
  marca: string | null;
  /** Quanti SKU dipendono da questa scelta: uno, o tutto un gruppo di varianti. */
  quantiSku: number;
  motivo: string | null;
  candidati: CandidatoSalvato[];
}

export async function listaConfermeIdentita(input: {
  batchId: string;
}): Promise<ActionResult<RigaDaConfermare[]>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data } = await service
    .from('sku_resolutions')
    .select('id, codice_originale, marca_originale, sku_membri, motivo, candidati_json')
    .eq('batch_id', input.batchId)
    .eq('esito', 'coda-conferma')
    .order('creato_il', { ascending: true });

  return ok(
    (data ?? []).map((r) => ({
      id: r.id,
      codice: r.codice_originale,
      marca: r.marca_originale,
      quantiSku: (r.sku_membri ?? []).length || 1,
      motivo: r.motivo,
      candidati: ordinaPerLaScelta((r.candidati_json ?? []) as unknown as CandidatoSalvato[]),
    })),
  );
}

export interface EsitoConfermaIdentita {
  /** `true` se la conferma ha prodotto un prodotto a catalogo. */
  importato: boolean;
  restanti: number;
}

/**
 * Conferma (o scarta) l'identità di una riga in coda.
 *
 * L'indirizzo scelto viene confrontato con i candidati SALVATI: la richiesta
 * arriva dal browser, e senza quel confronto sarebbe chi la manda a decidere
 * cosa fa scaricare al nostro server.
 */
export async function confermaIdentita(input: {
  batchId: string;
  risoluzioneId: string;
  url?: string | null;
  scarta?: boolean;
}): Promise<ActionResult<EsitoConfermaIdentita>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data: riga } = await service
    .from('sku_resolutions')
    .select('id, codice_originale, marca_originale, sku_membri, candidati_json, esito')
    .eq('id', input.risoluzioneId)
    // Il vincolo sul batch non è ridondante: senza, un identificativo di
    // un'altra organizzazione basterebbe a farsi confermare una sua riga.
    .eq('batch_id', input.batchId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!riga) return fail('Riga non trovata');

  const candidati = (riga.candidati_json ?? []) as unknown as CandidatoSalvato[];
  const decisione = valutaConferma(candidati, { url: input.url, scarta: input.scarta });
  if (decisione.azione === 'rifiuta') return fail(decisione.motivo);

  const restanti = async () => {
    const { count } = await service
      .from('sku_resolutions')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', input.batchId)
      .eq('esito', 'coda-conferma');
    return count ?? 0;
  };

  if (decisione.azione === 'scarta') {
    await mustWrite(
      'sku_resolutions.update(scartata)',
      service
        .from('sku_resolutions')
        .update({ esito: 'non-trovato', motivo: 'Scartata da chi ha verificato.', aggiornato_il: new Date().toISOString() })
        .eq('id', riga.id),
    );
    return ok({ importato: false, restanti: await restanti() });
  }

  // Si rilegge la pagina scelta adesso: i candidati salvati portano titolo e
  // prezzo per la schermata, non i fatti. Quelli si prendono dalla pagina, con
  // lo stesso estrattore della fonte URL.
  const pagina = await safeFetch(decisione.url, {
    maxBytes: 3_000_000,
    accept: 'text/html,application/xhtml+xml',
  });
  if (!pagina.ok) return fail(`Pagina non raggiungibile: ${pagina.error ?? 'errore'}`);
  const dati = extractProductFromHtml(new TextDecoder('utf-8').decode(pagina.bytes), pagina.finalUrl);

  const ctx = await creaContestoImport(service, orgId, input.batchId);
  const membri = (riga.sku_membri ?? []).length > 0 ? riga.sku_membri : [riga.codice_originale];
  const facts: Record<string, string> = { ...dati.attributes };
  if (dati.brand) facts['Brand'] = dati.brand;
  if (dati.price) facts['Prezzo'] = dati.price;

  const dominio = new URL(pagina.finalUrl).hostname;
  const livello = livelloDelDominio(dominio, riga.marca_originale, []);
  const skuProdotto = ctx.skuUnico(membri.length > 1 ? riga.codice_originale : membri[0]!);

  const creato = await creaProdottoDaiFatti(service, {
    orgId,
    batchId: input.batchId,
    ctx,
    sku: skuProdotto,
    name: dati.name ?? riga.codice_originale,
    facts,
    rawInput: { codice: riga.codice_originale, url: pagina.finalUrl },
    sourceType: livello === 'produttore' || livello === 'fornitore' ? 'ricerca-ufficiale' : 'ricerca-terza-parte',
    hasImages: dati.imageUrls.length > 0,
  });
  if (!creato.ok) return fail(creato.error);

  // Le foto della pagina appena confermata: stesso percorso dell'import, perché
  // un prodotto confermato a mano non è un prodotto di serie B.
  const sorgente = await getOrCreateBatchSource(service, orgId, input.batchId, IMAGE_SOURCE);
  if (sorgente && dati.images.length > 0) {
    await scaricaImmaginiDaPagina(dati.images, {
      orgId,
      batchId: input.batchId,
      productId: creato.productId,
      batchSourceId: sorgente,
      urlPagina: pagina.finalUrl,
      livelloDominio: livello,
      sku: skuProdotto,
      valoriVariante: membri.length > 1 ? membri : [],
    });
    await writeOrTrace(
      service,
      'batch_sources.update(pronta)',
      service.from('batch_sources').update({ status: 'ready' }).eq('id', sorgente),
      { organizationId: orgId, batchId: input.batchId, refId: sorgente },
    );
  }

  if (membri.length > 1) {
    await writeOrTrace(
      service,
      'product_variants.insert(conferma)',
      service.from('product_variants').insert(
        membri.map((sku) => ({
          product_id: creato.productId,
          external_id: sku,
          sku,
          color: null,
          size: null,
          variant_attributes_json: {} as unknown as Json,
        })),
      ),
      { organizationId: orgId, batchId: input.batchId, refId: creato.productId },
    );
  }

  await mustWrite(
    'sku_resolutions.update(confermata)',
    service
      .from('sku_resolutions')
      .update({
        esito: 'risolto',
        product_id: creato.productId,
        url_scelto: pagina.finalUrl,
        dominio_scelto: dominio,
        livello_dominio: livello,
        // Una persona ha guardato i candidati e ne ha indicato uno: è la prova
        // migliore che possiamo avere, e i campi non devono ripresentarsi fra i
        // dubbi come se l'aggancio fosse ancora incerto.
        punteggio_identita: decisione.punteggioIdentita,
        motivo: 'Confermata da chi ha verificato.',
        aggiornato_il: new Date().toISOString(),
      })
      .eq('id', riga.id),
  );

  await logWrite(
    'app_events.insert',
    service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'sku_identity_confirmed',
      batch_id: input.batchId,
      metadata_json: { codice: riga.codice_originale, url: pagina.finalUrl, livello } as unknown as Json,
    }),
  );

  return ok({ importato: true, restanti: await restanti() });
}

// ---------------------------------------------------------------------------
// Ripresa di un batch interrotto.
//
// Il wizard teneva tutto nella memoria del browser: F5 al passo 4 riportava al
// passo 1 e il batch creato restava `draft` nel database, irraggiungibile —
// `/mapping` diceva «anteprima non più in memoria», `/results` era una pagina
// vuota. Chi caricava un catalogo da 2.000 righe e sbagliava un tasto
// ricominciava da capo. Tre revisioni indipendenti dell'audit ci sono
// inciampate.
//
// Qui si ricostruisce dal server tutto quello che serve per riaprire il wizard
// dov'era. L'anteprima del file NON viene da `sessionStorage` ma dal file vero
// su storage, ri-letto: è l'unica fonte che sopravvive a una chiusura di
// scheda.
//
// NOTA: la «Descrizione (facoltativa)» del passo 1 non si può riprendere
// perché non viene salvata da nessuna parte — finisce solo nel
// `metadata_json` di un evento di telemetria, che non è un posto da cui si
// legge. È un difetto a sé: chi la scrive la perde comunque, anche senza F5.
// ---------------------------------------------------------------------------

export interface BatchRipreso {
  batchId: string;
  name: string;
  presetId: string | null;
  presetVersionId: string | null;
  /** 'spreadsheet' | 'images' | 'mixed' | null, come salvato sul batch. */
  sourceType: string | null;
  status: string;
  /** Il file già caricato, ri-letto da storage. Null se non c'è. */
  spreadsheet: {
    filename: string;
    headers: string[];
    previewRows: Array<Record<string, string>>;
    suggestedSkuHeader: string | null;
    suggestedNameHeader: string | null;
    sheets: string[];
    sheet: string | null;
    totalRows: number;
  } | null;
  /** Quante immagini risultano già caricate. */
  immagini: number;
}

export async function riprendiBatch(input: {
  batchId: string;
}): Promise<ActionResult<BatchRipreso>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data: batch } = await service
    .from('batches')
    .select('id, name, status, source_type, preset_version_id')
    .eq('id', input.batchId)
    .maybeSingle();
  if (!batch) return fail('Batch non trovato');

  // Dalla versione risaliamo al preset: il passo 1 mostra il preset, non la
  // sua versione.
  let presetId: string | null = null;
  if (batch.preset_version_id) {
    const { data: pv } = await service
      .from('preset_versions')
      .select('preset_id')
      .eq('id', batch.preset_version_id)
      .maybeSingle();
    presetId = pv?.preset_id ?? null;
  }

  const caricato = await loadBatchSpreadsheet(service, input.batchId);
  const immagini = (await loadImageItems(service, input.batchId)).length;

  const sku = caricato ? suggestSkuHeader(caricato.parsed.headers) : null;
  return ok<BatchRipreso>({
    batchId: batch.id,
    name: batch.name ?? '',
    presetId,
    presetVersionId: batch.preset_version_id ?? null,
    sourceType: batch.source_type ?? null,
    status: batch.status,
    spreadsheet: caricato
      ? {
          filename: caricato.filename,
          headers: caricato.parsed.headers,
          previewRows: caricato.parsed.rows.slice(0, 100),
          suggestedSkuHeader: sku,
          suggestedNameHeader: suggestNameHeader(caricato.parsed.headers, sku),
          sheets: caricato.parsed.sheets ?? [],
          sheet: caricato.parsed.sheet ?? null,
          totalRows: caricato.parsed.rows.length,
        }
      : null,
    immagini,
  });
}

/**
 * Rilegge lo spreadsheet del batch scegliendo un altro foglio.
 *
 * Il file resta quello caricato: cambia solo quale pagina se ne guarda. Serve
 * per i workbook che tengono le istruzioni sul primo foglio e il listino sul
 * secondo — un caso comune che prima finiva con l'import del foglio sbagliato,
 * senza che nessuno lo dicesse.
 */
export async function rileggiFoglio(input: {
  batchId: string;
  foglio: string;
}): Promise<ActionResult<UploadSpreadsheetResult>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const caricato = await loadBatchSpreadsheet(service, input.batchId, input.foglio);
  if (!caricato) return fail('Nessun file da rileggere per questo batch');
  if (caricato.parsed.rows.length === 0) {
    return fail(`Il foglio «${input.foglio}» non contiene righe dati.`);
  }

  const sku = suggestSkuHeader(caricato.parsed.headers);
  return ok<UploadSpreadsheetResult>({
    kind: 'spreadsheet',
    headers: caricato.parsed.headers,
    previewRows: caricato.parsed.rows.slice(0, 100),
    suggestedSkuHeader: sku,
    suggestedNameHeader: suggestNameHeader(caricato.parsed.headers, sku),
    sheets: caricato.parsed.sheets ?? [],
    sheet: caricato.parsed.sheet ?? null,
    totalRows: caricato.parsed.rows.length,
    file: { filename: caricato.filename, sku: null, status: 'ready', problem: null },
  });
}
