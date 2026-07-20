import type { ServerEnv } from '@app/config';
import type { AiProviders, TranscriptionProvider } from './interfaces.js';
import { createMockProviders, MockTranscriptionProvider } from './mock.js';
import { OpenAiProviders } from './openai.js';
import { OpenAiTranscriptionProvider } from './openai-transcription.js';
import { OpenRouterProviders } from './openrouter.js';
import { OpenRouterTranscriptionProvider } from './openrouter-transcription.js';
import { MissingTranscriptionProvider } from './missing-transcription.js';

// ---------------------------------------------------------------------------
// Sceglie i provider AI in base alla configurazione. In mock mode nessuna
// chiamata di rete. In prod i mock sono già vietati dallo schema env.
// Priorità (provider principale): mock (dev) → OpenRouter (se ha la chiave) → OpenAI.
//
// La TRASCRIZIONE è indipendente dal provider principale e va calcolata a parte
// (viene inclusa in TUTTI i bundle): mock → OpenRouter (input_audio) → OpenAI
// Whisper → provider che lancia un errore chiaro.
// ---------------------------------------------------------------------------

/**
 * Seleziona il provider di trascrizione. Indipendente dalla scelta del provider
 * principale: OpenRouter gestisce l'audio via chat completions (input_audio),
 * OpenAI via Whisper; in assenza di chiavi si lancia un errore chiaro.
 */
function selectTranscription(env: ServerEnv): TranscriptionProvider {
  if (env.ENABLE_MOCK_AI) {
    return new MockTranscriptionProvider({ latencyMs: 0 });
  }
  if (env.OPENROUTER_API_KEY) {
    return new OpenRouterTranscriptionProvider({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_TRANSCRIBE_MODEL,
      appUrl: env.NEXT_PUBLIC_APP_URL,
    });
  }
  if (env.OPENAI_API_KEY) {
    return new OpenAiTranscriptionProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL_TRANSCRIBE,
    });
  }
  return new MissingTranscriptionProvider();
}

export function createAiProviders(env: ServerEnv): AiProviders {
  const transcription = selectTranscription(env);

  if (env.ENABLE_MOCK_AI) {
    return { ...createMockProviders({ latencyMs: 0 }), transcription };
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
      copilot: router,
      promptImprove: router,
      presetPlan: router,
      translator: router,
      transcription,
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
      copilot: env.OPENAI_MODEL_COPILOT,
    },
  });
  return {
    brandProfile: providers,
    productCopy: providers,
    visual: providers,
    factAudit: providers,
    copilot: providers,
    promptImprove: providers,
    presetPlan: providers,
    translator: providers,
    transcription,
  };
}
