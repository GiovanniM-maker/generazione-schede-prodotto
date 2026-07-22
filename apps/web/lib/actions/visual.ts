'use server';

import { createAiProviders } from '@app/ai';
import { STORAGE_BUCKETS } from '@app/config';
import { NON_ADDITIONAL_FIELDS } from '@app/core';
import type { VisualExtractionImage, VisualFieldSpec } from '@app/core';
import type { Json } from '@app/database';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getServerEnv } from '@/lib/env.server';
import { assertBatchAccess } from '@/lib/ownership';
import { checkAiRateLimit } from '@/lib/rate-limit';

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

interface PresetAttrFull {
  id: string;
  key: string | null;
  name: string;
  dataType: string | null;
  unit: string | null;
  enumValues: string[] | null;
}

/** Numero massimo di campi inviati al modello per prodotto (dimensione prompt). */
const MAX_FIELDS_PER_PRODUCT = 60;
/**
 * Soglia di confidenza sopra la quale un dato di fatto letto sul pack diventa
 * un fatto USABILE (status 'extracted_from_image') e alimenta la generazione.
 * Sotto la soglia resta 'inferred_visual' (da confermare).
 */
const AUTO_FACT_CONFIDENCE = 0.7;

/** fieldKey stabile di un attributo (chiave esplicita o nome normalizzato). */
function attrFieldKey(a: { key: string | null; name: string }): string {
  return a.key && a.key.trim() ? a.key.trim() : normalizeKey(a.name);
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
  /** Se true, ri-analizza anche i prodotti già letti (default: salta i già fatti). */
  force?: boolean;
  /** Se valorizzato, limita l'estrazione a questi prodotti (es. il campione). */
  productIds?: string[];
}): Promise<ActionResult<VisualExtractionSummary>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');

  const rl = await checkAiRateLimit(orgId, 'visual');
  if (!rl.allowed) return fail(rl.message);

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

  // 2) Attributi del preset con TIPI e CATEGORIA (multi-settore, non più solo Moda).
  //    I campi inviati al modello per un prodotto sono quelli della SUA categoria
  //    (scoping) oppure, se il prodotto non ha categoria, l'insieme deduplicato.
  void sectorKey; // il settore non filtra più i campi: li guida il preset.
  const { data: presetAttrs } = await service
    .from('preset_attributes')
    .select('attribute_id, category_id, enabled')
    .eq('preset_version_id', presetVersionId);
  const enabledPas = (presetAttrs ?? []).filter((a) => a.enabled !== false);
  const attrIds = [...new Set(enabledPas.map((a) => a.attribute_id))];
  if (attrIds.length === 0) return ok(emptyVisualSummary());

  const { data: attrRows } = await service
    .from('attributes')
    .select('id, key, name, data_type, unit, enum_values_json')
    .in('id', attrIds);
  const attrById = new Map<string, PresetAttrFull>();
  for (const a of attrRows ?? []) {
    const enumValues = Array.isArray(a.enum_values_json)
      ? (a.enum_values_json as unknown[]).filter((v): v is string => typeof v === 'string')
      : null;
    attrById.set(a.id, {
      id: a.id,
      key: a.key,
      name: a.name,
      dataType: a.data_type,
      unit: a.unit,
      enumValues,
    });
  }

  // Mappa fieldKey -> attributeId (globale) e fieldKey -> spec tipizzata.
  const fieldToAttrId = new Map<string, string>();
  const specByField = new Map<string, VisualFieldSpec>();
  for (const a of attrById.values()) {
    const key = attrFieldKey(a);
    if (!fieldToAttrId.has(key)) fieldToAttrId.set(key, a.id);
    if (!specByField.has(key)) {
      specByField.set(key, {
        key,
        name: a.name,
        dataType: a.dataType ?? undefined,
        enumValues: a.enumValues ?? undefined,
        unit: a.unit ?? undefined,
      });
    }
  }

  // fieldKeys per categoria (scoping) + insieme globale deduplicato (no categoria).
  const keysByCategory = new Map<string, string[]>();
  const globalKeysSet = new Set<string>();
  for (const p of enabledPas) {
    const a = attrById.get(p.attribute_id);
    if (!a) continue;
    const key = attrFieldKey(a);
    globalKeysSet.add(key);
    if (p.category_id) {
      const arr = keysByCategory.get(p.category_id) ?? [];
      if (!arr.includes(key)) arr.push(key);
      keysByCategory.set(p.category_id, arr);
    }
  }
  const globalKeys = [...globalKeysSet].slice(0, MAX_FIELDS_PER_PRODUCT);
  if (fieldToAttrId.size === 0) return ok(emptyVisualSummary());

  // Nomi delle categorie del preset: servono a INFERIRE la categoria dalle foto
  // quando il prodotto non ne ha una (nessuna mappatura Excel). L'AI non "indovina"
  // liberamente: sceglie fra le categorie del preset.
  const CATEGORY_FIELD_KEY = '__product_category__';
  const catIds = [...new Set(enabledPas.map((p) => p.category_id).filter((c): c is string => !!c))];
  const { data: catRows } = catIds.length
    ? await service.from('categories').select('id, name').in('id', catIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const categoryNameById = new Map((catRows ?? []).map((c) => [c.id, c.name] as const));
  const categoryIdByNorm = new Map((catRows ?? []).map((c) => [normalizeKey(c.name), c.id] as const));
  const categoryNames = (catRows ?? []).map((c) => c.name);

  // Match ROBUSTO del nome categoria restituito dall'AI verso le categorie del
  // preset: esatto → contenimento → maggiore sovrapposizione di token. Evita che
  // una piccola differenza ("Cioccolato" vs "Cioccolato fondente") lasci il
  // prodotto senza categoria (deve essere a prova di errore).
  const categoryTokensById = (catRows ?? []).map((c) => ({
    id: c.id,
    tokens: new Set(normalizeKey(c.name).split('_').filter(Boolean)),
  }));
  function matchCategoryId(raw: string): string | null {
    const norm = normalizeKey(raw);
    if (!norm) return null;
    const exact = categoryIdByNorm.get(norm);
    if (exact) return exact;
    const valSet = new Set(norm.split('_').filter(Boolean));
    let best: { id: string; score: number } | null = null;
    for (const c of categoryTokensById) {
      if (c.tokens.size === 0) continue;
      const catNorm = [...c.tokens].join('_');
      const contains = norm.includes(catNorm) || catNorm.includes(norm);
      let inter = 0;
      for (const t of valSet) if (c.tokens.has(t)) inter++;
      const union = new Set([...valSet, ...c.tokens]).size;
      const jaccard = union ? inter / union : 0;
      const score = (contains ? 0.5 : 0) + jaccard;
      if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
    }
    // Soglia prudente: contenimento o >=50% di token in comune.
    return best && best.score >= 0.5 ? best.id : null;
  }
  const categorySpec: VisualFieldSpec | null = categoryNames.length
    ? {
        key: CATEGORY_FIELD_KEY,
        name: 'Categoria merceologica del prodotto: a quale di queste categorie appartiene ciò che vedi?',
        dataType: 'enum',
        enumValues: categoryNames,
        classify: true,
      }
    : null;

  // Campi da inviare per un prodotto in base alla sua categoria. Se il prodotto
  // NON ha categoria, aggiunge il campo sintetico di CLASSIFICAZIONE categoria.
  function fieldsForCategory(categoryId: string | null): { allowedFields: string[]; fieldSpecs: VisualFieldSpec[] } {
    const keys = (categoryId ? keysByCategory.get(categoryId) : null) ?? globalKeys;
    const capped = keys.slice(0, MAX_FIELDS_PER_PRODUCT);
    const specs = capped
      .map((k) => specByField.get(k))
      .filter((s): s is VisualFieldSpec => !!s);
    const allowed = [...capped];
    if (!categoryId && categorySpec) {
      allowed.push(CATEGORY_FIELD_KEY);
      specs.push(categorySpec);
    }
    return { allowedFields: allowed, fieldSpecs: specs };
  }

  // 3) Prodotti del batch con immagini collegate (con la loro categoria).
  const { data: products } = await service
    .from('products')
    .select('id, category_id')
    .eq('batch_id', input.batchId);
  const productIds = (products ?? []).map((p) => p.id);
  const categoryByProduct = new Map<string, string | null>(
    (products ?? []).map((p) => [p.id, p.category_id ?? null] as const),
  );
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
  if (input.productIds && input.productIds.length > 0) {
    const wanted = new Set(input.productIds);
    targets = targets.filter((id) => wanted.has(id));
  }
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
    .select('id, product_id, attribute_id, status, source_type')
    .in('product_id', targets);
  const pavByProduct = new Map<string, Map<string, { id: string; status: string }>>();
  const alreadyExtracted = new Set<string>();
  for (const row of existingPav ?? []) {
    let m = pavByProduct.get(row.product_id);
    if (!m) {
      m = new Map();
      pavByProduct.set(row.product_id, m);
    }
    m.set(row.attribute_id, { id: row.id, status: row.status });
    if (row.source_type === 'image') alreadyExtracted.add(row.product_id);
  }

  const providers = createAiProviders(getServerEnv());

  let productsProcessed = 0;
  let attributesSuggested = 0;
  let productsWithTruncatedImages = 0;

  // Elabora UN prodotto: legge le immagini e scrive i valori estratti.
  async function processProduct(productId: string): Promise<void> {
    // Idempotenza: salta i prodotti già letti dalle immagini (evita ri-billing),
    // a meno che non sia richiesto force.
    if (!input.force && alreadyExtracted.has(productId)) return;
    const allItems = imagesByProduct.get(productId) ?? [];
    const productItems = allItems.slice(0, MAX_IMAGES_PER_PRODUCT);
    if (allItems.length > MAX_IMAGES_PER_PRODUCT) {
      productsWithTruncatedImages++;
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
    if (images.length === 0) return;

    // Campi da estrarre in base alla categoria del prodotto (scoping) o globali.
    const { allowedFields, fieldSpecs } = fieldsForCategory(categoryByProduct.get(productId) ?? null);
    if (allowedFields.length === 0) return;

    let result;
    try {
      result = await providers.visual.extractVisualAttributes({
        images,
        allowedFields,
        fieldSpecs,
        sectorName,
      });
    } catch (err) {
      console.warn(`[visual] estrazione fallita per prodotto ${productId}:`, err);
      return;
    }
    productsProcessed++;

    const existing = pavByProduct.get(productId) ?? new Map<string, { id: string; status: string }>();

    // 1) Prima la CLASSIFICAZIONE della categoria: imposta products.category_id
    //    scegliendo fra le categorie del preset. Così i fatti successivi possono
    //    essere filtrati sui SOLI attributi di quella categoria.
    const classification = result.data.attributes.find((a) => a.fieldKey === CATEGORY_FIELD_KEY);
    if (classification) {
      const catId = matchCategoryId(classification.value);
      if (catId) {
        await service
          .from('products')
          .update({ category_id: catId, category: categoryNameById.get(catId) ?? null })
          .eq('id', productId)
          .is('category_id', null);
        categoryByProduct.set(productId, catId);
      }
    }
    // Attributi ammessi per la categoria (ora nota). Se il prodotto resta senza
    // categoria, si accetta l'insieme globale (nessun filtro).
    const resolvedCatId = categoryByProduct.get(productId) ?? null;
    const allowedForCategory = resolvedCatId
      ? new Set(keysByCategory.get(resolvedCatId) ?? [])
      : null;

    for (const attr of result.data.attributes) {
      if (attr.fieldKey === CATEGORY_FIELD_KEY) continue; // già gestita sopra
      // I claim di MARKETING non diventano mai fatti: aiutano solo a capire, non
      // vengono scritti come attributo del prodotto.
      if (attr.kind === 'marketing') continue;
      // Scarta i fatti che NON appartengono alla categoria dedotta: evita che un
      // cioccolato riceva "Metodo Coltivazione" dall'insieme globale.
      if (allowedForCategory && !allowedForCategory.has(attr.fieldKey)) continue;
      const attributeId = fieldToAttrId.get(attr.fieldKey);
      if (!attributeId) continue; // fieldKey fuori dal preset: ignora.
      const value = (attr.value ?? '').trim();
      if (value === '') continue;

      const current = existing.get(attributeId);
      if (current && LOCKED_STATUSES.has(current.status)) {
        // Valore più forte già presente (CSV/provided/confermato/rifiutato): non sovrascrivere.
        continue;
      }

      // Dato di fatto sul pack con confidenza alta → fatto USABILE
      // ('extracted_from_image'); altrimenti resta da confermare ('inferred_visual').
      const isUsableFact =
        (attr.kind === 'onpack_factual' || attr.kind === 'brand') &&
        typeof attr.confidence === 'number' &&
        attr.confidence >= AUTO_FACT_CONFIDENCE;
      const status = isUsableFact ? 'extracted_from_image' : 'inferred_visual';

      const payload = {
        organization_id: orgId as string,
        product_id: productId,
        attribute_id: attributeId,
        value_json: value as unknown as Json,
        status,
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
      existing.set(attributeId, { id: current?.id ?? '', status });
      attributesSuggested++;
    }
    pavByProduct.set(productId, existing);
  }

  // Elabora i prodotti in PARALLELO con concorrenza limitata: riduce il tempo
  // totale (le chiamate di visione sono I/O-bound) restando nei limiti di durata.
  const CONCURRENCY = 5;
  let cursor = 0;
  async function poolWorker(): Promise<void> {
    while (cursor < targets.length) {
      const productId = targets[cursor++];
      if (!productId) break;
      await processProduct(productId);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, poolWorker));

  // Ricalcola l'ELEGGIBILITÀ: i prodotti che ora hanno ≥2 fatti usabili (inclusi
  // quelli letti dalle immagini) passano da 'excluded' a 'eligible', così la
  // generazione li può accodare. Senza questo, i solo-immagini resterebbero
  // esclusi anche con i fatti appena estratti.
  try {
    const USABLE_STATUSES = [
      'provided',
      'extracted_from_file',
      'extracted_from_image',
      'derived',
      'confirmed',
    ];
    const { data: usableRows } = await service
      .from('product_attribute_values')
      .select('product_id, attribute_id, status')
      .in('product_id', targets)
      .in('status', USABLE_STATUSES);
    const additionalByProduct = new Map<string, Set<string>>();
    for (const r of usableRows ?? []) {
      const a = attrById.get(r.attribute_id);
      const key = a ? attrFieldKey(a) : r.attribute_id;
      if (NON_ADDITIONAL_FIELDS.has(key)) continue; // sku/nome/immagini: non contano
      const set = additionalByProduct.get(r.product_id) ?? new Set<string>();
      set.add(r.attribute_id);
      additionalByProduct.set(r.product_id, set);
    }
    const nowEligible = [...additionalByProduct.entries()]
      .filter(([, set]) => set.size >= 2)
      .map(([pid]) => pid);
    if (nowEligible.length > 0) {
      await service
        .from('products')
        .update({ verification_status: 'eligible' })
        .in('id', nowEligible)
        .eq('verification_status', 'excluded');
    }
  } catch (e) {
    console.warn('[visual] ricalcolo eleggibilità non riuscito:', e);
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
