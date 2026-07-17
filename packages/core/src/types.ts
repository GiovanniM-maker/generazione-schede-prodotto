import type { AttributeStatus } from '@app/config';

// ---------------------------------------------------------------------------
// Tipi di dominio condivisi. "I dati possiedono i fatti. L'AI possiede la prosa."
// ---------------------------------------------------------------------------

/** Un attributo fattuale con provenienza e stato di verifica. */
export interface FactAttribute {
  fieldKey: string;
  value: string;
  status: AttributeStatus;
  sourceType: 'csv' | 'xlsx' | 'manual' | 'image' | 'system';
  evidenceText?: string | null;
  confidence?: number | null;
}

/** Riga grezza di un file importato: header originale -> valore stringa. */
export type RawRow = Record<string, string>;

/** Livello di qualità dati. */
export type QualityLevel = 'buono' | 'parziale' | 'insufficiente';

/** Profilo tono del brand (profile_json). */
export interface BrandProfile {
  style: string;
  formality: string;
  sentenceLength: string;
  person: string;
  preferredWords: string[];
  forbiddenWords: string[];
  structure: {
    shortDescriptionSentences: number;
    longDescriptionMinWords: number;
    longDescriptionMaxWords: number;
    bulletCount: number;
  };
  ctaPolicy: string;
  seoPolicy: string;
  summary?: string;
}

/** Output di generazione copy prodotto. */
export interface ProductCopy {
  title: string;
  shortDescription: string;
  longDescription: string;
  bullets: string[];
  metaDescription: string;
  usedFactKeys: string[];
  warnings: string[];
}

/** Input per la generazione copy: SOLO fatti ammessi + tono. */
export interface ProductCopyInput {
  presetVersion: string;
  facts: FactAttribute[];
  brandProfile: BrandProfile;
  language: 'it';
  requestedOutput: string[];
}

/** Input generazione profilo tono. */
export interface BrandProfileInput {
  selectedStyle: string;
  examples: string[];
  forbiddenWords?: string[];
  guidance?: string;
}

export type AuditSeverity = 'none' | 'low' | 'medium' | 'high';

/** Risultato del fact audit. */
export interface FactAuditResult {
  passed: boolean;
  unsupportedClaims: string[];
  conflicts: string[];
  severity: AuditSeverity;
  recommendedStatus: 'generated' | 'needs_review' | 'rejected';
}

export interface FactAuditInput {
  facts: FactAttribute[];
  content: ProductCopy;
}

/** Attributi visuali inferiti (sempre da confermare). */
export interface VisualExtraction {
  attributes: Array<{
    fieldKey: string;
    value: string;
    confidence: number;
  }>;
}

export interface VisualExtractionInput {
  imageRefs: string[];
  allowedFields: string[];
}

/** Descrittore di un campo del preset. */
export interface PresetFieldDef {
  key: string;
  label: string;
  synonyms: string[];
  factual: boolean;
}
