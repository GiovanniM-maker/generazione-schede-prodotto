import type { ServerEnv } from '@app/config';
import type { AiProviders } from './interfaces.js';
import { createMockProviders } from './mock.js';
import { OpenAiProviders } from './openai.js';

// ---------------------------------------------------------------------------
// Sceglie i provider AI in base alla configurazione. In mock mode nessuna
// chiamata di rete. In prod i mock sono già vietati dallo schema env.
// ---------------------------------------------------------------------------

export function createAiProviders(env: ServerEnv): AiProviders {
  if (env.ENABLE_MOCK_AI) {
    return createMockProviders({ latencyMs: 0 });
  }
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY mancante e mock AI disattivo');
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
