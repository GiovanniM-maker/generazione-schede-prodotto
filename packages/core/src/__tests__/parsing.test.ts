import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv, detectDelimiter } from '../csv.js';
import { matchHeaders, matchHeader } from '../headers.js';

const FIXTURES = resolve(__dirname, '../../../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

describe('detectDelimiter', () => {
  it('rileva la virgola', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
  it('rileva il punto e virgola', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });
});

describe('parseCsv', () => {
  it('parsa un CSV valido con header e righe', () => {
    const res = parseCsv(loadFixture('fashion-valid.csv'));
    expect(res.headers.length).toBeGreaterThan(3);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.summary.duplicateHeaders).toEqual([]);
  });

  it('ignora le righe vuote (blank e con soli delimitatori)', () => {
    // Le righe blank sono scartate dal parser; le righe con soli delimitatori
    // (",") sono scartate e conteggiate dalla nostra logica.
    const res = parseCsv('a,b\n1,2\n\n,\n3,4\n');
    expect(res.rows.length).toBe(2);
    expect(res.summary.emptyRowsSkipped).toBeGreaterThanOrEqual(1);
  });

  it('segnala header duplicati rendendoli univoci', () => {
    const res = parseCsv('sku,sku,nome\n1,2,x');
    expect(res.summary.duplicateHeaders).toContain('sku');
    expect(res.headers).toContain('sku_2');
  });

  it('preserva gli zeri iniziali degli SKU (nessuna coercizione numerica)', () => {
    const res = parseCsv('sku,nome\n007123,Maglia');
    expect(res.rows[0]!['sku']).toBe('007123');
  });

  it('gestisce il BOM UTF-8', () => {
    const res = parseCsv('﻿sku,nome\n1,Maglia');
    expect(res.headers[0]).toBe('sku');
  });
});

describe('matchHeaders — sinonimi IT/EN', () => {
  it('mappa header italiani', () => {
    const res = parseCsv(loadFixture('fashion-italian-headers.csv'));
    const { matches } = matchHeaders(res.headers);
    const byField = Object.fromEntries(matches.filter((m) => m.fieldKey).map((m) => [m.fieldKey, m]));
    expect(byField['sku']).toBeDefined();
    expect(byField['product_name']).toBeDefined();
    expect(byField['composition']).toBeDefined();
    expect(byField['fit']).toBeDefined();
  });

  it('mappa header inglesi', () => {
    const res = parseCsv(loadFixture('fashion-english-headers.csv'));
    const { matches } = matchHeaders(res.headers);
    const fields = matches.filter((m) => m.fieldKey).map((m) => m.fieldKey);
    expect(fields).toContain('sku');
    expect(fields).toContain('product_name');
    expect(fields).toContain('composition');
  });

  it('assegna alta confidenza al match esatto', () => {
    expect(matchHeader('composizione tessuto').fieldKey).toBe('composition');
    expect(matchHeader('composizione tessuto').confidence).toBe('high');
  });

  it('non mappa intestazioni sconosciute', () => {
    expect(matchHeader('xyz_campo_ignoto').fieldKey).toBeNull();
  });
});
