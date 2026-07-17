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
    CopilotProvider
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
    const response = await this.client.responses.create({
      model,
      store: false,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
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
    const user = `Attributi consentiti: ${input.allowedFields.join(', ')}. Immagini: ${input.imageRefs.join(', ')}. Suggerisci SOLO attributi visuali evidenti, ognuno con confidence 0-1. Nessuna deduzione di materiale, composizione, misure, origine, sostenibilità.`;
    return this.structured(
      this.config.models.visual,
      'Analizzi immagini di capi moda e suggerisci attributi visuali evidenti (da confermare). Rispondi in italiano.',
      user,
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
}
