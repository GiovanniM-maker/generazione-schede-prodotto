import OpenAI from 'openai';
import type {
  AiResult,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
  UsageInfo,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// Trascrizione audio via OpenRouter. OpenRouter NON espone un endpoint Whisper,
// ma accetta l'audio come content `input_audio` (base64 + format) nelle chat
// completions verso modelli audio-capable (es. Gemini). Il modello arriva
// dalla config, mai hardcoded nella business logic.
// ---------------------------------------------------------------------------

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const TRANSCRIBE_INSTRUCTION =
  'Trascrivi fedelmente in italiano questo audio, senza aggiungere nulla, solo il testo parlato.';

/** Formati audio accettati da OpenRouter per il content input_audio. */
export type OpenRouterAudioFormat = 'wav' | 'mp3' | 'ogg' | 'm4a' | 'flac' | 'aac';

/**
 * Mappa il mimeType del blob al `format` atteso da OpenRouter. webm NON è
 * supportato: in quel caso si tenta comunque 'ogg' (contenitore affine) come
 * best effort, ma il recorder è configurato per preferire formati supportati.
 */
export function mimeTypeToOpenRouterFormat(mimeType: string): OpenRouterAudioFormat {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/aac':
      return base === 'audio/aac' ? 'aac' : 'm4a';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/ogg':
    case 'audio/webm':
      return 'ogg';
    case 'audio/flac':
      return 'flac';
    default:
      return 'ogg';
  }
}

export interface OpenRouterTranscriptionConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  appUrl?: string;
}

export class OpenRouterTranscriptionProvider implements TranscriptionProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: OpenRouterTranscriptionConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: OPENROUTER_BASE_URL,
      timeout: config.timeoutMs ?? 60000,
      defaultHeaders: {
        'HTTP-Referer': config.appUrl ?? 'https://localhost',
        'X-Title': 'Generatore Schede Prodotto Moda',
      },
    });
  }

  private usage(usage: OpenAI.Completions.CompletionUsage | undefined): UsageInfo {
    return {
      model: this.model,
      provider: 'openrouter',
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
    };
  }

  async transcribe(input: TranscriptionInput): Promise<AiResult<TranscriptionResult>> {
    const format = mimeTypeToOpenRouterFormat(input.mimeType);
    const base64 = input.audio.toString('base64');

    // Il tipo InputAudio dell'SDK OpenAI ammette solo 'wav' | 'mp3', ma
    // OpenRouter accetta più formati: si costruisce il content con un cast
    // esplicito e documentato al tipo dei messaggi.
    const content = [
      { type: 'text', text: TRANSCRIBE_INSTRUCTION },
      { type: 'input_audio', input_audio: { data: base64, format } },
    ] as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content }],
    });

    const text = response.choices[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('Trascrizione non disponibile: risposta vuota dal modello.');
    }
    return { data: { text: text.trim() }, usage: this.usage(response.usage) };
  }
}
