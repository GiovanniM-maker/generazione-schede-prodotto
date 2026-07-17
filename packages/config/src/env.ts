import { z } from 'zod';

// Schema di validazione dell'ambiente. Usato da web (server) e worker.
// Fail-fast: se una variabile richiesta manca in produzione, l'app non parte.

const boolFromString = z
  .string()
  .transform((v) => v === 'true' || v === '1')
  .pipe(z.boolean());

const numberFromString = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite());

/** Variabili condivise da server web e worker. */
export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_DB_URL: z.string().min(1),

    OPENAI_API_KEY: z.string().optional().default(''),
    OPENAI_MODEL_BRAND_PROFILE: z.string().default('gpt-4o-mini'),
    OPENAI_MODEL_COPY: z.string().default('gpt-4o-mini'),
    OPENAI_MODEL_VISUAL: z.string().default('gpt-4o-mini'),
    OPENAI_MODEL_AUDIT: z.string().default('gpt-4o-mini'),

    STRIPE_SECRET_KEY: z.string().optional().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
    STRIPE_PRICE_PACK_50: z.string().optional().default(''),
    STRIPE_PRICE_PACK_200: z.string().optional().default(''),
    STRIPE_PRICE_PACK_500: z.string().optional().default(''),

    WORKER_CONCURRENCY: numberFromString(3),
    WORKER_POLL_INTERVAL_MS: numberFromString(2000),
    WORKER_VISIBILITY_TIMEOUT_SECONDS: numberFromString(300),
    MAX_JOB_ATTEMPTS: numberFromString(3),

    MAX_CSV_SIZE_MB: numberFromString(10),
    MAX_XLSX_SIZE_MB: numberFromString(20),
    MAX_IMAGE_SIZE_MB: numberFromString(8),
    MAX_IMAGES_PER_BATCH: numberFromString(300),
    MAX_PRODUCTS_PER_BATCH: numberFromString(500),

    WELCOME_CREDITS: numberFromString(3),
    MAX_SAMPLE_REGENERATIONS: numberFromString(5),
    MANUAL_REGEN_CONSUMES_CREDIT: boolFromString.default('false'),

    ENABLE_MOCK_AI: boolFromString.default('false'),
    ENABLE_MOCK_BILLING: boolFromString.default('false'),
  })
  .superRefine((env, ctx) => {
    // I mock non devono MAI essere attivi in produzione.
    if (env.NODE_ENV === 'production') {
      if (env.ENABLE_MOCK_AI) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ENABLE_MOCK_AI non può essere true in produzione',
          path: ['ENABLE_MOCK_AI'],
        });
      }
      if (env.ENABLE_MOCK_BILLING) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ENABLE_MOCK_BILLING non può essere true in produzione',
          path: ['ENABLE_MOCK_BILLING'],
        });
      }
      // In produzione con AI reale serve la chiave.
      if (!env.ENABLE_MOCK_AI && !env.OPENAI_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'OPENAI_API_KEY richiesta in produzione quando i mock AI sono disattivi',
          path: ['OPENAI_API_KEY'],
        });
      }
      if (!env.ENABLE_MOCK_BILLING && !env.STRIPE_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'STRIPE_SECRET_KEY richiesta in produzione quando i mock billing sono disattivi',
          path: ['STRIPE_SECRET_KEY'],
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Legge e valida process.env una sola volta. Lancia se invalido. */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configurazione ambiente non valida:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Solo per i test: azzera la cache. */
export function resetEnvCache(): void {
  cached = null;
}
