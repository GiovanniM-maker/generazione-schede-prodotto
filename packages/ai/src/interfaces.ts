import type {
  BrandProfile,
  BrandProfileInput,
  CopilotInput,
  CopilotOutput,
  FactAuditInput,
  FactAuditResult,
  ProductCopy,
  ProductCopyInput,
  VisualExtraction,
  VisualExtractionInput,
} from '@app/core';

// ---------------------------------------------------------------------------
// Interfacce provider AI. La business logic dipende SOLO da queste, mai
// dall'SDK direttamente.
// ---------------------------------------------------------------------------

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
}

export interface AiResult<T> {
  data: T;
  usage: UsageInfo;
}

export interface BrandProfileProvider {
  generateProfile(input: BrandProfileInput): Promise<AiResult<BrandProfile>>;
}

export interface ProductCopyProvider {
  generateCopy(input: ProductCopyInput): Promise<AiResult<ProductCopy>>;
}

export interface VisualExtractionProvider {
  extractVisualAttributes(input: VisualExtractionInput): Promise<AiResult<VisualExtraction>>;
}

export interface FactAuditProvider {
  auditCopy(input: FactAuditInput): Promise<AiResult<FactAuditResult>>;
}

/**
 * Copilot di configurazione: propone una bozza strutturata per attributi e
 * categorie a partire dal messaggio dell'utente. Non scrive mai nel catalogo.
 */
export interface CopilotProvider {
  suggestConfiguration(input: CopilotInput): Promise<AiResult<CopilotOutput>>;
}

// ---------------------------------------------------------------------------
// Trascrizione audio (Fase 6). Nota: OpenRouter NON supporta l'audio (solo
// chat-completions), quindi la trascrizione reale usa OpenAI Whisper. È
// indipendente dal provider principale (mock / OpenRouter / OpenAI).
// ---------------------------------------------------------------------------

export interface TranscriptionInput {
  audio: Buffer;
  filename: string;
  mimeType: string;
  language?: string;
}

export interface TranscriptionResult {
  text: string;
}

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<AiResult<TranscriptionResult>>;
}

/** Aggregato di tutti i provider AI. */
export interface AiProviders {
  brandProfile: BrandProfileProvider;
  productCopy: ProductCopyProvider;
  visual: VisualExtractionProvider;
  factAudit: FactAuditProvider;
  copilot: CopilotProvider;
  transcription: TranscriptionProvider;
}
