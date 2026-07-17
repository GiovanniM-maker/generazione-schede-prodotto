import { describe, it, expect } from 'vitest';
import { computeInputHash } from '../hash.js';
import { buildCopyUserPrompt } from '../prompt.js';
import { deterministicAudit } from '../factAudit.js';
import { sectorSensitiveClaims, sectorSafetyRules } from '@app/config';
import type { BrandProfile, FactAttribute, ProductCopy } from '../types.js';

const facts: FactAttribute[] = [
  { fieldKey: 'nome_commerciale', value: 'Prodotto X', status: 'provided', sourceType: 'csv' },
  { fieldKey: 'forma', value: 'compresse', status: 'provided', sourceType: 'csv' },
];

const profile: BrandProfile = {
  style: 'neutro',
  formality: 'media',
  sentenceLength: 'media',
  person: 'impersonale',
  preferredWords: [],
  forbiddenWords: [],
  structure: {
    shortDescriptionSentences: 2,
    longDescriptionMinWords: 80,
    longDescriptionMaxWords: 120,
    bulletCount: 4,
  },
  ctaPolicy: 'none',
  seoPolicy: 'naturale',
};

describe('cache invalidata dai prompt del preset', () => {
  const base = {
    facts,
    presetVersion: 'v1',
    brandProfileVersion: 'b1',
    promptVersion: 'copy-v1',
    model: 'gpt-4o-mini',
    requestedOutput: ['title'],
  };
  it('cambia hash se cambiano le istruzioni del preset', () => {
    const h1 = computeInputHash({ ...base, presetInstructions: ['A: descrivi in modo sobrio'] });
    const h2 = computeInputHash({ ...base, presetInstructions: ['A: descrivi in modo commerciale'] });
    expect(h1).not.toBe(h2);
  });
  it('stesso hash con stesse istruzioni', () => {
    const i = ['A: sobrio'];
    expect(computeInputHash({ ...base, presetInstructions: i })).toBe(
      computeInputHash({ ...base, presetInstructions: [...i] }),
    );
  });
});

describe('prompt guidato dal preset', () => {
  it('include settore, istruzioni del preset e regole di sicurezza', () => {
    const prompt = buildCopyUserPrompt({
      presetVersion: 'v1',
      facts,
      brandProfile: profile,
      language: 'it',
      requestedOutput: ['title'],
      sectorName: 'Pharma',
      presetInstructions: ['Forma: riporta la forma dichiarata'],
      safetyRules: sectorSafetyRules('pharma'),
    });
    expect(prompt).toContain('Settore: Pharma');
    expect(prompt).toContain('riporta la forma dichiarata');
    expect(prompt).toContain('claim sanitario');
  });
});

describe('audit sensibile al settore (Pharma)', () => {
  it('blocca un claim sanitario non supportato', () => {
    const content: ProductCopy = {
      title: 'Prodotto X',
      shortDescription: 'Integratore che guarisce il raffreddore.',
      longDescription: '',
      bullets: [],
      metaDescription: '',
      usedFactKeys: [],
      warnings: [],
    };
    const audit = deterministicAudit(facts, content, sectorSensitiveClaims('pharma'));
    expect(audit.unsupportedClaims).toContain('guarisce');
    expect(audit.severity).toBe('high');
  });
});
