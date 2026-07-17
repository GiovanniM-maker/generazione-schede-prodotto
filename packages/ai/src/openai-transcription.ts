import OpenAI, { toFile } from 'openai';
import type {
  AiResult,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
  UsageInfo,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// Trascrizione audio via OpenAI Whisper. La Responses API / chat non gestisce
// l'audio: si usa l'endpoint dedicato client.audio.transcriptions.create.
// Il nome del modello arriva dalla config (default 'whisper-1').
// ---------------------------------------------------------------------------

export interface OpenAiTranscriptionConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

function makeUsage(model: string): UsageInfo {
  // Whisper non ritorna un conteggio token: 0/0 va bene per la contabilità.
  return { model, provider: 'openai', inputTokens: 0, outputTokens: 0 };
}

export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  private client: OpenAI;

  constructor(private config: OpenAiTranscriptionConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs ?? 60000 });
  }

  async transcribe(input: TranscriptionInput): Promise<AiResult<TranscriptionResult>> {
    const file = await toFile(input.audio, input.filename, { type: input.mimeType });
    const resp = await this.client.audio.transcriptions.create({
      file,
      model: this.config.model,
      language: input.language ?? 'it',
    });
    return { data: { text: resp.text }, usage: makeUsage(this.config.model) };
  }
}
