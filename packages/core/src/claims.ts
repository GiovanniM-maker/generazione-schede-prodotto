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

/** True se un claim è supportato da almeno un fatto ammesso. */
export function claimSupportedByFacts(
  claim: string,
  facts: FactAttribute[],
  usableStatuses: string[],
): boolean {
  const nc = normalize(claim);
  return facts.some((f) => {
    if (!usableStatuses.includes(f.status)) return false;
    const fv = normalize(f.value);
    const fk = normalize(f.fieldKey);
    return fv.includes(nc) || nc.includes(fv) || fk.includes(nc);
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
