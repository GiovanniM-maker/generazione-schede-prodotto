import { getFieldDef, type FactAttribute } from '@app/core';
import type { TypedClient, Json } from '@app/database';

// ---------------------------------------------------------------------------
// Costruzione dei fatti ammessi per un prodotto. Parte dagli attributi
// canonici (provided) e applica le conferme/rifiuti da attribute_evidence.
// Gli attributi inferred_visual/needs_review non confermati NON sono fatti.
// ---------------------------------------------------------------------------

export interface ProductFactsRow {
  canonical_attributes_json: Json;
}

/** Converte canonical_attributes_json in fatti provided. */
export function factsFromCanonical(
  canonical: Record<string, string>,
  sourceType: 'csv' | 'xlsx' = 'csv',
): FactAttribute[] {
  const facts: FactAttribute[] = [];
  for (const [fieldKey, value] of Object.entries(canonical)) {
    const def = getFieldDef(fieldKey);
    if (!def || !def.factual) continue;
    if (typeof value !== 'string' || value.trim() === '') continue;
    facts.push({ fieldKey, value, status: 'provided', sourceType });
  }
  return facts;
}

/**
 * Carica i fatti di un prodotto combinando canonical + evidence.
 * Le evidence con status 'rejected' rimuovono il fatto; 'confirmed' lo
 * promuovono; 'inferred_visual'/'needs_review' non entrano tra i fatti usabili.
 */
export async function loadProductFacts(
  client: TypedClient,
  productId: string,
): Promise<FactAttribute[]> {
  const { data: product, error } = await client
    .from('products')
    .select('canonical_attributes_json')
    .eq('id', productId)
    .single();
  if (error || !product) throw new Error(`INVALID_PRODUCT_DATA: prodotto ${productId} non trovato`);

  const canonical = (product.canonical_attributes_json ?? {}) as Record<string, string>;
  const base = new Map<string, FactAttribute>();
  for (const f of factsFromCanonical(canonical)) base.set(f.fieldKey, f);

  const { data: evidence } = await client
    .from('attribute_evidence')
    .select('field_key, value_json, status, source_type')
    .eq('product_id', productId);

  for (const ev of evidence ?? []) {
    const key = ev.field_key;
    if (ev.status === 'rejected') {
      base.delete(key);
      continue;
    }
    if (ev.status === 'confirmed') {
      const value = typeof ev.value_json === 'string' ? ev.value_json : String(ev.value_json ?? '');
      if (value.trim() !== '') {
        base.set(key, {
          fieldKey: key,
          value,
          status: 'confirmed',
          sourceType: (ev.source_type as FactAttribute['sourceType']) ?? 'manual',
        });
      }
    }
    // inferred_visual / needs_review non confermati: ignorati (non sono fatti).
  }

  return [...base.values()];
}

/**
 * Carica i fatti dal modello v2 (product_attribute_values) usando la chiave/nome
 * dell'attributo del preset. Copre tutti i settori (Moda/Food/Pharma). Se non
 * esistono valori v2, fa fallback su canonical_attributes.
 */
export async function loadProductFactsV2(
  client: TypedClient,
  productId: string,
): Promise<FactAttribute[]> {
  const usable = ['provided', 'extracted_from_file', 'derived', 'confirmed'];
  const { data: rows } = await client
    .from('product_attribute_values')
    .select('attribute_id, value_json, status, source_type')
    .eq('product_id', productId);

  if (!rows || rows.length === 0) return loadProductFacts(client, productId);

  const attrIds = [...new Set(rows.map((r) => r.attribute_id))];
  const { data: attrs } = await client
    .from('attributes')
    .select('id, key, name')
    .in('id', attrIds);
  const attrMap = new Map((attrs ?? []).map((a) => [a.id, a.key ?? a.name]));

  const facts: FactAttribute[] = [];
  for (const r of rows) {
    if (!usable.includes(r.status)) continue;
    const key = attrMap.get(r.attribute_id);
    if (!key) continue;
    const value =
      typeof r.value_json === 'string' ? r.value_json : r.value_json == null ? '' : String(r.value_json);
    if (value.trim() === '') continue;
    facts.push({
      fieldKey: key,
      value,
      status: 'provided',
      sourceType: (r.source_type as FactAttribute['sourceType']) ?? 'csv',
    });
  }
  return facts.length ? facts : loadProductFacts(client, productId);
}
