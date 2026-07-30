import { describe, expect, it } from 'vitest';
import { chunk } from '../chunk.js';

describe('chunk', () => {
  it('non produce blocchi su un elenco vuoto', () => {
    expect(chunk([], 100)).toEqual([]);
  });

  it('tiene tutto in un blocco quando ci sta', () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it("divide in blocchi pieni e un resto", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('divide esattamente quando la lunghezza è un multiplo', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('non perde né duplica elementi', () => {
    const items = Array.from({ length: 1007 }, (_, i) => i);
    const blocks = chunk(items, 100);
    expect(blocks.length).toBe(11);
    expect(blocks.at(-1)).toHaveLength(7);
    expect(blocks.flat()).toEqual(items);
  });

  it('rifiuta una dimensione non valida invece di ciclare a vuoto', () => {
    expect(() => chunk([1, 2], 0)).toThrow();
    expect(() => chunk([1, 2], -3)).toThrow();
  });
});
