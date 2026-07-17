import { describe, it, expect } from 'vitest';
import { normalizeErrorCode } from '@app/pipeline';

// Verifica la normalizzazione dei codici errore usata dal worker.
describe('normalizeErrorCode', () => {
  it('riconosce il prefisso di codice esplicito', () => {
    expect(normalizeErrorCode(new Error('INSUFFICIENT_FACTS: pochi fatti'))).toBe(
      'INSUFFICIENT_FACTS',
    );
    expect(normalizeErrorCode(new Error('DATABASE_ERROR: giù'))).toBe('DATABASE_ERROR');
  });
  it('classifica gli errori generici', () => {
    expect(normalizeErrorCode(new Error('Rate limit hit'))).toBe('AI_RATE_LIMIT');
    expect(normalizeErrorCode(new Error('qualcosa'))).toBe('UNKNOWN_ERROR');
  });
});
