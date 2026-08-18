import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImmagineCandidata } from '@app/core';
import { FakeDb } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Lo scaricamento delle immagini trovate su una pagina.
//
// La prova che vale di più è quella sulla DEDUPLICA PER IMPRONTA: la stessa
// foto compare più volte nella stessa pagina, e su più varianti, con indirizzi
// diversi — ridimensionamenti, parametri di cache. Deduplicando sull'indirizzo
// invece che sul contenuto, il cliente si vedrebbe otto copie identiche in
// catalogo e ne pagherebbe lo storage.
//
// L'altra è che un prodotto senza foto NON è un errore: resta valido e si
// conta a parte.
// ---------------------------------------------------------------------------

const service = { corrente: null as FakeDb | null };
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => service.corrente,
}));

const risposte = new Map<string, { bytes: Buffer; contentType: string }>();
vi.mock('@/lib/safe-fetch', () => ({
  safeFetch: (url: string) => {
    const r = risposte.get(url);
    if (!r) {
      return Promise.resolve({
        ok: false,
        status: 404,
        finalUrl: url,
        contentType: '',
        bytes: new Uint8Array(0),
        error: 'non trovata',
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      finalUrl: url,
      contentType: r.contentType,
      bytes: new Uint8Array(r.bytes),
    });
  },
}));

const { scaricaImmaginiDaPagina } = await import('../immagini-da-web');

function foto(url: string, contenuto: string, contentType = 'image/jpeg'): ImmagineCandidata {
  risposte.set(url, { bytes: Buffer.from(contenuto), contentType });
  return { url, larghezza: 1200, altezza: 1200 };
}

const CTX = {
  orgId: 'org-1',
  batchId: 'b1',
  productId: 'p1',
  batchSourceId: 'bs1',
  urlPagina: 'https://ferrini.it/p/sed-aur-01',
  livelloDominio: 'produttore' as const,
  sku: 'SED-AUR-01',
};

beforeEach(() => {
  service.corrente = new FakeDb();
  risposte.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('scaricaImmaginiDaPagina', () => {
  it('scarica le foto e le collega al prodotto', async () => {
    const c = [foto('https://cdn.it/1.jpg', 'AAA'), foto('https://cdn.it/2.jpg', 'BBB')];
    const esito = await scaricaImmaginiDaPagina(c, CTX);

    expect(esito.scaricate).toBe(2);
    expect(service.corrente!.rows('source_files')).toHaveLength(2);
    expect(service.corrente!.rows('source_items')).toHaveLength(2);
    expect(service.corrente!.rows('product_source_links')).toHaveLength(2);
  });

  it('la stessa foto a due indirizzi diversi si scarica una volta sola', async () => {
    // È il caso vero: `foto.jpg?v=2` e `foto-800.jpg` sono lo stesso file.
    // Deduplicare sull'indirizzo non li riconoscerebbe, e il cliente si
    // ritroverebbe due copie identiche in catalogo.
    const c = [
      foto('https://cdn.it/foto.jpg?v=1', 'STESSO CONTENUTO'),
      foto('https://cdn.it/foto-800.jpg', 'STESSO CONTENUTO'),
    ];
    const esito = await scaricaImmaginiDaPagina(c, CTX);

    expect(esito.scaricate).toBe(1);
    expect(esito.doppioni).toBe(1);
    expect(service.corrente!.rows('source_files')).toHaveLength(1);
  });

  it('riconosce un file già arrivato da un’altra pagina dello stesso batch', async () => {
    service.corrente!.seed('source_files', [
      {
        id: 'sf-esistente',
        batch_id: 'b1',
        sha256: '9c9b1bd0e0d5c8c0f8e0a1f5e0e6c7f8', // sovrascritto sotto
      },
    ]);
    // L'impronta vera del contenuto, così il confronto è quello del codice.
    const { createHash } = await import('node:crypto');
    service.corrente!.rows('source_files')[0]!.sha256 = createHash('sha256')
      .update(Buffer.from('CONTENUTO'))
      .digest('hex');

    const esito = await scaricaImmaginiDaPagina([foto('https://cdn.it/1.jpg', 'CONTENUTO')], CTX);
    expect(esito.scaricate).toBe(0);
    expect(esito.doppioni).toBe(1);
  });

  it('ogni immagine porta da dove viene', async () => {
    // Due domande diverse: «questa foto da dove esce» e «posso pubblicarla».
    await scaricaImmaginiDaPagina([foto('https://cdn.it/1.jpg', 'AAA')], CTX);
    const meta = service.corrente!.rows('source_items')[0]!.metadata_json as Record<string, unknown>;
    expect(meta).toMatchObject({
      daRicerca: true,
      urlPagina: 'https://ferrini.it/p/sed-aur-01',
      urlFile: 'https://cdn.it/1.jpg',
      livelloDominio: 'produttore',
      dirittiDaVerificare: true,
    });
    expect(typeof meta.recuperataIl).toBe('string');
  });

  it('scarta loghi e badge prima di scaricarli', async () => {
    // Scartare DOPO aver scaricato vorrebbe dire pagare banda e storage per
    // buttare via il logo del negozio.
    const c = [foto('https://cdn.it/logo.png', 'LOGO'), foto('https://cdn.it/1.jpg', 'AAA')];
    const esito = await scaricaImmaginiDaPagina(c, CTX);
    expect(esito.scaricate).toBe(1);
    expect(esito.scartate).toBe(1);
    expect(service.corrente!.rows('source_files')).toHaveLength(1);
  });

  it('un’immagine irraggiungibile non ferma le altre', async () => {
    const c: ImmagineCandidata[] = [
      { url: 'https://cdn.it/rotta.jpg', larghezza: 1200, altezza: 1200 },
      foto('https://cdn.it/1.jpg', 'AAA'),
    ];
    const esito = await scaricaImmaginiDaPagina(c, CTX);
    expect(esito.scaricate).toBe(1);
    expect(esito.fallite).toBe(1);
  });

  it('un formato che non sappiamo trattare viene contato, non salvato', async () => {
    const c = [foto('https://cdn.it/1.tiff', 'TIFF', 'image/tiff')];
    const esito = await scaricaImmaginiDaPagina(c, CTX);
    expect(esito.scaricate).toBe(0);
    expect(esito.fallite).toBe(1);
    expect(service.corrente!.rows('source_files')).toHaveLength(0);
  });

  it('una pagina senza foto utili non è un errore', async () => {
    const esito = await scaricaImmaginiDaPagina([foto('https://cdn.it/logo.png', 'LOGO')], CTX);
    expect(esito.scaricate).toBe(0);
    expect(esito.fallite).toBe(0);
  });

  it('assegna alla variante solo quello che la pagina dichiara', async () => {
    const c: ImmagineCandidata[] = [
      { ...foto('https://cdn.it/rossa.jpg', 'ROSSA'), varianteDichiarata: 'TS100-RED' },
      foto('https://cdn.it/generica.jpg', 'GENERICA'),
    ];
    await scaricaImmaginiDaPagina(c, { ...CTX, valoriVariante: ['TS100-RED', 'TS100-BLU'] });

    const voci = service.corrente!.rows('source_items');
    const perFile = new Map(
      voci.map((v) => [
        (v.metadata_json as Record<string, unknown>).urlFile as string,
        (v.metadata_json as Record<string, unknown>).varianteDichiarata,
      ]),
    );
    expect(perFile.get('https://cdn.it/rossa.jpg')).toBe('TS100-RED');
    // Quella che la pagina non associa a nessun colore resta del prodotto: non
    // si indovina quale foto sia di quale variante.
    expect(perFile.get('https://cdn.it/generica.jpg')).toBeNull();
  });
});
