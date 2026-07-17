import {
  deterministicAudit,
  usableFacts,
  type BrandProfile,
  type BrandProfileInput,
  type FactAuditInput,
  type FactAuditResult,
  type ProductCopy,
  type ProductCopyInput,
  type VisualExtraction,
  type VisualExtractionInput,
} from '@app/core';
import type {
  AiResult,
  BrandProfileProvider,
  FactAuditProvider,
  ProductCopyProvider,
  VisualExtractionProvider,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// Provider mock DETERMINISTICO. Nessuna chiamata di rete. Usa i fatti forniti.
// Simula latenza e un fallimento configurabile. Serve a sviluppo e test.
// ---------------------------------------------------------------------------

export interface MockOptions {
  /** Latenza simulata in ms (0 = nessuna). */
  latencyMs?: number;
  /** Se true, generateCopy lancia per simulare un fallimento. */
  failCopy?: boolean;
  /** Messaggio di errore per il fallimento simulato. */
  failMessage?: string;
}

const delay = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function usage(model: string, input: number, output: number) {
  return { inputTokens: input, outputTokens: output, model, provider: 'mock' };
}

export class MockBrandProfileProvider implements BrandProfileProvider {
  constructor(private opts: MockOptions = {}) {}
  async generateProfile(input: BrandProfileInput): Promise<AiResult<BrandProfile>> {
    await delay(this.opts.latencyMs ?? 0);
    const profile: BrandProfile = {
      style: input.selectedStyle || 'elegante e concreto',
      formality: 'media',
      sentenceLength: 'media',
      person: 'impersonale',
      preferredWords: [],
      forbiddenWords: input.forbiddenWords ?? [],
      structure: {
        shortDescriptionSentences: 2,
        longDescriptionMinWords: 80,
        longDescriptionMaxWords: 120,
        bulletCount: 4,
      },
      ctaPolicy: 'none',
      seoPolicy: 'naturale',
      summary: `Profilo mock basato su stile "${input.selectedStyle}".`,
    };
    return { data: profile, usage: usage('mock-brand', 100, 80) };
  }
}

export class MockProductCopyProvider implements ProductCopyProvider {
  constructor(private opts: MockOptions = {}) {}
  async generateCopy(input: ProductCopyInput): Promise<AiResult<ProductCopy>> {
    await delay(this.opts.latencyMs ?? 0);
    if (this.opts.failCopy) {
      throw new Error(this.opts.failMessage ?? 'Mock AI failure');
    }
    const facts = usableFacts(input.facts);
    const factMap = new Map(facts.map((f) => [f.fieldKey, f.value]));
    const name = factMap.get('product_name') ?? factMap.get('product_type') ?? 'Prodotto';
    const color = factMap.get('color');
    const composition = factMap.get('composition') ?? factMap.get('material');
    const fit = factMap.get('fit');

    const titleParts = [name, color].filter(Boolean);
    const title = titleParts.join(' ').slice(0, 80);

    const usedKeys: string[] = [];
    const details: string[] = [];
    if (color) {
      details.push(`nella tonalità ${color}`);
      usedKeys.push('color');
    }
    if (composition) {
      details.push(`realizzato in ${composition}`);
      usedKeys.push(factMap.has('composition') ? 'composition' : 'material');
    }
    if (fit) {
      details.push(`dalla vestibilità ${fit}`);
      usedKeys.push('fit');
    }

    const shortDescription = `${name}${details.length ? ' ' + details[0] : ''}.`;
    const longDescription = [
      `${name} è pensato per chi cerca capi curati.`,
      details.length ? `Un capo ${details.join(', ')}.` : '',
      'La linea pulita valorizza la silhouette senza eccessi.',
      'Un elemento versatile da inserire nel guardaroba di ogni giorno.',
    ]
      .filter(Boolean)
      .join(' ');

    const bullets = [
      color ? `Colore: ${color}` : 'Design essenziale',
      composition ? `Composizione: ${composition}` : 'Materiali selezionati',
      fit ? `Vestibilità: ${fit}` : 'Comfort quotidiano',
      'Cura del dettaglio',
    ].slice(0, 4);

    const warnings: string[] = [];
    if (!composition) warnings.push('Composizione non fornita: non citata nel testo.');

    const copy: ProductCopy = {
      title: title || name.slice(0, 80),
      shortDescription,
      longDescription,
      bullets,
      metaDescription: `${name}${color ? ' ' + color : ''} — scopri i dettagli.`.slice(0, 155),
      usedFactKeys: [...new Set(usedKeys)],
      warnings,
    };
    return { data: copy, usage: usage('mock-copy', 200, 150) };
  }
}

export class MockFactAuditProvider implements FactAuditProvider {
  constructor(private opts: MockOptions = {}) {}
  async auditCopy(input: FactAuditInput): Promise<AiResult<FactAuditResult>> {
    await delay(this.opts.latencyMs ?? 0);
    // Il mock riusa l'audit deterministico reale (nessuna invenzione).
    const result = deterministicAudit(input.facts, input.content);
    return { data: result, usage: usage('mock-audit', 120, 40) };
  }
}

export class MockVisualExtractionProvider implements VisualExtractionProvider {
  constructor(private opts: MockOptions = {}) {}
  async extractVisualAttributes(
    input: VisualExtractionInput,
  ): Promise<AiResult<VisualExtraction>> {
    await delay(this.opts.latencyMs ?? 0);
    // Mock: nessun attributo inferito (sicuro per default).
    return {
      data: { attributes: [] },
      usage: usage('mock-visual', 50, 10),
    };
  }
}

export function createMockProviders(opts: MockOptions = {}) {
  return {
    brandProfile: new MockBrandProfileProvider(opts),
    productCopy: new MockProductCopyProvider(opts),
    visual: new MockVisualExtractionProvider(opts),
    factAudit: new MockFactAuditProvider(opts),
  };
}
