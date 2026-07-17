import OpenAI from 'openai';
import {
  buildBrandProfileSystemPrompt,
  buildBrandProfileUserPrompt,
  buildCopySystemPrompt,
  buildCopyUserPrompt,
  buildAuditUserPrompt,
  buildCopilotSystemPrompt,
  buildCopilotUserPrompt,
  brandProfileSchema,
  productCopySchema,
  factAuditSchema,
  visualExtractionSchema,
  copilotOutputSchema,
  BRAND_PROFILE_JSON_SCHEMA,
  PRODUCT_COPY_JSON_SCHEMA,
  FACT_AUDIT_JSON_SCHEMA,
  VISUAL_EXTRACTION_JSON_SCHEMA,
  COPILOT_JSON_SCHEMA,
  type BrandProfile,
  type BrandProfileInput,
  type CopilotInput,
  type CopilotOutput,
  type FactAuditInput,
  type FactAuditResult,
  type ProductCopy,
  type ProductCopyInput,
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
  UsageInfo,
  VisualExtractionProvider,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// Provider OpenRouter: gateway OpenAI-compatibile che espone /chat/completions
// (NON la Responses API). Usa Structured Outputs via response_format json_schema
// strict. Il modello arriva dalla config, mai hardcoded nella business logic.
// ---------------------------------------------------------------------------

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  appUrl?: string;
}

export class OpenRouterProviders
  implements
    BrandProfileProvider,
    ProductCopyProvider,
    VisualExtractionProvider,
    FactAuditProvider,
    CopilotProvider
{
  private client: OpenAI;
  private model: string;

  constructor(config: OpenRouterConfig) {
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

  private async structured<T>(
    system: string,
    user: string,
    schemaName: string,
    jsonSchema: unknown,
    zodSchema: z.ZodType<T>,
  ): Promise<AiResult<T>> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: jsonSchema as Record<string, unknown>,
        },
      },
    });

    const raw = response.choices[0]?.message?.content;
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
    return { data: result.data, usage: this.usage(response.usage) };
  }

  async generateProfile(input: BrandProfileInput): Promise<AiResult<BrandProfile>> {
    return this.structured(
      buildBrandProfileSystemPrompt(),
      buildBrandProfileUserPrompt(input),
      'brand_profile',
      BRAND_PROFILE_JSON_SCHEMA,
      brandProfileSchema,
    );
  }

  async generateCopy(input: ProductCopyInput): Promise<AiResult<ProductCopy>> {
    return this.structured(
      buildCopySystemPrompt(input.brandProfile),
      buildCopyUserPrompt(input),
      'product_copy',
      PRODUCT_COPY_JSON_SCHEMA,
      productCopySchema,
    );
  }

  async auditCopy(input: FactAuditInput): Promise<AiResult<FactAuditResult>> {
    return this.structured(
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
    const user = `Attributi consentiti: ${input.allowedFields.join(', ')}. Immagini: ${input.imageRefs.join(', ')}. Suggerisci SOLO attributi visuali evidenti, ognuno con confidence 0-1. Nessuna deduzione di materiale, composizione, misure, origine, sostenibilità.`;
    return this.structured(
      'Analizzi immagini di capi moda e suggerisci attributi visuali evidenti (da confermare). Rispondi in italiano.',
      user,
      'visual_extraction',
      VISUAL_EXTRACTION_JSON_SCHEMA,
      visualExtractionSchema,
    );
  }

  async suggestConfiguration(input: CopilotInput): Promise<AiResult<CopilotOutput>> {
    return this.structured(
      buildCopilotSystemPrompt(input.entityType),
      buildCopilotUserPrompt(input),
      'copilot_configuration',
      COPILOT_JSON_SCHEMA,
      copilotOutputSchema,
    ) as Promise<AiResult<CopilotOutput>>;
  }
}
