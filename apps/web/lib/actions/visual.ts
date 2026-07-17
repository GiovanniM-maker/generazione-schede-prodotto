'use server';

import { createAiProviders } from '@app/ai';
import { STORAGE_BUCKETS, VISUAL_WHITELIST } from '@app/config';
import type { VisualExtractionImage } from '@app/core';
import type { Json } from '@app/database';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getServerEnv } from '@/lib/env.server';
import { assertBatchAccess } from '@/lib/ownership';

// ---------------------------------------------------------------------------
// Estrazione visuale REALE dalle immagini di prodotto.
//
// Principio: le immagini possono SOLO SUGGERIRE un piccolo insieme di attributi
// VISIBILI (whitelist), sempre come `inferred_visual` — mai fatti finché
// l'utente non conferma. Mai dedurre materiale, composizione, misure, cura,
// origine, sostenibilità, ecc. La whitelist è per ora limitata alla Moda: per
// altri settori allowedFields resta vuoto e non si suggerisce nulla.
// ---------------------------------------------------------------------------

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

/** Numero massimo di prodotti analizzati per batch (limite di costo). */
const MAX_PRODUCTS = 50;
/** Numero massimo di immagini passate al modello per prodotto. */
const MAX_IMAGES_PER_PRODUCT = 4;
/** Durata del signed URL passato al modello (secondi). */
const SIGNED_URL_TTL = 600;

/**
 * Stati "forti" che NON devono essere sovrascritti da un suggerimento visivo.
 * Rispetta la priorità delle fonti: CSV/provided e conferme vincono; un valore
 * rifiutato non viene resuscitato.
 */
const LOCKED_STATUSES = new Set([
  'provided',
  'extracted_from_file',
  'extracted_from_image',
  'derived',
  'confirmed',
  'rejected',
]);

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isImageItem(mime: string | null, filename: string): boolean {
  if (mime && mime.toLowerCase().startsWith('image/')) return true;
  return /\.(jpe?g|png|webp)$/i.test(filename);
}

function mimeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

interface PresetAttr {
  id: string;
  key: string | null;
  name: string;
}

/** Whitelist visuale per settore. Per ora solo Moda ha attributi suggeribili. */
function sectorVisualWhitelist(sectorKey: string | null | undefined): string[] {
  return sectorKey === 'moda' ? [...VISUAL_WHITELIST] : [];
}

/**
 * Mappa i fieldKey della whitelist agli attributi del preset (per chiave esatta
 * o, in fallback, per nome normalizzato). Ritorna solo i campi effettivamente
 * presenti come attributo nel preset.
 */
function buildFieldMapping(
  whitelist: string[],
  attributes: PresetAttr[],
): { allowedFields: string[]; fieldToAttrId: Map<string, string> } {
  const byKey = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const a of attributes) {
    if (a.key) byKey.set(normalizeKey(a.key), a.id);
    byName.set(normalizeKey(a.name), a.id);
  }
  const allowedFields: string[] = [];
  const fieldToAttrId = new Map<string, string>();
  for (const field of whitelist) {
    const norm = normalizeKey(field);
    const attrId = byKey.get(norm) ?? byName.get(norm);
    if (attrId) {
      allowedFields.push(field);
      fieldToAttrId.set(field, attrId);
    }
  }
  return { allowedFields, fieldToAttrId };
}

export interface VisualExtractionSummary {
  productsProcessed: number;
  attributesSuggested: number;
  /** Prodotti con immagini esclusi perché oltre il limite per esecuzione. */
  productsSkipped: number;
  /** Prodotti per cui alcune immagini non sono state analizzate (oltre il cap). */
  productsWithTruncatedImages: number;
  maxProducts: number;
  maxImagesPerProduct: number;
}

function emptyVisualSummary(): VisualExtractionSummary {
  return {
    productsProcessed: 0,
    attributesSuggested: 0,
    productsSkipped: 0,
    productsWithTruncatedImages: 0,
    maxProducts: MAX_PRODUCTS,
    maxImagesPerProduct: MAX_IMAGES_PER_PRODUCT,
  };
}

