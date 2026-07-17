import { neutralizeCell } from './csvInjection.js';
import { isExportable } from './factAudit.js';
import type { FactAuditResult, ProductCopy } from './types.js';

// ---------------------------------------------------------------------------
// Costruzione righe di export. Precedenza al testo editato dall'utente; celle
// protette da formula injection; prodotti con severità "high" esclusi.
// ---------------------------------------------------------------------------

export const EXPORT_COLUMNS = [
  'external_id',
  'sku',
  'product_name',
  'generated_title',
  'short_description',
  'long_description',
  'bullet_1',
  'bullet_2',
  'bullet_3',
  'bullet_4',
  'bullet_5',
  'meta_description',
  'verification_status',
  'warnings',
] as const;

export interface ExportRowInput {
  externalId: string | null;
  sku: string | null;
  productName: string | null;
  canonicalAttributes: Record<string, string>;
  generated: ProductCopy;
  edited?: Partial<ProductCopy> | null;
  audit?: FactAuditResult | null;
  verificationStatus: string;
}

/** Ritorna il valore effettivo preferendo l'edit dell'utente al generato. */
function pick<T>(edited: T | undefined, generated: T): T {
  return edited !== undefined && edited !== null ? edited : generated;
}

/**
 * Costruisce una riga di export come record colonna->valore.
 * `extraFactColumns` aggiunge i fatti canonici selezionati.
 */
export function buildExportRow(
  input: ExportRowInput,
  extraFactColumns: string[] = [],
): Record<string, string> {
  const content: ProductCopy = {
    title: pick(input.edited?.title, input.generated.title),
    shortDescription: pick(input.edited?.shortDescription, input.generated.shortDescription),
    longDescription: pick(input.edited?.longDescription, input.generated.longDescription),
    bullets: pick(input.edited?.bullets, input.generated.bullets),
    metaDescription: pick(input.edited?.metaDescription, input.generated.metaDescription),
    usedFactKeys: input.generated.usedFactKeys,
    warnings: input.generated.warnings,
  };

  const bullets = content.bullets ?? [];
  const row: Record<string, string> = {
    external_id: input.externalId ?? '',
    sku: input.sku ?? '',
    product_name: input.productName ?? '',
    generated_title: content.title ?? '',
    short_description: content.shortDescription ?? '',
    long_description: content.longDescription ?? '',
    bullet_1: bullets[0] ?? '',
    bullet_2: bullets[1] ?? '',
    bullet_3: bullets[2] ?? '',
    bullet_4: bullets[3] ?? '',
    bullet_5: bullets[4] ?? '',
    meta_description: content.metaDescription ?? '',
    verification_status: input.verificationStatus,
    warnings: (content.warnings ?? []).join('; '),
  };

  for (const col of extraFactColumns) {
    row[col] = input.canonicalAttributes[col] ?? '';
  }

  // Protezione formula injection su TUTTE le celle.
  for (const key of Object.keys(row)) {
    row[key] = neutralizeCell(row[key]!);
  }

  return row;
}

/** Filtra gli input escludendo i prodotti non esportabili (severità high). */
export function filterExportable<T extends { audit?: FactAuditResult | null }>(inputs: T[]): T[] {
  return inputs.filter((i) => isExportable(i.audit));
}

/** Ordine finale delle colonne (predefinite + fatti extra). */
export function exportColumns(extraFactColumns: string[] = []): string[] {
  return [...EXPORT_COLUMNS, ...extraFactColumns];
}
