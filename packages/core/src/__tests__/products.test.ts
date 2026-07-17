import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv } from '../csv.js';
import { matchHeaders } from '../headers.js';
import { buildProducts, groupVariants, type ColumnMapping } from '../products.js';
import { computeQuality } from '../quality.js';

const FIXTURES = resolve(__dirname, '../../../../fixtures');
const load = (n: string) => readFileSync(resolve(FIXTURES, n), 'utf8');

/** Deriva un mapping fieldKey->header dai match ad alta/media confidenza. */
function autoMapping(headers: string[]): ColumnMapping {
  const { matches } = matchHeaders(headers);
  const mapping: ColumnMapping = {};
  for (const m of matches) {
    if (m.fieldKey && !mapping[m.fieldKey]) mapping[m.fieldKey] = m.header;
  }
  return mapping;
}

describe('buildProducts', () => {
  it('costruisce prodotti canonici con fatti provided', () => {
    const parsed = parseCsv(load('fashion-valid.csv'));
    const mapping = autoMapping(parsed.headers);
    const products = buildProducts(parsed.rows, mapping);
    expect(products.length).toBe(parsed.rows.length);
    const first = products[0]!;
    expect(first.facts.length).toBeGreaterThanOrEqual(4);
    expect(first.facts.every((f) => f.status === 'provided')).toBe(true);
  });

  it('preserva lo SKU con zero iniziale nel prodotto', () => {
    const parsed = parseCsv(load('fashion-adversarial.csv'));
    const mapping = autoMapping(parsed.headers);
    const products = buildProducts(parsed.rows, mapping);
    const withZero = products.find((p) => p.sku?.startsWith('0'));
    expect(withZero?.sku).toMatch(/^0\d+/);
  });
});

describe('groupVariants', () => {
  it('raggruppa le varianti sotto il parent', () => {
    const parsed = parseCsv(load('fashion-variants.csv'));
    const mapping = autoMapping(parsed.headers);
    const products = buildProducts(parsed.rows, mapping);
    const groups = groupVariants(products);
    const withVariants = groups.filter((g) => g.variants.length > 0);
    expect(withVariants.length).toBeGreaterThan(0);
  });

  it('tratta righe senza parent come prodotti singoli', () => {
    const parsed = parseCsv(load('fashion-valid.csv'));
    const mapping = autoMapping(parsed.headers);
    const products = buildProducts(parsed.rows, mapping);
    const groups = groupVariants(products);
    expect(groups.every((g) => g.variants.length === 0)).toBe(true);
    expect(groups.length).toBe(products.length);
  });
});

describe('computeQuality', () => {
  it('classifica prodotti buoni con punteggio alto', () => {
    const parsed = parseCsv(load('fashion-valid.csv'));
    const mapping = autoMapping(parsed.headers);
    const products = buildProducts(parsed.rows, mapping);
    const q = computeQuality(products[0]!);
    expect(q.score).toBeGreaterThanOrEqual(60);
    expect(q.eligible).toBe(true);
  });

  it('esclude prodotti con meno di due fatti aggiuntivi', () => {
    const parsed = parseCsv('sku,nome\nABC,Maglietta');
    const mapping = autoMapping(parsed.headers);
    const products = buildProducts(parsed.rows, mapping);
    const q = computeQuality(products[0]!);
    expect(q.eligible).toBe(false);
    expect(q.level).toBe('insufficiente');
  });
});
