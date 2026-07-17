import { FACT_USABLE_STATUSES } from '@app/config';
import { detectUnsupportedClaims } from './claims.js';
import type { FactAttribute, FactAuditResult, ProductCopy, AuditSeverity } from './types.js';

// ---------------------------------------------------------------------------
// Fact audit: combina controlli deterministici sui claim sensibili con un
// eventuale risultato AI. Non cancella mai il contenuto; imposta lo stato.
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: AuditSeverity[] = ['none', 'low', 'medium', 'high'];

function maxSeverity(a: AuditSeverity, b: AuditSeverity): AuditSeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

/** Concatena tutti i testi generati per l'analisi. */
export function collectGeneratedText(content: ProductCopy): string {
  return [
    content.title,
    content.shortDescription,
    content.longDescription,
    ...(content.bullets ?? []),
    content.metaDescription,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Audit deterministico locale: rileva claim sensibili non supportati dai fatti.
 * Ogni claim sensibile non supportato è considerato severità almeno "high"
 * perché tratta di attributi tecnici/legali (impermeabile, made in italy, ...).
 */
export function deterministicAudit(
  facts: FactAttribute[],
  content: ProductCopy,
): FactAuditResult {
  const text = collectGeneratedText(content);
  const unsupported = detectUnsupportedClaims(text, facts, FACT_USABLE_STATUSES);

  const unsupportedClaims = unsupported.map((u) => u.claim);
  // L'audit deterministico produce solo "none" o "high": un claim sensibile
  // non supportato è sempre grave. La severità intermedia arriva dall'audit AI.
  const severity: AuditSeverity = unsupportedClaims.length > 0 ? 'high' : 'none';

  return {
    passed: severity === 'none',
    unsupportedClaims,
    conflicts: [],
    severity,
    recommendedStatus: severity === 'high' ? 'rejected' : 'generated',
  };
}

/**
 * Unisce l'audit deterministico con quello AI (opzionale). Prende la severità
 * più alta e l'unione dei claim/conflitti. Lo stato consigliato deriva dalla
 * severità finale.
 */
export function mergeAudits(
  deterministic: FactAuditResult,
  ai?: FactAuditResult | null,
): FactAuditResult {
  if (!ai) return deterministic;
  const severity = maxSeverity(deterministic.severity, ai.severity);
  const unsupportedClaims = [
    ...new Set([...deterministic.unsupportedClaims, ...ai.unsupportedClaims]),
  ];
  const conflicts = [...new Set([...deterministic.conflicts, ...ai.conflicts])];
  const recommendedStatus =
    severity === 'high' ? 'rejected' : severity === 'medium' ? 'needs_review' : 'generated';
  return {
    passed: severity === 'none' || severity === 'low',
    unsupportedClaims,
    conflicts,
    severity,
    recommendedStatus,
  };
}

/** Mappa severità -> stato del product_generation. */
export function statusFromAudit(audit: FactAuditResult): 'generated' | 'needs_review' | 'rejected' {
  if (audit.severity === 'high') return 'rejected';
  if (audit.severity === 'medium') return 'needs_review';
  return 'generated';
}

/** Un prodotto è esportabile se la severità non è "high". */
export function isExportable(audit: FactAuditResult | null | undefined): boolean {
  if (!audit) return true;
  return audit.severity !== 'high';
}
