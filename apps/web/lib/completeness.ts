import type { BadgeTone } from '@/components/ui/badge';

// Helper client-safe per la completezza scheda. NON importa @app/core
// (che trascina node:crypto e non è utilizzabile nei client component):
// duplica la piccola mappa di etichette/toni di DECISION_LABELS.

export type CompletenessStatus =
  | 'complete'
  | 'partial'
  | 'insufficient'
  | 'needs_review'
  | 'blocked';

export interface Completeness {
  status: CompletenessStatus;
  missingAttributes: string[];
  usedAttributes: string[];
  /** Spiegazione del blocco/insufficienza (null se non pertinente). */
  reason: string | null;
}

const STATUSES: readonly CompletenessStatus[] = [
  'complete',
  'partial',
  'insufficient',
  'needs_review',
  'blocked',
];

// Etichette italiane — allineate a DECISION_LABELS di @app/core.
export const COMPLETENESS_LABELS: Record<CompletenessStatus, string> = {
  complete: 'Scheda completa',
  partial: 'Scheda parziale',
  insufficient: 'Dati insufficienti',
  needs_review: 'Da verificare',
  blocked: 'Bloccato',
};

// Colori badge: verde=complete, ambra=partial/needs_review, rosso=blocked, grigio=insufficient.
export const COMPLETENESS_TONES: Record<CompletenessStatus, BadgeTone> = {
  complete: 'green',
  partial: 'amber',
  needs_review: 'amber',
  blocked: 'red',
  insufficient: 'gray',
};

export function isCompletenessStatus(v: unknown): v is CompletenessStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** Normalizza un valore `completeness_json` grezzo in un oggetto tipizzato. */
export function normalizeCompleteness(v: unknown): Completeness | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isCompletenessStatus(o.status)) return null;
  const toStringArray = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [];
  return {
    status: o.status,
    missingAttributes: toStringArray(o.missingAttributes),
    usedAttributes: toStringArray(o.usedAttributes),
    reason: typeof o.reason === 'string' ? o.reason : null,
  };
}
