import { describe, it, expect } from 'vitest';
import { createMockProviders } from '../mock.js';
import { buildTranslationUserPrompt, type TranslatedCopy } from '@app/core';

const content: TranslatedCopy = {
  title: 'Olive Taggiasche in Salamoia ROI - 480g',
  shortDescription: 'Olive liguri in salamoia.',
  longDescription: 'Le olive taggiasche ROI, raccolte in Liguria, 480g in salamoia.',
  bullets: ['480g', 'Liguria', 'In salamoia'],
  metaDescription: 'Olive taggiasche ROI 480g.',
  faq: [{ question: 'Quanto pesa?', answer: '480g.' }],
  altText: 'Vasetto di olive taggiasche ROI',
};

describe('MockTranslationProvider', () => {
  it('è deterministico e preserva la struttura (bullets, FAQ, limiti)', async () => {
    const { translator } = createMockProviders();
    const a = await translator.translateCopy({ content, targetLanguage: 'en' });
    const b = await translator.translateCopy({ content, targetLanguage: 'en' });
    expect(a.data).toEqual(b.data);
    expect(a.data.bullets).toHaveLength(content.bullets.length);
    expect(a.data.faq).toHaveLength(content.faq.length);
    expect(a.data.title.length).toBeLessThanOrEqual(80);
    expect(a.data.metaDescription.length).toBeLessThanOrEqual(155);
    expect(a.data.title).toContain('[EN]');
  });

  it('lingue diverse producono output diversi', async () => {
    const { translator } = createMockProviders();
    const en = await translator.translateCopy({ content, targetLanguage: 'en' });
    const de = await translator.translateCopy({ content, targetLanguage: 'de' });
    expect(en.data.title).not.toEqual(de.data.title);
    expect(de.data.title).toContain('[DE]');
  });
});

describe('buildTranslationUserPrompt', () => {
  it('include il testo, la lingua e i vincoli strutturali', () => {
    const p = buildTranslationUserPrompt({ content, targetLanguage: 'fr', sectorName: 'Food' });
    expect(p).toContain('francese');
    expect(p).toContain('Olive Taggiasche');
    expect(p).toContain('(3)'); // numero bullets
    expect(p).toContain('(1)'); // numero faq
    expect(p).toContain('Food');
  });
});
