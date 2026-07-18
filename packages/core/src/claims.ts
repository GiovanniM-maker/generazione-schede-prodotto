import { SENSITIVE_CLAIMS } from '@app/config';
import type { FactAttribute } from './types.js';

// ---------------------------------------------------------------------------
// Rilevamento deterministico di claim sensibili (case-insensitive) nel testo
// generato che non trovano supporto nei fatti forniti.
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** True se il testo contiene il claim come parola/frase (case-insensitive). */
export function containsClaim(text: string, claim: string): boolean {
  const nt = normalize(text);
  const nc = normalize(claim);
  // Confine di parola tramite regex escaping.
  const escaped = nc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'u');
  return re.test(nt);
}

/**
 * True se un claim è supportato da almeno un fatto ammesso.
 *
 * SICUREZZA (backstop deterministico): il supporto usa il match a CONFINE DI
 * PAROLA (come containsClaim), non un `includes` grezzo. Questo evita due
 * bypass gravi:
 *  - un fatto con valore VUOTO non deve "supportare" ogni claim (con includes,
 *    "".includes o includes("") risultavano sempre veri → audit disattivato);
 *  - un claim non deve risultare supportato per sotto-stringa accidentale
 *    (es. "cura" dentro "accurata"/"sicura").
 */
export function claimSupportedByFacts(
  claim: string,
  facts: FactAttribute[],
  usableStatuses: string[],
): boolean {
  const nc = normalize(claim);
  if (nc === '') return true; // claim vuoto: niente da verificare
  return facts.some((f) => {
    if (!usableStatuses.includes(f.status)) return false;
    const valueOk = f.value.trim() !== '' && containsClaim(f.value, claim);
    // La chiave dell'attributo (es. "sustainability_claims") può nominare il
    // claim: normalizza gli underscore a spazi per il match a parola.
    const keyText = (f.fieldKey ?? '').replace(/[_-]+/g, ' ');
    const keyOk = keyText.trim() !== '' && containsClaim(keyText, claim);
    return valueOk || keyOk;
  });
}

export interface UnsupportedClaimDetection {
  claim: string;
  foundIn: string;
}

/**
 * Cerca claim sensibili presenti nel testo ma NON supportati dai fatti.
 * `usableStatuses` sono gli stati che contano come fatto verificato.
 */
export function detectUnsupportedClaims(
  text: string,
  facts: FactAttribute[],
  usableStatuses: string[],
  claims: readonly string[] = SENSITIVE_CLAIMS,
): UnsupportedClaimDetection[] {
  const found: UnsupportedClaimDetection[] = [];
  for (const claim of claims) {
    if (containsClaim(text, claim) && !claimSupportedByFacts(claim, facts, usableStatuses)) {
      found.push({ claim, foundIn: text.slice(0, 200) });
    }
  }
  return found;
}
