import { z } from 'zod';
import type { ProductCopy, ProductFaq } from './types.js';

// ---------------------------------------------------------------------------
// Traduzione multilingua dell'output generato. Principio invariato: la
// traduzione NON può aggiungere claim — traduce fedelmente il testo già
// verificato dall'audit, senza inventare né omettere dati.
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'Inglese' },
  { code: 'fr', name: 'Francese' },
  { code: 'de', name: 'Tedesco' },
  { code: 'es', name: 'Spagnolo' },
  { code: 'pt', name: 'Portoghese' },
  { code: 'nl', name: 'Olandese' },
] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export function isSupportedLanguage(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

/** Parte TRADUCIBILE della copy (esclude usedFactKeys/warnings, che restano IT). */
export interface TranslatedCopy {
  title: string;
  shortDescription: string;
  longDescription: string;
  bullets: string[];
  metaDescription: string;
  faq: ProductFaq[];
  altText: string;
}

/** Mappa lingua → copy tradotta, salvata su product_generations.translations_json. */
export type TranslationsMap = Partial<Record<LanguageCode, TranslatedCopy>>;

export interface TranslateCopyInput {
  /** Contenuto di partenza (italiano), già passato dall'audit. */
  content: TranslatedCopy;
  /** Codice lingua di destinazione (es. 'en'). */
  targetLanguage: LanguageCode;
  /** Nome del settore per il lessico (Moda/Food/Pharma). */
  sectorName?: string;
}

export const translatedCopySchema = z.object({
  title: z.string(),
  shortDescription: z.string(),
  longDescription: z.string(),
  bullets: z.array(z.string()),
  metaDescription: z.string(),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  altText: z.string(),
});
export type TranslatedCopySchema = z.infer<typeof translatedCopySchema>;

export const TRANSLATED_COPY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    shortDescription: { type: 'string' },
    longDescription: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    metaDescription: { type: 'string' },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
        required: ['question', 'answer'],
      },
    },
    altText: { type: 'string' },
  },
  required: ['title', 'shortDescription', 'longDescription', 'bullets', 'metaDescription', 'faq', 'altText'],
} as const;

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'inglese',
  fr: 'francese',
  de: 'tedesco',
  es: 'spagnolo',
  pt: 'portoghese',
  nl: 'olandese',
};

export const TRANSLATION_SYSTEM_PROMPT = [
  'Sei un traduttore professionale specializzato in schede prodotto e-commerce.',
  'Traduci FEDELMENTE: non aggiungere informazioni, claim o aggettivi non presenti nel testo di partenza; non omettere nulla.',
  'Numeri, unità di misura, percentuali, codici e denominazioni protette (es. DOP, IGP, DOCG) restano IDENTICI.',
  'I nomi di brand e i nomi propri NON si traducono.',
  'Adatta con naturalezza la resa (non tradurre parola per parola), rispettando il registro del testo.',
].join(' ');

export function buildTranslationUserPrompt(input: TranslateCopyInput): string {
  const lang = LANGUAGE_LABELS[input.targetLanguage];
  const c = input.content;
  const faqLines = c.faq.map((f, i) => `FAQ${i + 1}: D: ${f.question} | R: ${f.answer}`).join('\n');
  return [
    `Traduci in ${lang} questa scheda prodotto${input.sectorName ? ` (settore: ${input.sectorName})` : ''}.`,
    'Testo di partenza (italiano):',
    '<<<TESTO',
    `titolo: ${c.title}`,
    `descrizione breve: ${c.shortDescription}`,
    `descrizione lunga: ${c.longDescription}`,
    ...c.bullets.map((b, i) => `punto ${i + 1}: ${b}`),
    `meta description: ${c.metaDescription}`,
    faqLines,
    `alt text: ${c.altText}`,
    'TESTO>>>',
    '',
    `Rispetta i limiti: title max 80 caratteri, metaDescription max 155 caratteri.`,
    `Mantieni lo stesso numero di bullets (${c.bullets.length}) e di FAQ (${c.faq.length}).`,
    'Restituisci SOLO JSON: { "title", "shortDescription", "longDescription", "bullets"[], "metaDescription", "faq"[{"question","answer"}], "altText" }.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Estrae la parte traducibile da una ProductCopy completa. */
export function toTranslatableCopy(copy: ProductCopy): TranslatedCopy {
  return {
    title: copy.title ?? '',
    shortDescription: copy.shortDescription ?? '',
    longDescription: copy.longDescription ?? '',
    bullets: copy.bullets ?? [],
    metaDescription: copy.metaDescription ?? '',
    faq: copy.faq ?? [],
    altText: copy.altText ?? '',
  };
}
