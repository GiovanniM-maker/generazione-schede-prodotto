import { isEmptyValue } from './normalize.js';
import { getFieldDef } from './preset.js';
import type { FactAttribute, RawRow } from './types.js';

// ---------------------------------------------------------------------------
// Costruzione prodotti canonici da righe grezze + mapping colonne.
// mapping: fieldKey -> header originale.
// ---------------------------------------------------------------------------

export type ColumnMapping = Record<string, string>; // fieldKey -> header

export interface BuiltProduct {
  externalId: string | null;
  parentExternalId: string | null;
  name: string | null;
  productType: string | null;
  category: string | null;
  sku: string | null;
  rawInput: RawRow;
  canonicalAttributes: Record<string, string>;
  facts: FactAttribute[];
}

/** Inverte il mapping fieldKey->header per estrarre i valori dalla riga. */
export function extractField(row: RawRow, mapping: ColumnMapping, fieldKey: string): string | null {
  const header = mapping[fieldKey];
  if (!header) return null;
  const value = row[header];
  if (value === undefined) return null;
  if (isEmptyValue(value)) return null;
  return value;
}

/** Costruisce un singolo prodotto canonico da una riga. */
export function buildProduct(
  row: RawRow,
  mapping: ColumnMapping,
  sourceType: 'csv' | 'xlsx' = 'csv',
): BuiltProduct {
  const canonical: Record<string, string> = {};
  const facts: FactAttribute[] = [];

  for (const fieldKey of Object.keys(mapping)) {
    const def = getFieldDef(fieldKey);
    if (!def) continue;
    const value = extractField(row, mapping, fieldKey);
    if (value === null) continue;
    canonical[fieldKey] = value;
    if (def.factual) {
      facts.push({
        fieldKey,
        value,
        status: 'provided',
        sourceType,
      });
    }
  }

  return {
    externalId: canonical['external_id'] ?? null,
    parentExternalId: canonical['parent_external_id'] ?? null,
    name: canonical['product_name'] ?? null,
    productType: canonical['product_type'] ?? null,
    category: canonical['category'] ?? null,
    sku: canonical['sku'] ?? null,
    rawInput: row,
    canonicalAttributes: canonical,
    facts,
  };
}

export function buildProducts(
  rows: RawRow[],
  mapping: ColumnMapping,
  sourceType: 'csv' | 'xlsx' = 'csv',
): BuiltProduct[] {
  return rows.map((r) => buildProduct(r, mapping, sourceType));
}

// ---------------------------------------------------------------------------
// Raggruppamento varianti: se esiste parent_external_id, raggruppa i figli.
// In assenza di parent, ogni riga è un prodotto indipendente.
// ---------------------------------------------------------------------------

export interface ProductGroup {
  parent: BuiltProduct;
  variants: BuiltProduct[]; // vuoto se prodotto singolo
}

export function groupVariants(products: BuiltProduct[]): ProductGroup[] {
  const byExternalId = new Map<string, BuiltProduct>();
  for (const p of products) {
    if (p.externalId) byExternalId.set(p.externalId, p);
  }

  const groups = new Map<string, ProductGroup>();
  const singles: ProductGroup[] = [];

  for (const p of products) {
    const parentId = p.parentExternalId;
    if (parentId && parentId !== p.externalId) {
      // È una variante di parentId.
      let group = groups.get(parentId);
      if (!group) {
        const parentProduct = byExternalId.get(parentId);
        group = {
          // Se il parent esplicito esiste come riga usa quello, altrimenti
          // promuovi la prima variante a rappresentante del gruppo.
          parent: parentProduct ?? p,
          variants: [],
        };
        groups.set(parentId, group);
      }
      // Non aggiungere il parent stesso tra le varianti.
      if (p.externalId !== parentId) group.variants.push(p);
    } else if (p.externalId && groups.has(p.externalId)) {
      // Il parent è arrivato dopo le varianti: assegnalo.
      const g = groups.get(p.externalId)!;
      g.parent = p;
    } else if (!groups.has(p.externalId ?? '__none__')) {
      singles.push({ parent: p, variants: [] });
    }
  }

  return [...groups.values(), ...singles];
}
