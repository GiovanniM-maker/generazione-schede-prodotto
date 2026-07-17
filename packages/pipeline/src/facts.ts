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