export async function runVisualExtractionForBatch(input: {
  batchId: string;
}): Promise<ActionResult<VisualExtractionSummary>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  // 1) Preset + settore del batch.
  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', input.batchId)
    .maybeSingle();
  const presetVersionId = batch?.preset_version_id ?? null;
  if (!presetVersionId) return fail('Preset del batch non trovato');

  const { data: presetVersion } = await service
    .from('preset_versions')
    .select('preset_id')
    .eq('id', presetVersionId)
    .maybeSingle();
  let sectorKey: string | null = null;
  let sectorName: string | undefined;
  if (presetVersion?.preset_id) {
    const { data: preset } = await service
      .from('presets')
      .select('sector_id')
      .eq('id', presetVersion.preset_id)
      .maybeSingle();
    if (preset?.sector_id) {
      const { data: sector } = await service
        .from('sectors')
        .select('key, name')
        .eq('id', preset.sector_id)
        .maybeSingle();
      sectorKey = sector?.key ?? null;
      sectorName = sector?.name ?? undefined;
    }
  }

  // 2) Whitelist ∩ attributi del preset.
  const whitelist = sectorVisualWhitelist(sectorKey);
  if (whitelist.length === 0) {
    // Settore senza whitelist visuale (es. Food/Pharma): nessun suggerimento.
    return ok(emptyVisualSummary());
  }

  const { data: presetAttrs } = await service
    .from('preset_attributes')
    .select('attribute_id, enabled')
    .eq('preset_version_id', presetVersionId);
  const attrIds = (presetAttrs ?? []).filter((a) => a.enabled !== false).map((a) => a.attribute_id);
  if (attrIds.length === 0) return ok(emptyVisualSummary());

  const { data: attrRows } = await service
    .from('attributes')
    .select('id, key, name')
    .in('id', attrIds);
  const attributes: PresetAttr[] = (attrRows ?? []).map((a) => ({ id: a.id, key: a.key, name: a.name }));

  const { allowedFields, fieldToAttrId } = buildFieldMapping(whitelist, attributes);
  if (allowedFields.length === 0) return ok(emptyVisualSummary());

  // 3) Prodotti del batch con immagini collegate.
  const { data: products } = await service
    .from('products')
    .select('id')
    .eq('batch_id', input.batchId);
  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) return ok(emptyVisualSummary());

  const { data: links } = await service
    .from('product_source_links')
    .select('product_id, source_item_id')
    .in('product_id', productIds);
  const sourceItemIds = [...new Set((links ?? []).map((l) => l.source_item_id))];
  if (sourceItemIds.length === 0) return ok(emptyVisualSummary());

  const { data: items } = await service
    .from('source_items')
    .select('id, filename, mime_type, source_file_id')
    .in('id', sourceItemIds);
  const imageItemById = new Map(
    (items ?? [])
      .filter((it) => isImageItem(it.mime_type, it.filename))
      .map((it) => [it.id, it]),
  );

  // product_id -> lista di source_item immagine.
  const imagesByProduct = new Map<string, Array<{ id: string; filename: string; mime_type: string | null; source_file_id: string | null }>>();
  for (const link of links ?? []) {
    const item = imageItemById.get(link.source_item_id);
    if (!item) continue;
    const arr = imagesByProduct.get(link.product_id);
    if (arr) arr.push(item);
    else imagesByProduct.set(link.product_id, [item]);
  }

  let targets = [...imagesByProduct.keys()];
  if (targets.length === 0) {
    return ok({
      productsProcessed: 0,
      attributesSuggested: 0,
      productsSkipped: 0,
      productsWithTruncatedImages: 0,
      maxProducts: MAX_PRODUCTS,
      maxImagesPerProduct: MAX_IMAGES_PER_PRODUCT,
    });
  }
  let productsSkipped = 0;
  if (targets.length > MAX_PRODUCTS) {
    productsSkipped = targets.length - MAX_PRODUCTS;
    console.warn(
      `[visual] batch ${input.batchId}: ${targets.length} prodotti con immagini, limitati a ${MAX_PRODUCTS} (${productsSkipped} esclusi da questa esecuzione).`,
    );
    targets = targets.slice(0, MAX_PRODUCTS);
  }

  // 4) Stato attuale dei valori (per rispettare la priorità delle fonti).
  const { data: existingPav } = await service
    .from('product_attribute_values')
    .select('id, product_id, attribute_id, status')
    .in('product_id', targets);
  const pavByProduct = new Map<string, Map<string, { id: string; status: string }>>();
  for (const row of existingPav ?? []) {
    let m = pavByProduct.get(row.product_id);
    if (!m) {
      m = new Map();
      pavByProduct.set(row.product_id, m);
    }
    m.set(row.attribute_id, { id: row.id, status: row.status });
  }

  const providers = createAiProviders(getServerEnv());

  let productsProcessed = 0;
  let attributesSuggested = 0;
  let productsWithTruncatedImages = 0;

  for (const productId of targets) {
    const allItems = imagesByProduct.get(productId) ?? [];
    const productItems = allItems.slice(0, MAX_IMAGES_PER_PRODUCT);
    if (allItems.length > MAX_IMAGES_PER_PRODUCT) {
      productsWithTruncatedImages++;
      console.warn(
        `[visual] prodotto ${productId}: ${allItems.length} immagini, analizzate solo le prime ${MAX_IMAGES_PER_PRODUCT}.`,
      );
    }

    // Signed URL per ogni immagine (evita il base64 per restare leggeri).
    const images: VisualExtractionImage[] = [];
    let firstItemId: string | null = null;
    for (const item of productItems) {
      if (!item.source_file_id) continue;
      const { data: sf } = await service
        .from('source_files')
        .select('storage_bucket, storage_path')
        .eq('id', item.source_file_id)
        .maybeSingle();
      if (!sf) continue;
      const { data: signed } = await service.storage
        .from(sf.storage_bucket ?? STORAGE_BUCKETS.productAssets)
        .createSignedUrl(sf.storage_path, SIGNED_URL_TTL);
      if (!signed?.signedUrl) continue;
      images.push({
        dataUrl: signed.signedUrl,
        mimeType: item.mime_type ?? mimeFromFilename(item.filename),
        label: item.filename,
      });
      if (!firstItemId) firstItemId = item.id;
    }
    if (images.length === 0) continue;

    let result;
    try {
      result = await providers.visual.extractVisualAttributes({
        images,
        allowedFields,
        sectorName,
      });
    } catch (err) {
      console.warn(`[visual] estrazione fallita per prodotto ${productId}:`, err);
      continue;
    }
    productsProcessed++;

    const existing = pavByProduct.get(productId) ?? new Map<string, { id: string; status: string }>();

    for (const attr of result.data.attributes) {
      const attributeId = fieldToAttrId.get(attr.fieldKey);
      if (!attributeId) continue; // fieldKey fuori whitelist/preset: ignora.
      const value = (attr.value ?? '').trim();
      if (value === '') continue;

      const current = existing.get(attributeId);
      if (current && LOCKED_STATUSES.has(current.status)) {
        // Valore più forte già presente (CSV/provided/confermato/rifiutato): non sovrascrivere.
        continue;
      }

      const payload = {
        organization_id: orgId,
        product_id: productId,
        attribute_id: attributeId,
        value_json: value as unknown as Json,
        status: 'inferred_visual',
        source_type: 'image',
        source_item_id: firstItemId,
        confidence: attr.confidence,
        confirmed_by: null,
        confirmed_at: null,
      };

      if (current) {
        const { error } = await service
          .from('product_attribute_values')
          .update(payload)
          .eq('id', current.id);
        if (error) continue;
      } else {
        const { error } = await service.from('product_attribute_values').insert(payload);
        if (error) continue;
      }
      existing.set(attributeId, { id: current?.id ?? '', status: 'inferred_visual' });
      attributesSuggested++;
    }
    pavByProduct.set(productId, existing);
  }

  await service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'visual_extraction_run',
    batch_id: input.batchId,
    metadata_json: {
      productsProcessed,
      attributesSuggested,
      productsSkipped,
      productsWithTruncatedImages,
    } as unknown as Json,
  });

  return ok({
    productsProcessed,
    attributesSuggested,
    productsSkipped,
    productsWithTruncatedImages,
    maxProducts: MAX_PRODUCTS,
    maxImagesPerProduct: MAX_IMAGES_PER_PRODUCT,
  });
}

