import { NON_ADDITIONAL_FIELDS } from './preset.js';
import type { BuiltProduct } from './products.js';
import type { QualityLevel } from './types.js';

// ---------------------------------------------------------------------------
// Calcolo data_quality_score (0-100) ed eleggibilità alla generazione.
// ---------------------------------------------------------------------------

export interface QualityResult {
  score: number;
  level: QualityLevel;
  eligible: boolean;
  reasons: string[]; // motivi di esclusione o warning
  factCount: number;
}

function has(product: BuiltProduct, key: string): boolean {
  const v = product.canonicalAttributes[key];
  return typeof v === 'string' && v.trim() !== '';
}

/** Numero di attributi fattuali "aggiuntivi" non vuoti (esclusi id/nome/tipo). */
export function countAdditionalFacts(product: BuiltProduct): number {
  return Object.entries(product.canonicalAttributes).filter(
    ([k, v]) => !NON_ADDITIONAL_FIELDS.has(k) && typeof v === 'string' && v.trim() !== '',
  ).length;
}

export function computeQuality(product: BuiltProduct, opts?: { hasImages?: boolean }): QualityResult {
  const reasons: string[] = [];
  let score = 0;

  const hasIdentifier = has(product, 'external_id') || has(product, 'sku');
  const hasNameOrType = has(product, 'product_name') || has(product, 'product_type');

  if (hasIdentifier) score += 20;
  else reasons.push('Manca identificativo (external_id o SKU)');

  if (hasNameOrType) score += 20;
  else reasons.push('Manca nome o tipologia');

  const additional = countAdditionalFacts(product);
  if (additional >= 1) score += 15;
  if (additional >= 2) score += 15;

  if (has(product, 'composition') || has(product, 'material')) score += 10;
  if (has(product, 'color')) score += 5;
  if (has(product, 'fit')) score += 5;
  if (has(product, 'details')) score += 5;
  if (opts?.hasImages) score += 5;

  if (score > 100) score = 100;

  let level: QualityLevel;
  if (score >= 80) level = 'buono';
  else if (score >= 60) level = 'parziale';
  else level = 'insufficiente';

  // Eleggibilità: identificativo + nome/tipo + almeno 2 fatti aggiuntivi.
  const eligible = hasIdentifier && hasNameOrType && additional >= 2;
  if (!eligible && additional < 2) {
    reasons.push('Servono almeno due attributi fattuali aggiuntivi');
  }

  return { score, level, eligible, reasons, factCount: additional };
}
