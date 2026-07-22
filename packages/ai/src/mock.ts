import {
  deterministicAudit,
  usableFacts,
  type BrandProfile,
  type BrandProfileInput,
  type CopilotDraftPatch,
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
import type {
  AiResult,
  BrandProfileProvider,
  CopilotProvider,
  FactAuditProvider,
  ProductCopyProvider,
  PromptImproveProvider,
  PresetPlanProvider,
  TranscriptionInput,
  TranscriptionProvider,
  TranslationCopyProvider,
  TranscriptionResult,
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
      faq: [{ question: `Che prodotto è ${name}?`, answer: shortDescription }],
      altText: `${name}${color ? ' ' + color : ''}`.slice(0, 125),
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
    // DETERMINISTICO e offline: rende testabile il flusso di conferma senza rete.
    // Suggerisce solo se ci sono immagini e 'apparent_color' è consentito.
    const attributes: VisualExtraction['attributes'] = [];
    const hasImages = input.images.length > 0;
    const allows = (f: string) => input.allowedFields.includes(f);
    if (hasImages && allows('apparent_color')) {
      attributes.push({ fieldKey: 'apparent_color', value: 'colore da confermare', confidence: 0.4, kind: 'onpack_factual' });
      if (allows('product_type')) {
        attributes.push({ fieldKey: 'product_type', value: 'capo', confidence: 0.4, kind: 'onpack_factual' });
      }
    }
    return {
      data: { attributes },
      usage: usage('mock-visual', 50, 10),
    };
  }
}

// ---------------------------------------------------------------------------
// Copilot mock: DETERMINISTICO e offline. Ricava un draftPatch sensato dal
// messaggio dell'utente (nome dall'ultima frase utile, dataType 'text', una
// istruzione di estrazione generica). Chiede sempre conferma.
// ---------------------------------------------------------------------------

/** Estrae un "nome" plausibile dal messaggio (prima riga, ripulita, max ~60). */
function deriveName(message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  const cleaned = firstLine
    .replace(
      /^(crea|aggiungi|configura|vorrei|voglio|nuovo|nuova|un|una|attributo|categoria|per favore|per)\s+/gi,
      '',
    )
    .trim();
  const base = cleaned || firstLine || 'Nuovo elemento';
  return base.length > 60 ? base.slice(0, 60).trim() : base;
}

export class MockCopilotProvider implements CopilotProvider {
  constructor(private opts: MockOptions = {}) {}
  async suggestConfiguration(input: CopilotInput): Promise<AiResult<CopilotOutput>> {
    await delay(this.opts.latencyMs ?? 0);

    const existingName =
      typeof input.currentDraft.name === 'string' ? input.currentDraft.name : null;
    const name = existingName || deriveName(input.userMessage);
    const isAttribute = input.entityType === 'attribute';

    const draftPatch: CopilotDraftPatch = {
      name,
      description: null,
      recognitionHint: isAttribute ? null : `Si riconosce dalle foto: prodotto tipo "${name}".`,
      attributeKind: isAttribute ? 'factual' : null,
      dataType: isAttribute ? 'text' : null,
      unit: null,
      enumValues: null,
      extractionInstruction: isAttribute
        ? `Estrai il valore di "${name}" dalle fonti fornite: estrai solo il dato dichiarato, non stimare.`
        : null,
      generationInstruction: isAttribute
        ? `Usa "${name}" nel testo solo se presente tra i fatti verificati.`
        : null,
      categoryKeys: null,
      isRequired: isAttribute ? false : null,
    };

    const duplicate = input.existingSimilar.find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    const duplicateNote = duplicate
      ? ` Attenzione: esiste già "${duplicate.name}" con nome simile: valuta se riusarlo.`
      : '';

    const label = isAttribute ? 'attributo' : 'categoria';
    const output: CopilotOutput = {
      assistantMessage: `Ho preparato una bozza per l'${label} "${name}".${duplicateNote} Controlla i campi proposti e conferma per crearlo.`,
      intent: isAttribute ? 'configure_attribute' : 'configure_category',
      missingInformation: [],
      suggestedActions: ['Rivedi la bozza proposta', 'Conferma per pubblicare'],
      draftPatch,
      requiresConfirmation: true,
      confirmationSummary: `Verrà creata la ${label} "${name}" nel settore ${input.sectorName || 'selezionato'}.`,
    };

    return { data: output, usage: usage('mock-copilot', 120, 90) };
  }
}

// ---------------------------------------------------------------------------
// Miglioramento prompt mock: DETERMINISTICO e offline. Raggruppa le correzioni
// per campo e produce un'istruzione migliorata che integra le motivazioni.
// ---------------------------------------------------------------------------

