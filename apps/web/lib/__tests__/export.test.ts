import { beforeEach, describe, expect, it } from 'vitest';
import { FakeDb, type Row } from './fake-supabase.js';
import { buildBatchExport } from '../exporter.js';

// ---------------------------------------------------------------------------
// Export del batch.
//
// Due bug veri sono nati qui:
//   - colonne moda (colore, taglia, composizione) presenti e VUOTE in un export
//     Food, perche' l'elenco delle colonne era fisso invece che derivato dai dati;
//   - una query per prodotto: su cataloghi grandi, centinaia di round-trip e
//     export troncato dal tempo massimo.
//
// In piu' l'export e' l'unico punto in cui i dati escono dal prodotto e finiscono
// in un file che qualcuno aprira' con Excel: la protezione dalle formule non e'
// un dettaglio.
// ---------------------------------------------------------------------------

let db: FakeDb;

const BATCH = 'b1';

function csvDi(buffer: Buffer): { intestazioni: string[]; righe: string[][] } {
  const testo = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const linee = testo.trim().split(/\r?\n/);
  const parse = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let dentro = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (dentro && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else dentro = !dentro;
      } else if (c === ',' && !dentro) {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  return { intestazioni: parse(linee[0] ?? ''), righe: linee.slice(1).map(parse) };
}

function scheda(over: Partial<Row> = {}): Row {
  return {
    title: 'Olio extravergine',
    shortDescription: 'Breve',
    longDescription: 'Lunga',
    bullets: ['a', 'b'],
    metaDescription: 'Meta',
    faq: [],
    altText: 'alt',
    usedFactKeys: [],
    warnings: [],
    ...over,
  };
}

function seedProdotto(id: string, over: { canonical?: Row; gen?: Row; prodotto?: Row } = {}) {
  db.seed('products', [
    {
      id,
      batch_id: BATCH,
      external_id: id.toUpperCase(),
      name: `Prodotto ${id}`,
      category: 'Olio EVO',
      parent_external_id: null,
      canonical_attributes_json: { sku: id.toUpperCase(), ...(over.canonical ?? {}) },
      ...(over.prodotto ?? {}),
    },
  ]);
  db.seed('product_generations', [
    {
      id: `gen-${id}`,
      product_id: id,
      generated_content_json: scheda(),
      edited_content_json: null,
      audit_json: { severity: 'none', passed: true, unsupportedClaims: [], conflicts: [] },
      completeness_json: { status: 'complete' },
      translations_json: {},
      status: 'generated',
      created_at: '2026-01-01T00:00:00Z',
      ...(over.gen ?? {}),
    },
  ]);
}

function seminaVarianti(productId: string, varianti: Array<{ sku: string; attributi?: Row }>) {
  db.seed(
    'product_variants',
    varianti.map((v, i) => ({
      id: `${productId}-v${i}`,
      product_id: productId,
      sku: v.sku,
      external_id: v.sku,
      variant_attributes_json: v.attributi ?? {},
    })),
  );
}

beforeEach(() => {
  db = new FakeDb();
});

// ---------------------------------------------------------------------------
// Prodotto e varianti nell'export.
//
// Il testo è generato UNA volta per prodotto: è tutto il punto del
// raggruppamento, ed è quello che fa costare un credito invece di otto. Ma le
// righe dell'export devono restare una per codice acquistabile, o il cliente
// non ritrova i codici che vende.
// ---------------------------------------------------------------------------

describe('export con varianti', () => {
  it('un prodotto con tre varianti dà tre righe, non una', async () => {
    seedProdotto('p1');
    seminaVarianti('p1', [
      { sku: 'TS100-RED', attributi: { colore: 'Rosso' } },
      { sku: 'TS100-BLU', attributi: { colore: 'Blu' } },
      { sku: 'TS100-NER', attributi: { colore: 'Nero' } },
    ]);
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(3);
  });

  it('ogni riga porta il proprio SKU e lo stesso testo', async () => {
    seedProdotto('p1');
    seminaVarianti('p1', [
      { sku: 'TS100-RED', attributi: { colore: 'Rosso' } },
      { sku: 'TS100-BLU', attributi: { colore: 'Blu' } },
    ]);
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    const iSku = intestazioni.indexOf('sku');
    const iTitolo = intestazioni.indexOf('generated_title');
    expect(righe.map((r) => r[iSku])).toEqual(['TS100-RED', 'TS100-BLU']);
    // Il testo è lo stesso: generato una volta, pagato una volta.
    expect(new Set(righe.map((r) => r[iTitolo])).size).toBe(1);
  });

  it('ogni riga porta il codice padre, che lega le varianti al prodotto', async () => {
    seedProdotto('p1');
    seminaVarianti('p1', [{ sku: 'TS100-RED' }, { sku: 'TS100-BLU' }]);
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    const i = intestazioni.indexOf('codice_padre');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(righe.map((r) => r[i])).toEqual(['P1', 'P1']);
  });

  it('un prodotto senza varianti resta una riga sola', async () => {
    // Il caso normale non deve cambiare: la stragrande maggioranza dei
    // cataloghi non ha varianti, e un prodotto non deve diventare due righe.
    seedProdotto('p1');
    seedProdotto('p2');
    seminaVarianti('p2', [{ sku: 'X-1' }, { sku: 'X-2' }]);
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(3);
  });

  it('nei tracciati e-commerce le righe sono i codici acquistabili', async () => {
    // Shopify e compagnia importano una riga per variante: se ne arrivasse una
    // sola col codice del modello, il cliente non potrebbe vendere nessuna
    // taglia.
    seedProdotto('p1');
    seminaVarianti('p1', [{ sku: 'TS100-RED' }, { sku: 'TS100-BLU' }]);
    const res = await buildBatchExport(db as never, BATCH, 'shopify');
    const testo = res.buffer.toString('utf8');
    expect(testo).toContain('TS100-RED');
    expect(testo).toContain('TS100-BLU');
    // Due varianti, due righe. Il codice del modello non è un codice
    // acquistabile e non deve aggiungerne una terza: l'importer creerebbe un
    // articolo in vendita che non esiste a magazzino.
    //
    // Il conteggio si legge da `rowCount` e non contando le righe del CSV: il
    // corpo HTML di Shopify può contenere a capo dentro un campo quotato, e il
    // lettore di comodo qui sopra li scambierebbe per record separati.
    expect(res.rowCount).toBe(2);
    expect(testo).not.toMatch(/,P1,/);
  });
});

describe('export CSV del batch', () => {
  it('esporta una riga per prodotto generato', async () => {
    seedProdotto('p1');
    seedProdotto('p2');
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(2);
    expect(csvDi(res.buffer).righe).toHaveLength(2);
  });

  it('un prodotto senza generazione non finisce nell’export', async () => {
    seedProdotto('p1');
    db.seed('products', [
      { id: 'p2', batch_id: BATCH, external_id: 'P2', name: 'Senza scheda', canonical_attributes_json: {} },
    ]);
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(1);
  });

  it('esclude le schede con audit di gravità alta', async () => {
    seedProdotto('p1');
    seedProdotto('p2', {
      gen: { audit_json: { severity: 'high', passed: false, unsupportedClaims: ['x'], conflicts: [] } },
    });
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(1);
  });

  it('esclude le schede bloccate o con dati insufficienti', async () => {
    seedProdotto('p1');
    seedProdotto('p2', { gen: { completeness_json: { status: 'blocked' } } });
    seedProdotto('p3', { gen: { completeness_json: { status: 'insufficient' } } });
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(1);
  });

  it('preferisce il testo corretto a mano a quello generato', async () => {
    seedProdotto('p1', { gen: { edited_content_json: scheda({ title: 'Titolo corretto' }) } });
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    const i = intestazioni.indexOf('generated_title');
    expect(righe[0]?.[i]).toBe('Titolo corretto');
  });

  it('gli attributi di categoria diventano colonne, con i loro valori', async () => {
    seedProdotto('p1');
    db.seed('attributes', [
      { id: 'a1', name: 'Acidità' },
      { id: 'a2', name: 'Cultivar' },
    ]);
    db.seed('product_attribute_values', [
      { id: 'v1', product_id: 'p1', attribute_id: 'a1', value_json: '0,3%', status: 'provided' },
      { id: 'v2', product_id: 'p1', attribute_id: 'a2', value_json: 'Coratina', status: 'confirmed' },
    ]);
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(intestazioni).toContain('Acidità');
    expect(intestazioni).toContain('Cultivar');
    expect(righe[0]?.[intestazioni.indexOf('Acidità')]).toBe('0,3%');
    expect(righe[0]?.[intestazioni.indexOf('Cultivar')]).toBe('Coratina');
  });

  it('un attributo RIFIUTATO dall’utente non viene esportato', async () => {
    seedProdotto('p1');
    db.seed('attributes', [{ id: 'a1', name: 'Colore' }]);
    db.seed('product_attribute_values', [
      { id: 'v1', product_id: 'p1', attribute_id: 'a1', value_json: 'rosso', status: 'rejected' },
    ]);
    const { intestazioni } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(intestazioni).not.toContain('Colore');
  });

  it('un attributo con valore vuoto non crea una colonna vuota', async () => {
    seedProdotto('p1');
    db.seed('attributes', [{ id: 'a1', name: 'Formato' }]);
    db.seed('product_attribute_values', [
      { id: 'v1', product_id: 'p1', attribute_id: 'a1', value_json: '   ', status: 'provided' },
    ]);
    const { intestazioni } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(intestazioni).not.toContain('Formato');
  });

  it('le colonne moda non compaiono in un catalogo che non le usa', async () => {
    seedProdotto('p1');
    const { intestazioni } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    for (const moda of ['color', 'composition', 'material', 'fit']) {
      expect(intestazioni, `colonna moda "${moda}" in un export senza dati moda`).not.toContain(moda);
    }
  });

  it('ma compaiono se il catalogo le ha davvero', async () => {
    seedProdotto('p1', { canonical: { color: 'Rosso', material: 'Cotone' } });
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(intestazioni).toContain('color');
    expect(righe[0]?.[intestazioni.indexOf('color')]).toBe('Rosso');
  });

  it('protegge dalle formule: una cella che inizia per "=" viene neutralizzata', async () => {
    seedProdotto('p1', { gen: { generated_content_json: scheda({ title: '=1+1' }) } });
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    const valore = righe[0]?.[intestazioni.indexOf('generated_title')] ?? '';
    expect(valore.startsWith('=')).toBe(false);
    expect(valore).toContain('1+1');
  });

  it('neutralizza anche i valori degli attributi di categoria', async () => {
    seedProdotto('p1');
    db.seed('attributes', [{ id: 'a1', name: 'Nota' }]);
    db.seed('product_attribute_values', [
      { id: 'v1', product_id: 'p1', attribute_id: 'a1', value_json: '=CMD()', status: 'provided' },
    ]);
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect((righe[0]?.[intestazioni.indexOf('Nota')] ?? '').startsWith('=')).toBe(false);
  });

  it('le traduzioni salvate diventano colonne per lingua', async () => {
    seedProdotto('p1', {
      gen: {
        translations_json: {
          en: {
            title: 'Extra virgin olive oil',
            shortDescription: 'Short',
            longDescription: 'Long',
            bullets: ['a'],
            metaDescription: 'Meta',
            altText: 'alt',
            faq: [{ question: 'Q?', answer: 'A.' }],
          },
        },
      },
    });
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(intestazioni).toContain('title_en');
    expect(righe[0]?.[intestazioni.indexOf('title_en')]).toBe('Extra virgin olive oil');
    expect(righe[0]?.[intestazioni.indexOf('faq_en')]).toContain('Q?');
  });

  it('nessuna traduzione: nessuna colonna di lingua', async () => {
    seedProdotto('p1');
    const { intestazioni } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(intestazioni.filter((h) => /_(en|fr|de|es|pt|nl)$/.test(h))).toEqual([]);
  });

  it('il codice padre compare solo se ci sono davvero varianti', async () => {
    seedProdotto('p1');
    const senza = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(senza.intestazioni).not.toContain('codice_padre');

    db.tables['products'] = [];
    db.tables['product_generations'] = [];
    seedProdotto('p2', { prodotto: { parent_external_id: 'PADRE-1' } });
    const con = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(con.intestazioni).toContain('codice_padre');
    expect(con.righe[0]?.[con.intestazioni.indexOf('codice_padre')]).toBe('PADRE-1');
  });

  it('usa la generazione PIÙ RECENTE quando ce n’è più d’una', async () => {
    seedProdotto('p1');
    db.seed('product_generations', [
      {
        id: 'gen-vecchia',
        product_id: 'p1',
        generated_content_json: scheda({ title: 'Vecchio titolo' }),
        edited_content_json: null,
        audit_json: { severity: 'none' },
        completeness_json: { status: 'complete' },
        translations_json: {},
        status: 'generated',
        created_at: '2020-01-01T00:00:00Z',
      },
    ]);
    const { intestazioni, righe } = csvDi((await buildBatchExport(db as never, BATCH, 'csv')).buffer);
    expect(righe[0]?.[intestazioni.indexOf('generated_title')]).toBe('Olio extravergine');
  });

  it('batch vuoto: file valido con zero righe, non un errore', async () => {
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(0);
    expect(res.buffer.length).toBeGreaterThan(0);
  });

  it('non legge i prodotti di un altro batch', async () => {
    seedProdotto('p1');
    db.seed('products', [
      { id: 'estraneo', batch_id: 'altro-batch', external_id: 'X', name: 'X', canonical_attributes_json: {} },
    ]);
    db.seed('product_generations', [
      {
        id: 'gen-estraneo',
        product_id: 'estraneo',
        generated_content_json: scheda({ title: 'Non deve uscire' }),
        edited_content_json: null,
        audit_json: { severity: 'none' },
        completeness_json: { status: 'complete' },
        translations_json: {},
        status: 'generated',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.rowCount).toBe(1);
    expect(res.buffer.toString('utf8')).not.toContain('Non deve uscire');
  });

  it('legge le generazioni in POCHE query, non una per prodotto', async () => {
    for (let i = 0; i < 30; i++) seedProdotto(`p${i}`);
    const prima = db.calls.length;
    await buildBatchExport(db as never, BATCH, 'csv');
    const query = db.calls.slice(prima).filter((c) => c.op === 'select').length;
    // 30 prodotti: senza il raggruppamento sarebbero 30+ letture.
    expect(query).toBeLessThanOrEqual(6);
  });
});

describe('formati di export', () => {
  it('xlsx produce un file con la firma di un archivio Office', async () => {
    seedProdotto('p1');
    const res = await buildBatchExport(db as never, BATCH, 'xlsx');
    expect(res.extension).toBe('xlsx');
    expect(res.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('csv dichiara il tipo di contenuto giusto', async () => {
    seedProdotto('p1');
    const res = await buildBatchExport(db as never, BATCH, 'csv');
    expect(res.contentType).toContain('csv');
    expect(res.extension).toBe('csv');
  });
});
