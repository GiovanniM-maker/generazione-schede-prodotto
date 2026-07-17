import type {
  AiResult,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// Provider di trascrizione "assente": usato quando nessuna chiave audio è
// configurata. Lancia un errore chiaro in italiano invece di fallire in modo
// oscuro. La trascrizione reale richiede OpenRouter (input_audio) o OpenAI.
// ---------------------------------------------------------------------------

export const TRANSCRIPTION_UNAVAILABLE_MESSAGE =
  "Trascrizione non disponibile: imposta OPENROUTER_API_KEY o OPENAI_API_KEY";

export class MissingTranscriptionProvider implements TranscriptionProvider {
  async transcribe(_input: TranscriptionInput): Promise<AiResult<TranscriptionResult>> {
    throw new Error(TRANSCRIPTION_UNAVAILABLE_MESSAGE);
  }
}
