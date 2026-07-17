import { describe, it, expect } from 'vitest';
import { createMockProviders } from '../mock.js';
import type { BrandProfile, FactAttribute, ProductCopyInput } from '@app/core';

const profile: BrandProfile = {
  style: 'elegante',
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

const facts: FactAttribute[] = [
  { fieldKey: 'product_name', value: 'Giacca', status: 'provided', sourceType: 'csv' },
  { fieldKey: 'color', value: 'blu', status: 'provided', sourceType: 'csv' },
  { fieldKey: 'composition', value: '100% cotone', status: 'provided', sourceType: 'csv' },
];

const input: ProductCopyInput = {
  presetVersion: 'moda-v1',
  facts,
  brandProfile: profile,
  language: 'it',
  requestedOutput: ['title', 'shortDescription', 'longDescription', 'bullets', 'metaDescription'],
};

describe('MockProductCopyProvider', () => {
  it('produce output deterministico basato sui fatti', async () => {
    const { productCopy } = createMockProviders();
    const a = await productCopy.generateCopy(input);
    const b = await productCopy.generateCopy(input);
    expect(a.data).toEqual(b.data);
    expect(a.data.title).toContain('Giacca');
    expect(a.data.usedFactKeys).toContain('color');
    expect(a.data.usedFactKeys).toContain('composition');
  });

  it('avvisa quando manca la composizione e non la inventa', async () => {
    const { productCopy } = createMockProviders();
    const noComposition: ProductCopyInput = {
      ...input,
      facts: facts.filter((f) => f.fieldKey !== 'composition'),
    };
    const res = await productCopy.generateCopy(noComposition);
    expect(res.data.warnings.length).toBeGreaterThan(0);
    expect(res.data.longDescription.toLowerCase()).not.toContain('cotone');
  });

  it('simula un fallimento configurabile', async () => {
    const { productCopy } = createMockProviders({ failCopy: true });
    await expect(productCopy.generateCopy(input)).rejects.toThrow();
  });
});

describe('MockFactAuditProvider', () => {
  it('blocca claim non supportati', async () => {
    const { factAudit } = createMockProviders();
    const res = await factAudit.auditCopy({
      facts,
      content: {
        title: 'Giacca',
        shortDescription: 'Giacca impermeabile',
        longDescription: '',
        bullets: [],
        metaDescription: '',
        usedFactKeys: [],
        warnings: [],
      },
    });
    expect(res.data.unsupportedClaims).toContain('impermeabile');
    expect(res.data.severity).toBe('high');
  });
});
