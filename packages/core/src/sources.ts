// ---------------------------------------------------------------------------
// Analisi delle sorgenti di un batch (righe strutturate + immagini), unione via
// SKU esatto (mai fuzzy/AI/ordine), rilevamento conflitti, priorità sorgenti,
// stati attributo e decisione di generazione parziale.
// ---------------------------------------------------------------------------

/** Stati possibili di un attributo per prodotto. */
export const ATTRIBUTE_VALUE_STATES = [
  'provided',
  'extracted_from_file',
  'extracted_from_image',
  'inferred_visual',
  'derived',
  'missing',
  'not_applicable',
  'needs_confirmation',
  'invalid',
  'confirmed',
  'rejected',
] as const;
export type AttributeValueState = (typeof ATTRIBUTE_VALUE_STATES)[number];

/** Stati il cui valore è utilizzabile come fatto nella generazione. */
export const USABLE_ATTRIBUTE_STATES: AttributeValueState[] = [
  'provided',
  'extracted_from_file',
  'derived',
  'confirmed',
];

/** Tipi di sorgente di un valore, in ordine di priorità (indice minore = più forte). */
export const SOURCE_PRIORITY: AttributeValueState[] = [
  'confirmed', // confermato manualmente
  'provided', // dato strutturato CSV/XLSX
  'extracted_from_file', // dichiarato da fonte tecnica/file
  'extracted_from_image', // estratto da immagine
  'inferred_visual', // inferito visivamente
  'missing',
];

/** Sceglie il valore vincente tra più candidati secondo la priorità sorgenti. */
export function resolveWinningValue<T extends { state: AttributeValueState }>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  const rank = (s: AttributeValueState) => {
    const i = SOURCE_PRIORITY.indexOf(s);
    return i === -1 ? SOURCE_PRIORITY.length : i;
  };
  return [...candidates].sort((a, b) => rank(a.state) - rank(b.state))[0]!;
}

export interface SourceAnalysisInput {
  /** SKU (già estratti/normalizzati) presenti nelle righe strutturate. */
  fileSkus: string[];
  /** SKU (già estratti dai nomi file) presenti nelle immagini. */
  imageSkus: string[];
  /** Nomi file immagine senza SKU valido. */
  filesWithoutSku?: string[];
  /** Righe strutturate senza SKU (conteggio). */
  rowsWithoutSku?: number;
}

export interface SourceAnalysis {
  inBoth: string[];
  onlyFile: string[];
  onlyImages: string[];
  duplicateFileSkus: string[];
  filesWithoutSku: string[];
  rowsWithoutSku: number;
  totalUniqueSkus: number;
}

/** Confronta gli SKU delle due sorgenti. Nessun matching fuzzy: solo esatto. */
export function analyzeSources(input: SourceAnalysisInput): SourceAnalysis {
  const fileSet = new Set(input.fileSkus);
  const imageSet = new Set(input.imageSkus);

  // Duplicati nelle righe file.
  const counts = new Map<string, number>();
  for (const s of input.fileSkus) counts.set(s, (counts.get(s) ?? 0) + 1);
  const duplicateFileSkus = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);

  const inBoth: string[] = [];
  const onlyFile: string[] = [];
  const onlyImages: string[] = [];

  for (const s of fileSet) {
    if (imageSet.has(s)) inBoth.push(s);
    else onlyFile.push(s);
  }
  for (const s of imageSet) {
    if (!fileSet.has(s)) onlyImages.push(s);
  }

  const union = new Set([...fileSet, ...imageSet]);

  return {
    inBoth,
    onlyFile,
    onlyImages,
    duplicateFileSkus,
    filesWithoutSku: input.filesWithoutSku ?? [],
    rowsWithoutSku: input.rowsWithoutSku ?? 0,
    totalUniqueSkus: union.size,
  };
}

// ---------------------------------------------------------------------------
// Decisione di generazione: blocca vs parziale vs completa.
// ---------------------------------------------------------------------------

export type ProductGenerationDecision =
  | 'complete'
  | 'partial'
  | 'insufficient'
  | 'needs_review'
  | 'blocked';

export interface GenerationEligibilityInput {
  hasSku: boolean;
  hasAnySource: boolean; // almeno una fonte (riga o immagini)
  presentRequiredAttributes: number;
  totalRequiredAttributes: number;
  presentOptionalAttributes: number;
  hasBlockingConflict: boolean;
}

/**
 * Regole (spec §15):
 * - BLOCCA se manca SKU, manca ogni fonte, o c'è un conflitto bloccante non risolto,
 *   o tutti gli attributi minimi del preset sono assenti.
 * - PARZIALE se c'è SKU, almeno una fonte, alcuni attributi presenti, mancanti non bloccanti.
 * - COMPLETA se tutti gli attributi obbligatori sono presenti.
 */
export function decideGeneration(input: GenerationEligibilityInput): ProductGenerationDecision {
  if (!input.hasSku) return 'blocked';
  if (!input.hasAnySource) return 'blocked';
  if (input.hasBlockingConflict) return 'blocked';

  const anyAttribute = input.presentRequiredAttributes + input.presentOptionalAttributes > 0;
  const allRequiredMissing =
    input.totalRequiredAttributes > 0 && input.presentRequiredAttributes === 0;

  if (allRequiredMissing && !anyAttribute) return 'insufficient';

  if (
    input.totalRequiredAttributes > 0 &&
    input.presentRequiredAttributes >= input.totalRequiredAttributes
  ) {
    return 'complete';
  }

  if (anyAttribute) return 'partial';
  return 'insufficient';
}

// ---------------------------------------------------------------------------
// Conflitti tra sorgenti.
// ---------------------------------------------------------------------------

export type ConflictType =
  | 'color_csv_vs_image'
  | 'duplicate_sku_rows'
  | 'same_sku_different_categories'
  | 'image_without_matching_sku'
  | 'missing_required_attribute'
  | 'invalid_value';

export interface SourceConflict {
  type: ConflictType;
  sku: string | null;
  field?: string;
  detail: string;
  blocking: boolean;
}

/** Un conflitto è bloccante se impedisce una generazione sensata. */
export function isBlockingConflict(type: ConflictType): boolean {
  return type === 'duplicate_sku_rows' || type === 'same_sku_different_categories';
}
