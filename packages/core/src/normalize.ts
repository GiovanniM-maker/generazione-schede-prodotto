// ---------------------------------------------------------------------------
// Normalizzazione valori celle. Distingue valore mancante da stringa vuota,
// preserva gli zeri iniziali degli SKU/codici, non converte codici in numeri.
// ---------------------------------------------------------------------------

/** Sentinella per "cella assente" (colonna non presente nella riga). */
export const MISSING = Symbol('missing');
export type CellValue = string | typeof MISSING;

/** Normalizza whitespace preservando il contenuto testuale. */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizza il valore di una cella per l'uso come fatto.
 * - trim + collasso spazi
 * - NON tocca zeri iniziali (es. "007123" resta "007123")
 * - restituisce '' per stringa vuota (che è diverso da MISSING/assente)
 */
export function normalizeCell(raw: string): string {
  return normalizeWhitespace(raw);
}

/** True se il valore è di fatto vuoto (assente o stringa vuota dopo trim). */
export function isEmptyValue(v: CellValue): boolean {
  return v === MISSING || v.trim() === '';
}

/**
 * Divide un valore multi-valore separato da virgola o punto e virgola.
 * Usato per taglie, dettagli, ecc. Mantiene i singoli valori normalizzati.
 */
export function splitMultiValue(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((s) => normalizeWhitespace(s))
    .filter((s) => s.length > 0);
}

/**
 * Determina se un valore "sembra" un codice/SKU che va preservato come stringa.
 * (zeri iniziali, lettere, trattini). Usato solo per documentare l'intento:
 * i valori restano SEMPRE stringhe, non vengono mai coerciti a numero.
 */
export function looksLikeCode(raw: string): boolean {
  const v = raw.trim();
  if (v === '') return false;
  if (/^0\d+/.test(v)) return true; // zero iniziale
  if (/[a-zA-Z\-_]/.test(v)) return true;
  return false;
}