export class MockPromptImproveProvider implements PromptImproveProvider {
  constructor(private opts: MockOptions = {}) {}
  async improvePrompt(input: PromptImproveInput): Promise<AiResult<PromptImproveOutput>> {
    await delay(this.opts.latencyMs ?? 0);

    const byField = new Map<
      string,
      { fieldLabel: string; reasons: string[]; count: number }
    >();
    for (const c of input.corrections) {
      const e = byField.get(c.fieldKey) ?? { fieldLabel: c.fieldLabel, reasons: [], count: 0 };
      if (c.reason.trim()) e.reasons.push(c.reason.trim());
      e.count += 1;
      byField.set(c.fieldKey, e);
    }
    const currentByField = new Map(input.currentInstructions.map((i) => [i.fieldKey, i.instruction]));

    const fields = [...byField.entries()].map(([fieldKey, e]) => {
      const current = currentByField.get(fieldKey) ?? '';
      const reasonPart = e.reasons.length
        ? ` Tieni conto di queste indicazioni ricorrenti dell'utente: ${e.reasons.join('; ')}.`
        : '';
      const base = current || `Scrivi il campo "${e.fieldLabel}" in modo chiaro e fedele ai fatti.`;
      return {
        fieldKey,
        improvedInstruction: `${base}${reasonPart}`.trim(),
        rationale: `${e.count} correzioni sul campo "${e.fieldLabel}": integro le motivazioni ricorrenti.`,
      };
    });

    return {
      data: {
        summary: `Proposte ${fields.length} istruzioni migliorate a partire da ${input.corrections.length} correzioni.`,
        fields,
      },
      usage: usage('mock-prompt-improve', 200, 150),
    };
  }
}

// ---------------------------------------------------------------------------
// Preset builder mock: DETERMINISTICO. Deduce N categorie e M attributi dai
// numeri nella richiesta ("crea un preset con 5 categorie e 3 attributi").
// ---------------------------------------------------------------------------

export class MockPresetPlanProvider implements PresetPlanProvider {
  constructor(private opts: MockOptions = {}) {}
  async planPreset(input: PresetPlanInput): Promise<AiResult<PresetPlanOutput>> {
    await delay(this.opts.latencyMs ?? 0);
    const nums = (input.userRequest.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
    const nCats = Math.min(Math.max(nums[0] ?? 3, 1), 12);
    const nAttrs = Math.min(Math.max(nums[1] ?? 3, 1), 10);
    const categories = Array.from({ length: nCats }, (_, i) => ({
      name: `Categoria ${i + 1}`,
      description: null,
      recognitionHint: `Si riconosce dalle foto della Categoria ${i + 1}.`,
      attributes: Array.from({ length: nAttrs }, (_, j) => ({
        name: `Attributo ${i + 1}.${j + 1}`,
        dataType: 'text',
        enumValues: null,
        unit: null,
        extractionInstruction: `Estrai "Attributo ${i + 1}.${j + 1}" dalle fonti: solo il dato dichiarato.`,
        generationInstruction: 'Usa il valore solo se presente tra i fatti.',
      })),
    }));
    return {
      data: {
        assistantMessage: `Ho preparato ${nCats} categorie con ${nAttrs} attributi ciascuna. Conferma per crearle.`,
        summary: `${nCats} categorie, ${nCats * nAttrs} attributi.`,
        categories,
      },
      usage: usage('mock-preset-plan', 200, 300),
    };
  }
}

// ---------------------------------------------------------------------------
// Trascrizione mock: DETERMINISTICA e offline. Nessuna chiamata di rete.
// Restituisce una frase fissa in italiano che include il nome del file.
// ---------------------------------------------------------------------------

export class MockTranscriptionProvider implements TranscriptionProvider {
  constructor(private opts: MockOptions = {}) {}
  async transcribe(input: TranscriptionInput): Promise<AiResult<TranscriptionResult>> {
    await delay(this.opts.latencyMs ?? 0);
    return {
      data: { text: `Trascrizione simulata (${input.filename}).` },
      usage: usage('mock-transcription', 0, 0),
    };
  }
}

export class MockTranslationProvider implements TranslationCopyProvider {
  constructor(private opts: MockOptions = {}) {}
  async translateCopy(input: TranslateCopyInput): Promise<AiResult<TranslatedCopy>> {
    await delay(this.opts.latencyMs ?? 0);
    // DETERMINISTICO: prefissa con il codice lingua, preserva numeri e struttura
    // (stesso numero di bullets e FAQ) per testare i vincoli senza rete.
    const tag = `[${input.targetLanguage.toUpperCase()}]`;
    const t = (s: string) => (s ? `${tag} ${s}` : '');
    const c = input.content;
    return {
      data: {
        title: t(c.title).slice(0, 80),
        shortDescription: t(c.shortDescription),
        longDescription: t(c.longDescription),
        bullets: c.bullets.map(t),
        metaDescription: t(c.metaDescription).slice(0, 155),
        faq: c.faq.map((f) => ({ question: t(f.question), answer: t(f.answer) })),
        altText: t(c.altText).slice(0, 125),
      },
      usage: usage('mock-translate', 120, 100),
    };
  }
}

export function createMockProviders(opts: MockOptions = {}) {
  return {
    brandProfile: new MockBrandProfileProvider(opts),
    productCopy: new MockProductCopyProvider(opts),
    visual: new MockVisualExtractionProvider(opts),
    factAudit: new MockFactAuditProvider(opts),
    copilot: new MockCopilotProvider(opts),
    promptImprove: new MockPromptImproveProvider(opts),
    presetPlan: new MockPresetPlanProvider(opts),
    translator: new MockTranslationProvider(opts),
    transcription: new MockTranscriptionProvider(opts),
  };
}
