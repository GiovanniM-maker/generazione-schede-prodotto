import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemi Zod + JSON Schema (strict) per gli Structured Outputs OpenAI.
// ---------------------------------------------------------------------------

export const productCopySchema = z.object({
  title: z.string().max(80),
  shortDescription: z.string(),
  longDescription: z.string(),
  bullets: z.array(z.string()),
  metaDescription: z.string().max(155),
  usedFactKeys: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type ProductCopySchema = z.infer<typeof productCopySchema>;

export const brandProfileSchema = z.object({
  style: z.string(),
  formality: z.string(),
  sentenceLength: z.string(),
  person: z.string(),
  preferredWords: z.array(z.string()),
  forbiddenWords: z.array(z.string()),
  structure: z.object({
    shortDescriptionSentences: z.number().int(),
    longDescriptionMinWords: z.number().int(),
    longDescriptionMaxWords: z.number().int(),
    bulletCount: z.number().int(),
  }),
  ctaPolicy: z.string(),
  seoPolicy: z.string(),
  summary: z.string(),
});
export type BrandProfileSchema = z.infer<typeof brandProfileSchema>;

export const factAuditSchema = z.object({
  passed: z.boolean(),
  unsupportedClaims: z.array(z.string()),
  conflicts: z.array(z.string()),
  severity: z.enum(['none', 'low', 'medium', 'high']),
  recommendedStatus: z.enum(['generated', 'needs_review', 'rejected']),
});
export type FactAuditSchema = z.infer<typeof factAuditSchema>;

export const visualExtractionSchema = z.object({
  attributes: z.array(
    z.object({
      fieldKey: z.string(),
      value: z.string(),
      confidence: z.number(),
    }),
  ),
});
export type VisualExtractionSchema = z.infer<typeof visualExtractionSchema>;

// --- JSON Schema equivalenti per l'API Responses (Structured Outputs strict) ---
// additionalProperties:false e required su tutte le proprietà, come richiesto.

export const PRODUCT_COPY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    shortDescription: { type: 'string' },
    longDescription: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    metaDescription: { type: 'string' },
    usedFactKeys: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'title',
    'shortDescription',
    'longDescription',
    'bullets',
    'metaDescription',
    'usedFactKeys',
    'warnings',
  ],
} as const;

export const BRAND_PROFILE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    style: { type: 'string' },
    formality: { type: 'string' },
    sentenceLength: { type: 'string' },
    person: { type: 'string' },
    preferredWords: { type: 'array', items: { type: 'string' } },
    forbiddenWords: { type: 'array', items: { type: 'string' } },
    structure: {
      type: 'object',
      additionalProperties: false,
      properties: {
        shortDescriptionSentences: { type: 'integer' },
        longDescriptionMinWords: { type: 'integer' },
        longDescriptionMaxWords: { type: 'integer' },
        bulletCount: { type: 'integer' },
      },
      required: [
        'shortDescriptionSentences',
        'longDescriptionMinWords',
        'longDescriptionMaxWords',
        'bulletCount',
      ],
    },
    ctaPolicy: { type: 'string' },
    seoPolicy: { type: 'string' },
    summary: { type: 'string' },
  },
  required: [
    'style',
    'formality',
    'sentenceLength',
    'person',
    'preferredWords',
    'forbiddenWords',
    'structure',
    'ctaPolicy',
    'seoPolicy',
    'summary',
  ],
} as const;

export const FACT_AUDIT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passed: { type: 'boolean' },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    conflicts: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    recommendedStatus: {
      type: 'string',
      enum: ['generated', 'needs_review', 'rejected'],
    },
  },
  required: ['passed', 'unsupportedClaims', 'conflicts', 'severity', 'recommendedStatus'],
} as const;

export const VISUAL_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attributes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fieldKey: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['fieldKey', 'value', 'confidence'],
      },
    },
  },
  required: ['attributes'],
} as const;
