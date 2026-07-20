import type {
  BrandProfile,
  BrandProfileInput,
  CopilotInput,
  CopilotOutput,
  FactAuditInput,
  FactAuditResult,
  ProductCopy,
  ProductCopyInput,
  PromptImproveInput,
  PromptImproveOutput,
  PresetPlanInput,
  PresetPlanOutput,
  TranslateCopyInput,
  TranslatedCopy,
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

/**
 * Miglioramento del prompt: a partire dalle correzioni dell'utente sugli
 * output, propone istruzioni di generazione migliori per campo. Non scrive mai
 * nel catalogo: il risultato diventa una bozza di preset che l'utente pubblica.
 */
export interface PromptImproveProvider {
  improvePrompt(input: PromptImproveInput): Promise<AiResult<PromptImproveOutput>>;
}

/**
 * Costruttore di preset: pianifica un intero preset (categorie + attributi +
 * tipi) da una richiesta in linguaggio naturale, in una sola chiamata. Non
 * scrive nel catalogo: la creazione avviene poi in modo deterministico.
 */
export interface PresetPlanProvider {
  planPreset(input: PresetPlanInput): Promise<AiResult<PresetPlanOutput>>;
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

/**
 * Traduzione dell'output generato: fedele, senza aggiungere claim. La fonte
 * resta il testo italiano già passato dall'audit.
 */
export interface TranslationCopyProvider {
  translateCopy(input: TranslateCopyInput): Promise<AiResult<TranslatedCopy>>;
}

/** Aggregato di tutti i provider AI. */
export interface AiProviders {
  brandProfile: BrandProfileProvider;
  productCopy: ProductCopyProvider;
  visual: VisualExtractionProvider;
  factAudit: FactAuditProvider;
  copilot: CopilotProvider;
  promptImprove: PromptImproveProvider;
  presetPlan: PresetPlanProvider;
  translator: TranslationCopyProvider;
  transcription: TranscriptionProvider;
}
