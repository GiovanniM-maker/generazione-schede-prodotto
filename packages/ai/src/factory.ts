import type { ServerEnv } from '@app/config';
import type { AiProviders } from './interfaces.js';
import { createMockProviders } from './mock.js';
import { OpenAiProviders } from './openai.js';
import { OpenRouterProviders } from './openrouter.js';

// ---------------------------------------------------------------------------
// Sceglie i provider AI in base alla configurazione. In mock mode nessuna
// chiamata di rete. In prod i mock sono già vietati dallo schema env.
// Priorità: mock (dev) → OpenRouter (se ha la chiave) → OpenAI.
// ---------------------------------------------------------------------------

export function createAiProviders(env: ServerEnv): AiProviders {
  if (env.ENABLE_MOCK_AI) {
    return createMockProviders({ latencyMs: 0 });
  }

  // OpenRouter ha priorità se configurato.
  if (env.OPENROUTER_API_KEY) {
    const router = new OpenRouterProviders({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
      appUrl: env.NEXT_PUBLIC_APP_URL,
    });
    return {
      brandProfile: router,
      productCopy: router,
      visual: router,
      factAudit: router,
    };
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error('Nessun provider AI configurato: imposta OPENROUTER_API_KEY o OPENAI_API_KEY');
  }
  const providers = new OpenAiProviders({
    apiKey: env.OPENAI_API_KEY,
    models: {
      brandProfile: env.OPENAI_MODEL_BRAND_PROFILE,
      copy: env.OPENAI_MODEL_COPY,
      visual: env.OPENAI_MODEL_VISUAL,
      audit: env.OPENAI_MODEL_AUDIT,
    },
  });
  return {
    brandProfile: providers,
    productCopy: providers,
    visual: providers,
    factAudit: providers,
  };
}
