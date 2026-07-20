import OpenAI from 'openai';
import {
  buildBrandProfileSystemPrompt,
  buildBrandProfileUserPrompt,
  buildCopySystemPrompt,
  buildCopyUserPrompt,
  buildAuditUserPrompt,
  buildVisualUserPrompt,
  buildCopilotSystemPrompt,
  buildCopilotUserPrompt,
  buildPromptImproveSystemPrompt,
  buildPromptImproveUserPrompt,
  buildPresetPlanSystemPrompt,
  buildPresetPlanUserPrompt,
  TRANSLATION_SYSTEM_PROMPT,
  buildTranslationUserPrompt,
  brandProfileSchema,
  productCopySchema,
  factAuditSchema,
  visualExtractionSchema,
  copilotOutputSchema,
  promptImproveOutputSchema,
  presetPlanOutputSchema,
  translatedCopySchema,
  BRAND_PROFILE_JSON_SCHEMA,
  PRODUCT_COPY_JSON_SCHEMA,
  FACT_AUDIT_JSON_SCHEMA,
  VISUAL_EXTRACTION_JSON_SCHEMA,
  COPILOT_JSON_SCHEMA,
  PROMPT_IMPROVE_JSON_SCHEMA,
  PRESET_PLAN_JSON_SCHEMA,
  TRANSLATED_COPY_JSON_SCHEMA,
  type BrandProfile,
  type BrandProfileInput,
  type CopilotInput,
  type CopilotOutput,
  type FactAuditInput,
  type FactAuditResult,
  type ProductCopy,
  type ProductCopyInput,
  type PromptImproveInput,
  type PromptImproveOutput,
  type PresetPlanInput,
  type PresetPlanOutput,
  type TranslateCopyInput,
  type TranslatedCopy,
  type VisualExtraction,
  type VisualExtractionInput,
} from '@app/core';
import type { z } from 'zod';
import type {
  AiResult,
  BrandProfileProvider,
  CopilotProvider,
  FactAuditProvider,
  ProductCopyProvider,
  PromptImproveProvider,
  PresetPlanProvider,
  UsageInfo,
  VisualExtractionProvider,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// Provider OpenAI basato sulla Responses API con Structured Outputs (strict) e
// store:false. I nomi dei modelli arrivano dalla config, mai hardcoded.
// ---------------------------------------------------------------------------

export interface OpenAiConfig {
  apiKey: string;
  models: {
    brandProfile: string;
    copy: string;
    visual: string;
    audit: string;
    copilot: string;
  };
  timeoutMs?: number;
}

function makeUsage(model: string, usage: OpenAI.Responses.ResponseUsage | undefined): UsageInfo {
  return {
    model,
    provider: 'openai',
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

export class OpenAiProviders
  implements
    BrandProfileProvider,
    ProductCopyProvider,
    VisualExtractionProvider,
    FactAuditProvider,
    CopilotProvider,
    PromptImproveProvider,
    PresetPlanProvider
{
  private client: OpenAI;

  constructor(private config: OpenAiConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs ?? 60000 });
  }

  private async structured<T>(
    model: string,
    system: string,
    user: string,
    schemaName: string,
    jsonSchema: unknown,
    zodSchema: z.ZodType<T>,
  ): Promise<AiResult<T>> {
    return this.structuredInput(
      model,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ] as unknown as OpenAI.Responses.ResponseInput,
      schemaName,
      jsonSchema,
      zodSchema,
    );
  }

  private async structuredInput<T>(
    model: string,
    input: OpenAI.Responses.ResponseInput,
    schemaName: string,
    jsonSchema: unknown,
    zodSchema: z.ZodType<T>,
  ): Promise<AiResult<T>> {
    const response = await this.client.responses.create({
      model,
      store: false,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema: jsonSchema as Record<string, unknown>,
        },
      },
    });

    const raw = response.output_text;
    if (!raw) throw new Error('AI_INVALID_OUTPUT: risposta vuota');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('AI_INVALID_OUTPUT: JSON non valido');
    }
    const result = zodSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`AI_INVALID_OUTPUT: ${result.error.message}`);
    }
    return { data: result.data, usage: makeUsage(model, response.usage) };
  }

  async generateProfile(input: BrandProfileInput): Promise<AiResult<BrandProfile>> {
    return this.structured(
      this.config.models.brandProfile,
      buildBrandProfileSystemPrompt(),
      buildBrandProfileUserPrompt(input),
      'brand_profile',
      BRAND_PROFILE_JSON_SCHEMA,
      brandProfileSchema,
    );
  }

  async generateCopy(input: ProductCopyInput): Promise<AiResult<ProductCopy>> {
    return this.structured(
      this.config.models.copy,
      buildCopySystemPrompt(input.brandProfile),
      buildCopyUserPrompt(input),
      'product_copy',
      PRODUCT_COPY_JSON_SCHEMA,
      productCopySchema,
    );
  }

  async auditCopy(input: FactAuditInput): Promise<AiResult<FactAuditResult>> {
    return this.structured(
      this.config.models.audit,
      'Sei un revisore di conformità dei fatti per schede prodotto moda. Rispondi in italiano.',
      buildAuditUserPrompt(input.facts, input.content),
      'fact_audit',
      FACT_AUDIT_JSON_SCHEMA,
      factAuditSchema,
    ) as Promise<AiResult<FactAuditResult>>;
  }

  async extractVisualAttributes(
    input: VisualExtractionInput,
  ): Promise<AiResult<VisualExtraction>> {
    // Nessuna immagine: nessuna chiamata di rete.
    if (input.images.length === 0) {
      return {
        data: { attributes: [] },
        usage: makeUsage(this.config.models.visual, undefined),
      };
    }
    // Responses API: content con input_text + input_image (image_url stringa,
    // data URL o https). Cast documentato al tipo di input della Responses API.
    const userContent = [
      { type: 'input_text', text: buildVisualUserPrompt(input.allowedFields, input.sectorName, input.fieldSpecs) },
      ...input.images.map((img) => ({ type: 'input_image', image_url: img.dataUrl, detail: 'auto' })),
    ];
    const requestInput = [
      {
        role: 'system',
        content:
          'Leggi le etichette dei prodotti (OCR + comprensione) ed estrai i dati richiesti. Non inventare: solo ciò che è leggibile sul pack. Classifica ogni valore (dato di fatto / brand / marketing). Rispondi in italiano.',
      },
      { role: 'user', content: userContent },
    ] as unknown as OpenAI.Responses.ResponseInput;

    return this.structuredInput(
      this.config.models.visual,
      requestInput,
      'visual_extraction',
      VISUAL_EXTRACTION_JSON_SCHEMA,
      visualExtractionSchema,
    );
  }

  async suggestConfiguration(input: CopilotInput): Promise<AiResult<CopilotOutput>> {
    return this.structured(
      this.config.models.copilot,
      buildCopilotSystemPrompt(input.entityType),
      buildCopilotUserPrompt(input),
      'copilot_configuration',
      COPILOT_JSON_SCHEMA,
      copilotOutputSchema,
    ) as Promise<AiResult<CopilotOutput>>;
  }

  async improvePrompt(input: PromptImproveInput): Promise<AiResult<PromptImproveOutput>> {
    // Riusa il modello del copilot: task testuale strutturato dello stesso tipo.
    return this.structured(
      this.config.models.copilot,
      buildPromptImproveSystemPrompt(),
      buildPromptImproveUserPrompt(input),
      'prompt_improvement',
      PROMPT_IMPROVE_JSON_SCHEMA,
      promptImproveOutputSchema,
    ) as Promise<AiResult<PromptImproveOutput>>;
  }

  async translateCopy(input: TranslateCopyInput): Promise<AiResult<TranslatedCopy>> {
    return this.structured(
      this.config.models.copy,
      TRANSLATION_SYSTEM_PROMPT,
      buildTranslationUserPrompt(input),
      'copy_translation',
      TRANSLATED_COPY_JSON_SCHEMA,
      translatedCopySchema,
    ) as Promise<AiResult<TranslatedCopy>>;
  }

  async planPreset(input: PresetPlanInput): Promise<AiResult<PresetPlanOutput>> {
    return this.structured(
      this.config.models.copilot,
      buildPresetPlanSystemPrompt(),
      buildPresetPlanUserPrompt(input),
      'preset_plan',
      PRESET_PLAN_JSON_SCHEMA,
      presetPlanOutputSchema,
    ) as Promise<AiResult<PresetPlanOutput>>;
  }
}
