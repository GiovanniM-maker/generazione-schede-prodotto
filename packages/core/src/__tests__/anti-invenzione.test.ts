import { describe, it, expect } from 'vitest';
import { deterministicAudit, collectGeneratedText } from '../factAudit.js';
import type { FactAttribute, ProductCopy } from '../types.js';

// Garanzia centrale del prodotto: "i dati posseggono i fatti, l'AI la prosa".
// Se l'AI afferma qualcosa che i dati NON dicono, la scheda va bloccata.

function copy(over: Partial<ProductCopy> = {}): ProductCopy {
  return {
    title: 'Prodotto',
    shortDescription: '',
    longDescription: '',
    bullets: [],
    metaDescription: '',
    faq: [],
    altText: '',
    warnings: [],
    ...over,
  } as ProductCopy;
}

const fact = (fieldKey: string, value: string): FactAttribute =>
  ({ fieldKey, value, status: 'provided', sourceType: 'csv' }) as FactAttribute;

describe('audit anti-invenzione', () => {
  it('BLOCCA un claim sensibile non supportato dai fatti', () => {
    const r = deterministicAudit(
      [fact('product_name', 'Maglietta')],
      copy({ longDescription: 'Tessuto impermeabile e traspirante.' }),
    );
    expect(r.severity).toBe('high');
    expect(r.passed).toBe(false);
    expect(r.recommendedStatus).toBe('rejected');
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it('ACCETTA lo stesso claim quando è supportato dai fatti', () => {
    const r = deterministicAudit(
      [fact('product_name', 'Giacca'), fact('material', 'tessuto impermeabile')],
      copy({ longDescription: 'Tessuto impermeabile, ideale per la pioggia.' }),
    );
    expect(r.severity).toBe('none');
    expect(r.passed).toBe(true);
  });

  it('controlla ANCHE le FAQ e l alt text (non solo le descrizioni)', () => {
    const conFaq = deterministicAudit(
      [fact('product_name', 'Borsa')],
      copy({ faq: [{ question: 'È impermeabile?', answer: 'Sì, totalmente impermeabile.' }] }),
    );
    expect(conFaq.severity).toBe('high');

    const conAlt = deterministicAudit(
      [fact('product_name', 'Borsa')],
      copy({ altText: 'Borsa impermeabile su sfondo bianco' }),
    );
    expect(conAlt.severity).toBe('high');
  });

  it('un fatto RIFIUTATO non può sostenere un claim', () => {
    const rifiutato: FactAttribute = {
      fieldKey: 'material',
      value: 'impermeabile',
      status: 'rejected',
      sourceType: 'image',
    } as FactAttribute;
    const r = deterministicAudit([rifiutato], copy({ longDescription: 'Materiale impermeabile.' }));
    // Uno stato non usabile NON deve legittimare l'affermazione.
    expect(r.severity).toBe('high');
  });

  it('un testo senza claim sensibili passa', () => {
    const r = deterministicAudit(
      [fact('product_name', 'Tajarin')],
      copy({ longDescription: 'Pasta all uovo dal gusto delicato, ottima con i sughi.' }),
    );
    expect(r.severity).toBe('none');
  });

  it('collectGeneratedText copre tutti i campi generati', () => {
    const t = collectGeneratedText(
      copy({
        title: 'T',
        shortDescription: 'S',
        longDescription: 'L',
        bullets: ['B1', 'B2'],
        metaDescription: 'M',
        faq: [{ question: 'Q', answer: 'A' }],
        altText: 'ALT',
      }),
    );
    for (const piece of ['T', 'S', 'L', 'B1', 'B2', 'M', 'Q', 'A', 'ALT']) {
      expect(t).toContain(piece);
    }
  });
});
