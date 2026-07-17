import { describe, it, expect } from 'vitest';
import { computeInputHash, stableStringify } from '../hash.js';
import { neutralizeCell, isDangerousCell } from '../csvInjection.js';
import { computeBalance, canReserve, simulateBatch, validateSign } from '../credits.js';
import { canTransitionBatch, canTransitionJob, deriveBatchOutcome } from '../stateMachine.js';
import { isRetryable, shouldRetry, backoffMs, classifyError } from '../retry.js';
import { buildExportRow } from '../export.js';
import { productCopySchema } from '../schemas.js';
import type { FactAttribute, ProductCopy } from '../types.js';

const facts: FactAttribute[] = [
  { fieldKey: 'sku', value: 'ABC', status: 'provided', sourceType: 'csv' },
  { fieldKey: 'color', value: 'Blu', status: 'provided', sourceType: 'csv' },
];

describe('hash deterministico', () => {
  const base = {
    facts,
    presetVersion: 'moda-v1',
    brandProfileVersion: 'b1',
    promptVersion: 'copy-v1',
    model: 'gpt-4o-mini',
    requestedOutput: ['title', 'shortDescription'],
  };
  it('è stabile rispetto all\'ordine', () => {
    const h1 = computeInputHash(base);
    const h2 = computeInputHash({ ...base, requestedOutput: ['shortDescription', 'title'] });
    expect(h1).toBe(h2);
  });
  it('cambia se cambia un fatto', () => {
    const h1 = computeInputHash(base);
    const h2 = computeInputHash({
      ...base,
      facts: [...facts, { fieldKey: 'fit', value: 'slim', status: 'provided', sourceType: 'csv' }],
    });
    expect(h1).not.toBe(h2);
  });
  it('stableStringify ordina le chiavi', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('CSV injection', () => {
  it('riconosce celle pericolose', () => {
    expect(isDangerousCell('=SUM(A1)')).toBe(true);
    expect(isDangerousCell('+1')).toBe(true);
    expect(isDangerousCell('-1')).toBe(true);
    expect(isDangerousCell('@x')).toBe(true);
    expect(isDangerousCell('Blu')).toBe(false);
  });
  it('neutralizza prefissando un apostrofo', () => {
    expect(neutralizeCell('=1+1')).toBe("'=1+1");
    expect(neutralizeCell('Blu')).toBe('Blu');
  });
});

describe('credit ledger', () => {
  it('calcola il saldo come somma firmata', () => {
    expect(computeBalance([{ amount: 3, entryType: 'welcome' }, { amount: -1, entryType: 'reservation' }])).toBe(2);
  });
  it('valida le convenzioni di segno', () => {
    expect(validateSign({ amount: 5, entryType: 'purchase' })).toBe(true);
    expect(validateSign({ amount: 5, entryType: 'reservation' })).toBe(false);
  });
  it('non riserva oltre il saldo', () => {
    expect(canReserve([{ amount: 2, entryType: 'welcome' }], 3)).toBe(false);
    expect(canReserve([{ amount: 3, entryType: 'welcome' }], 3)).toBe(true);
  });
  it('mantiene il saldo corretto dopo consumi e fallimenti (mai negativo)', () => {
    const initial = [{ amount: 3, entryType: 'welcome' as const }];
    const { finalBalance } = simulateBatch(initial, 3, ['consume', 'consume', 'fail']);
    // 2 consumati (netto -2 dalla riserva), 1 fallito rimborsato -> saldo 1
    expect(finalBalance).toBe(1);
    expect(finalBalance).toBeGreaterThanOrEqual(0);
  });
});

describe('state machine', () => {
  it('consente transizioni valide del batch', () => {
    expect(canTransitionBatch('approved', 'queued')).toBe(true);
    expect(canTransitionBatch('completed', 'queued')).toBe(false);
  });
  it('consente retry dei job falliti', () => {
    expect(canTransitionJob('failed', 'queued')).toBe(true);
    expect(canTransitionJob('completed', 'processing')).toBe(false);
  });
  it('deriva l\'esito del batch dai contatori', () => {
    expect(deriveBatchOutcome(10, 10, 0)).toBe('completed');
    expect(deriveBatchOutcome(10, 7, 3)).toBe('partial_failed');
    expect(deriveBatchOutcome(10, 0, 10)).toBe('failed');
    expect(deriveBatchOutcome(10, 5, 0)).toBe('processing');
  });
});

describe('retry', () => {
  it('ritenta solo errori recuperabili', () => {
    expect(isRetryable('AI_RATE_LIMIT')).toBe(true);
    expect(isRetryable('INVALID_PRODUCT_DATA')).toBe(false);
  });
  it('rispetta il numero massimo di tentativi', () => {
    expect(shouldRetry('AI_TIMEOUT', 1, 3)).toBe(true);
    expect(shouldRetry('AI_TIMEOUT', 3, 3)).toBe(false);
    expect(shouldRetry('INVALID_PRODUCT_DATA', 0, 3)).toBe(false);
  });
  it('applica backoff esponenziale', () => {
    expect(backoffMs(1, 2000)).toBe(2000);
    expect(backoffMs(2, 2000)).toBe(4000);
    expect(backoffMs(3, 2000)).toBe(8000);
  });
  it('classifica gli errori', () => {
    expect(classifyError(new Error('Rate limit exceeded'))).toBe('AI_RATE_LIMIT');
    expect(classifyError(new Error('request timed out'))).toBe('AI_TIMEOUT');
    expect(classifyError(new Error('boh'))).toBe('UNKNOWN_ERROR');
  });
});

describe('export', () => {
  const generated: ProductCopy = {
    title: 'Giacca blu',
    shortDescription: 'Breve',
    longDescription: 'Lunga',
    bullets: ['a', 'b'],
    metaDescription: 'Meta',
    usedFactKeys: ['color'],
    warnings: [],
  };
  it('preferisce il testo editato al generato', () => {
    const row = buildExportRow({
      externalId: 'E1',
      sku: 'ABC',
      productName: 'Giacca',
      canonicalAttributes: { color: 'Blu' },
      generated,
      edited: { title: 'Titolo modificato' },
      verificationStatus: 'accepted',
    });
    expect(row['generated_title']).toBe('Titolo modificato');
    expect(row['short_description']).toBe('Breve');
  });
  it('neutralizza le celle pericolose in export', () => {
    const row = buildExportRow({
      externalId: '=CMD()',
      sku: 'ABC',
      productName: 'X',
      canonicalAttributes: {},
      generated,
      verificationStatus: 'accepted',
    });
    expect(row['external_id']!.startsWith("'")).toBe(true);
  });
});

describe('structured output schema', () => {
  it('valida un output copy corretto', () => {
    const parsed = productCopySchema.safeParse({
      title: 'x',
      shortDescription: 'y',
      longDescription: 'z',
      bullets: ['a'],
      metaDescription: 'm',
      usedFactKeys: [],
      warnings: [],
    });
    expect(parsed.success).toBe(true);
  });
  it('rifiuta un titolo troppo lungo', () => {
    const parsed = productCopySchema.safeParse({
      title: 'x'.repeat(200),
      shortDescription: 'y',
      longDescription: 'z',
      bullets: [],
      metaDescription: 'm',
      usedFactKeys: [],
      warnings: [],
    });
    expect(parsed.success).toBe(false);
  });
});
