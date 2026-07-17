// Costanti condivise dell'applicazione. Nessun segreto qui.

/** Versione del prompt di generazione copy. Da bumpare a ogni cambio semantico. */
export const PRODUCT_COPY_PROMPT_VERSION = 'copy-v1';
export const BRAND_PROFILE_PROMPT_VERSION = 'brand-v1';
export const FACT_AUDIT_PROMPT_VERSION = 'audit-v1';
export const VISUAL_PROMPT_VERSION = 'visual-v1';

/** Bucket storage privati. */
export const STORAGE_BUCKETS = {
  sourceFiles: 'source-files',
  productAssets: 'product-assets',
  exports: 'exports',
} as const;

/** Nome della coda PGMQ per la generazione bulk. */
export const GENERATION_QUEUE = 'generation_jobs';

/** Estensioni file ammesse per upload. */
export const ALLOWED_DATA_EXTENSIONS = ['.csv', '.xlsx'] as const;
export const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
export const ALLOWED_ARCHIVE_EXTENSIONS = ['.zip'] as const;

/** MIME ammessi (validati insieme all'estensione, mai solo il MIME del browser). */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  '.csv': ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};

/** Esplicitamente rifiutati: macro-enabled workbook. */
export const REJECTED_EXTENSIONS = ['.xlsm', '.xls', '.xlsb'] as const;

/** Stati di verifica di un attributo. */
export const ATTRIBUTE_STATUSES = [
  'provided',
  'extracted',
  'inferred_visual',
  'needs_review',
  'confirmed',
  'rejected',
] as const;
export type AttributeStatus = (typeof ATTRIBUTE_STATUSES)[number];

/** Stati usabili come "fatto" nella prosa. */
export const FACT_USABLE_STATUSES: AttributeStatus[] = ['provided', 'extracted', 'confirmed'];

/** Codici errore normalizzati del worker. */
export const ERROR_CODES = [
  'INVALID_PRODUCT_DATA',
  'INSUFFICIENT_FACTS',
  'AI_RATE_LIMIT',
  'AI_TIMEOUT',
  'AI_INVALID_OUTPUT',
  'AI_UNSUPPORTED_CLAIM',
  'STORAGE_ERROR',
  'DATABASE_ERROR',
  'UNKNOWN_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Errori recuperabili → retry. Gli altri sono definitivi. */
export const RETRYABLE_ERROR_CODES: ErrorCode[] = [
  'AI_RATE_LIMIT',
  'AI_TIMEOUT',
  'STORAGE_ERROR',
  'DATABASE_ERROR',
];

/** Claim sensibili controllati in modo deterministico dal fact audit. */
export const SENSITIVE_CLAIMS = [
  'impermeabile',
  'waterproof',
  'traspirante',
  'antibatterico',
  'anallergico',
  'sostenibile',
  'ecologico',
  'riciclato',
  'certificato',
  'made in italy',
  '100% naturale',
] as const;

/** Regole di sicurezza per settore, iniettate nel prompt di generazione. */
export const SECTOR_SAFETY_RULES: Record<string, string[]> = {
  moda: [
    'Non dedurre il materiale dal nome o dalle immagini.',
    'Non usare "impermeabile" al posto di "resistente all\'acqua".',
    'Non usare "sostenibile" o "Made in Italy" se non presenti nei dati.',
  ],
  food: [
    'Non attribuire proprietà dimagranti, detox o curative non dichiarate.',
    'Riporta ingredienti, allergeni e valori nutrizionali SOLO se presenti nei dati.',
    'Non modificare quantità, pesi o percentuali dichiarate.',
  ],
  pharma: [
    'NESSUN claim sanitario, terapeutico o di efficacia.',
    'Non inventare indicazioni, dosaggi, controindicazioni o avvertenze.',
    'Copia i dati dichiarati senza cambiarne il significato; nessuna inferenza clinica.',
  ],
};

/** Claim sensibili aggiuntivi per settore (oltre a SENSITIVE_CLAIMS). */
export const SECTOR_SENSITIVE_CLAIMS: Record<string, string[]> = {
  moda: [],
  food: ['dimagrante', 'detox', 'brucia grassi', 'miracoloso', 'depurativo'],
  pharma: [
    'guarisce',
    'cura',
    'curativo',
    'terapeutico',
    'efficace',
    'clinicamente',
    'previene',
    'diagnosi',
    'antinfiammatorio',
    'antibiotico',
  ],
};

export function sectorSafetyRules(sectorKey: string | undefined): string[] {
  return SECTOR_SAFETY_RULES[sectorKey ?? ''] ?? [];
}

export function sectorSensitiveClaims(sectorKey: string | undefined): string[] {
  return SECTOR_SENSITIVE_CLAIMS[sectorKey ?? ''] ?? [];
}

/** Attributi visuali suggeribili (sempre inferred_visual, richiedono conferma). */
export const VISUAL_WHITELIST = [
  'product_type',
  'apparent_color',
  'pattern',
  'neckline',
  'sleeve_length',
  'visible_closure',
  'visible_details',
  'apparent_length',
] as const;
