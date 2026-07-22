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
export interface ProductFaq {
  question: string;
  answer: string;
}
export interface ProductCopy {
  title: string;
  shortDescription: string;
  longDescription: string;
  bullets: string[];
  metaDescription: string;
  /** Domande e risposte frequenti, basate SOLO sui fatti verificati. */
  faq: ProductFaq[];
  /** Testo alternativo per l'immagine principale (accessibilità + SEO). */
  altText: string;
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
  /** Nome del settore (Moda/Food/Pharma) per contestualizzare la generazione. */
  sectorName?: string;
  /** Istruzioni di generazione configurate nel preset (effetto diretto). */
  presetInstructions?: string[];
  /** Regole di sicurezza per settore (es. Pharma: nessun claim sanitario). */
  safetyRules?: string[];
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

/**
 * Categoria del dato letto dall'immagine, per aiutare le generazioni successive:
 * - onpack_factual: dato oggettivo stampato sul pack (peso, ingredienti, valori
 *   nutrizionali, allergeni, gradazione, produttore…). Verificabile → può essere fatto.
 * - brand: marchio / nome commerciale / logo.
 * - marketing: claim promozionale non verificabile ("gusto unico", "il migliore").
 *   NON deve mai diventare un fatto.
 */
export type VisualValueKind = 'onpack_factual' | 'brand' | 'marketing';

/** Descrittore tipizzato di un campo da estrarre (guida l'estrazione). */
export interface VisualFieldSpec {
  key: string;
  name: string;
  /** text, long_text, boolean, integer, decimal, percentage, enum, multi_enum, ... */
  dataType?: string;
  /** valori ammessi per enum/multi_enum. */
  enumValues?: string[];
  unit?: string;
  /**
   * Campo di CLASSIFICAZIONE (es. categoria merceologica): va sempre compilato
   * scegliendo il valore più adatto in base a ciò che si vede, anche se la
   * parola non è stampata. Deroga alla regola "non dedurre".
   */
  classify?: boolean;
}

/** Attributi visuali estratti dalle immagini, con categoria e confidenza. */
export interface VisualExtraction {
  attributes: Array<{
    fieldKey: string;
    value: string;
    confidence: number;
    kind: VisualValueKind;
  }>;
}

/** Una singola immagine da analizzare: data URL (base64) oppure URL https firmato. */
export interface VisualExtractionImage {
  /** `data:<mime>;base64,<...>` OPPURE un URL https (es. signed URL storage). */
  dataUrl: string;
  mimeType: string;
  label?: string;
}

export interface VisualExtractionInput {
  images: VisualExtractionImage[];
  /** Chiavi consentite come fieldKey (vincolo di output). */
  allowedFields: string[];
  /** Descrittori tipizzati dei campi (guida enum/booleani/numeri). Opzionale. */
  fieldSpecs?: VisualFieldSpec[];
  sectorName?: string;
}

/** Descrittore di un campo del preset. */
export interface PresetFieldDef {
  key: string;
  label: string;
  synonyms: string[];
  factual: boolean;
}