// ---------------------------------------------------------------------------
// Conferma / rifiuto di un singolo valore inferito.
// ---------------------------------------------------------------------------

async function assertPavAccess(
  service: ReturnType<typeof getServiceClient>,
  pavId: string,
): Promise<{ orgId: string; productId: string } | null> {
  const { data: pav } = await service
    .from('product_attribute_values')
    .select('product_id')
    .eq('id', pavId)
    .maybeSingle();
  if (!pav) return null;
  const { data: product } = await service
    .from('products')
    .select('batch_id')
    .eq('id', pav.product_id)
    .maybeSingle();
  if (!product) return null;
  const orgId = await assertBatchAccess(product.batch_id);
  if (!orgId) return null;
  return { orgId, productId: pav.product_id };
}

export async function confirmAttributeValue(input: {
  productAttributeValueId: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const service = getServiceClient();
  const access = await assertPavAccess(service, input.productAttributeValueId);
  if (!access) return fail('Valore non accessibile');

  const { error } = await service
    .from('product_attribute_values')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: user.id,
    })
    .eq('id', input.productAttributeValueId);
  if (error) return fail(error.message);
  return ok({ id: input.productAttributeValueId });
}

export async function rejectAttributeValue(input: {
  id: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const service = getServiceClient();
  const access = await assertPavAccess(service, input.id);
  if (!access) return fail('Valore non accessibile');

  const { error } = await service
    .from('product_attribute_values')
    .update({ status: 'rejected' })
    .eq('id', input.id);
  if (error) return fail(error.message);
  return ok({ id: input.id });
}

// ---------------------------------------------------------------------------
// Elenco dei valori inferred_visual per la UI di revisione.
// ---------------------------------------------------------------------------

export interface InferredAttributeRow {
  id: string;
  attributeName: string;
  value: string;
  confidence: number | null;
}

export interface InferredProductGroup {
  productId: string;
  sku: string | null;
  name: string | null;
  attributes: InferredAttributeRow[];
}

export async function listInferredAttributes(input: {
  batchId: string;
}): Promise<ActionResult<{ products: InferredProductGroup[] }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data: products } = await service
    .from('products')
    .select('id, sku, name')
    .eq('batch_id', input.batchId)
    .order('created_at', { ascending: true });
  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) return ok({ products: [] });

  const { data: pav } = await service
    .from('product_attribute_values')
    .select('id, product_id, attribute_id, value_json, confidence')
    .eq('status', 'inferred_visual')
    .in('product_id', productIds);
  const rows = pav ?? [];
  if (rows.length === 0) return ok({ products: [] });

  const attrIds = [...new Set(rows.map((r) => r.attribute_id))];
  const { data: attrs } = await service
    .from('attributes')
    .select('id, name')
    .in('id', attrIds);
  const attrName = new Map((attrs ?? []).map((a) => [a.id, a.name]));

  const byProduct = new Map<string, InferredAttributeRow[]>();
  for (const r of rows) {
    const value =
      typeof r.value_json === 'string' ? r.value_json : r.value_json == null ? '' : String(r.value_json);
    const list = byProduct.get(r.product_id) ?? [];
    list.push({
      id: r.id,
      attributeName: attrName.get(r.attribute_id) ?? 'Attributo',
      value,
      confidence: r.confidence,
    });
    byProduct.set(r.product_id, list);
  }

  const groups: InferredProductGroup[] = (products ?? [])
    .filter((p) => byProduct.has(p.id))
    .map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      attributes: byProduct.get(p.id) ?? [],
    }));

  return ok({ products: groups });
}
