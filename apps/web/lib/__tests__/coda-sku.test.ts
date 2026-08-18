import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FornitoreRicerca, RichiestaRicerca, RisultatoRicerca } from '@app/core';
import { FakeDb } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// La coda a scaglioni: il giro vero, con il registro davvero scritto.
//
// Le regole di COSA fare stanno in @app/core e sono provate lì. Qui si prova
// l'ordine in cui si applicano, che è dove stanno i danni possibili:
//
//  - una riga già decisa che viene rifatta = lo stesso codice agganciato due
//    volte, magari a due pagine diverse, e due prodotti gemelli in catalogo;
//  - una ricerca rifatta quando c'era già una risposta = un secondo pagamento
//    per la stessa domanda;
//  - una pagina ripresa dalla cache e creduta sulla parola = i dati di un
//    prodotto diverso, scritti con la fiducia di uno verificato;
//  - un errore contato come «non trovato» = prodotti archiviati come
//    inesistenti perché il motore di ricerca era giù.
// ---------------------------------------------------------------------------

const ORA = Date.parse('2026-06-01T12:00:00Z');

const pagine = new Map<string, string>();
vi.mock('@/lib/safe-fetch', () => ({
  safeFetch: (url: string) => {
    const html = pagine.get(url);
    if (url.includes('guasto.it')) {
      return Promise.resolve({
        ok: false,
        status: 503,
        finalUrl: url,
        contentType: '',
        bytes: new Uint8Array(0),
        error: 'il sito non risponde',
      });
    }
    if (html === undefined) {
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
      contentType: url.endsWith('robots.txt') ? 'text/plain' : 'text/html',
      bytes: new TextEncoder().encode(html),
    });
  },
}));

const { eseguiScaglione } = await import('../coda-sku');
const { creaContestoRete } = await import('../risolvi-sku');

function paginaProdotto(codice: string, marca = 'Ferrini'): string {
  return `<html><head><title>${codice}</title>
    <script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: `Sedia ${codice}`,
      sku: codice,
      brand: { '@type': 'Brand', name: marca },
    })}</script>
  </head><body>
    <h1>Sedia ${codice}</h1>
    <div>Codice articolo: ${codice}</div>
    <table>
      <tr><th>Marca</th><td>${marca}</td></tr>
      <tr><th>Materiale</th><td>Rovere</td></tr>
      <tr><th>Larghezza</th><td>45 cm</td></tr>
    </table>
  </body></html>`;
}

class RicercaDiProva implements FornitoreRicerca {
  readonly nome = 'prova';
  chiamate: RichiestaRicerca[] = [];
  constructor(private readonly risposte: (codice: string) => RisultatoRicerca[]) {}
  async cerca(richiesta: RichiestaRicerca): Promise<RisultatoRicerca[]> {
    this.chiamate.push(richiesta);
    return this.risposte(richiesta.codice);
  }
}

class RicercaGuasta implements FornitoreRicerca {
  readonly nome = 'guasta';
  chiamate = 0;
  async cerca(): Promise<RisultatoRicerca[]> {
    this.chiamate++;
    throw new Error('502 dal motore');
  }
}

function risultatoSu(dominio: string, codice: string): RisultatoRicerca {
  const url = `https://${dominio}/p/${codice.toLowerCase()}`;
  pagine.set(url, paginaProdotto(codice));
  return { url, titolo: `Sedia ${codice}`, descrizione: '', dominio };
}

function db(): FakeDb {
  const d = new FakeDb();
  d.seed('sku_resolutions', []);
  return d;
}

function rigaInCoda(id: string, codice: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: 'org-1',
    batch_id: 'b1',
    codice_normalizzato: codice.toUpperCase(),
    marca_normalizzata: 'ferrini',
    codice_originale: codice,
    marca_originale: 'Ferrini',
    sku_membri: [codice],
    ambito: [],
    esito: 'in-coda',
    tentativi: 0,
    da_cache: false,
    product_id: null,
    creato_il: '2026-06-01T11:00:00Z',
    aggiornato_il: '2026-06-01T11:00:00Z',
    ...extra,
  };
}

/** Un orologio finto e un'attesa che non aspetta: le prove restano rapide. */
function ambiente() {
  let t = ORA;
  const attese: number[] = [];
  return {
    attese,
    adesso: () => t,
    attesa: async (ms: number) => {
      attese.push(ms);
      t += ms;
    },
    avanza: (ms: number) => {
      t += ms;
    },
  };
}

function dipendenze(fake: FakeDb, ricerca: FornitoreRicerca, amb: ReturnType<typeof ambiente>) {
  const creati: string[] = [];
  return {
    creati,
    dip: {
      service: fake as never,
      ricerca,
      adesso: amb.adesso,
      rete: creaContestoRete({ adesso: amb.adesso, attesa: amb.attesa }),
      materializza: async (riga: { codice_originale: string }) => {
        creati.push(riga.codice_originale);
        return { ok: true as const };
      },
    },
  };
}

beforeEach(() => {
  pagine.clear();
});

describe('un giro di coda', () => {
  it('lavora le righe in coda e si ferma quando non ce n’è più', async () => {
    const fake = db();
    fake.seed('sku_resolutions', [rigaInCoda('r1', 'SED-AUR-01'), rigaInCoda('r2', 'SED-AUR-02')]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip, creati } = dipendenze(fake, ricerca, amb);

    const esito = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });

    expect(esito.lavorate).toBe(2);
    expect(esito.finita).toBe(true);
    expect(creati).toEqual(['SED-AUR-01', 'SED-AUR-02']);
    expect(fake.byId('sku_resolutions', 'r1').esito).toBe('risolto');
  });

  it('un giro non supera la sua quota, e il giro dopo continua', async () => {
    const fake = db();
    fake.seed('sku_resolutions', [
      rigaInCoda('r1', 'A-1'),
      rigaInCoda('r2', 'A-2'),
      rigaInCoda('r3', 'A-3'),
    ]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    const primo = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1', max: 2 });
    expect(primo.lavorate).toBe(2);
    expect(primo.finita).toBe(false);

    const secondo = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1', max: 2 });
    expect(secondo.lavorate).toBe(1);
    expect(secondo.finita).toBe(true);
    // Tre righe, tre ricerche: nessuna rifatta al secondo giro.
    expect(ricerca.chiamate).toHaveLength(3);
  });

  it('quando il tempo è finito non prende la riga, invece di lasciarla a metà', async () => {
    // Una riga presa e non registrata tornerebbe in coda come se non fosse mai
    // partita, e al giro dopo si ripagherebbe la ricerca già fatta.
    const fake = db();
    fake.seed('sku_resolutions', [rigaInCoda('r1', 'A-1')]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    const esito = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1', budgetMs: 0 });
    expect(esito.lavorate).toBe(0);
    expect(esito.finita).toBe(false);
    expect(ricerca.chiamate).toHaveLength(0);
    expect(fake.byId('sku_resolutions', 'r1').esito).toBe('in-coda');
  });

  it('una riga già decisa non si rifà', async () => {
    // Rifarla non costa soltanto: può dare una risposta diversa dalla prima, e
    // il cliente si ritroverebbe due prodotti dallo stesso codice.
    const fake = db();
    fake.seed('sku_resolutions', [
      rigaInCoda('r1', 'A-1', { esito: 'risolto', url_scelto: 'https://ferrini.it/p/a-1' }),
      rigaInCoda('r2', 'A-2', { esito: 'coda-conferma' }),
      rigaInCoda('r3', 'A-3', { esito: 'non-trovato' }),
    ]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip, creati } = dipendenze(fake, ricerca, amb);

    const esito = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });
    expect(esito.lavorate).toBe(0);
    expect(esito.finita).toBe(true);
    expect(ricerca.chiamate).toHaveLength(0);
    expect(creati).toEqual([]);
  });
});

describe('gli errori della ricerca', () => {
  it('un guasto del motore non archivia il prodotto come inesistente', async () => {
    const fake = db();
    fake.seed('sku_resolutions', [rigaInCoda('r1', 'A-1')]);
    const amb = ambiente();
    const { dip } = dipendenze(fake, new RicercaGuasta(), amb);

    await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });
    const riga = fake.byId('sku_resolutions', 'r1');
    expect(riga.esito).toBe('errore');
    expect(riga.esito).not.toBe('non-trovato');
    expect(riga.tentativi).toBe(1);
  });

  it('si riprova, ma non all’infinito', async () => {
    const fake = db();
    fake.seed('sku_resolutions', [rigaInCoda('r1', 'A-1')]);
    const amb = ambiente();
    const guasta = new RicercaGuasta();
    const { dip } = dipendenze(fake, guasta, amb);

    for (let i = 0; i < 6; i++) {
      await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });
      amb.avanza(1_000);
    }
    // Tre tentativi e poi basta: una lavorazione che riprova per sempre non
    // finisce mai e non lo dice a nessuno.
    expect(guasta.chiamate).toBe(3);
    expect(fake.byId('sku_resolutions', 'r1').tentativi).toBe(3);
  });

  it('una riga esaurita non nasconde le altre ancora da riprovare', async () => {
    const fake = db();
    fake.seed('sku_resolutions', [
      // La più vecchia è quella esaurita: se il limite fosse un controllo dopo
      // la lettura invece che dentro la query, la coda si fermerebbe qui.
      rigaInCoda('r1', 'A-1', { esito: 'errore', tentativi: 3, aggiornato_il: '2026-06-01T09:00:00Z' }),
      rigaInCoda('r2', 'A-2', { esito: 'errore', tentativi: 1, aggiornato_il: '2026-06-01T10:00:00Z' }),
    ]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    const esito = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });
    expect(esito.lavorate).toBe(1);
    expect(fake.byId('sku_resolutions', 'r2').esito).toBe('risolto');
    expect(fake.byId('sku_resolutions', 'r1').esito).toBe('errore');
  });
});

describe('la cache fra lavorazioni', () => {
  it('la stessa domanda non si paga due volte', async () => {
    const fake = db();
    const url = 'https://ferrini.it/p/sed-aur-01';
    pagine.set(url, paginaProdotto('SED-AUR-01'));
    fake.seed('sku_resolutions', [
      // Una lavorazione di ieri, stessa organizzazione, stesso codice.
      rigaInCoda('vecchia', 'SED-AUR-01', {
        batch_id: 'b0',
        esito: 'risolto',
        url_scelto: url,
        dominio_scelto: 'ferrini.it',
        aggiornato_il: new Date(ORA - 24 * 60 * 60 * 1000).toISOString(),
      }),
      rigaInCoda('r1', 'SED-AUR-01'),
    ]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip, creati } = dipendenze(fake, ricerca, amb);

    const esito = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });

    expect(ricerca.chiamate).toHaveLength(0);
    expect(esito.riusateDaCache).toBe(1);
    expect(creati).toEqual(['SED-AUR-01']);
    const riga = fake.byId('sku_resolutions', 'r1');
    expect(riga.da_cache).toBe(true);
    expect(riga.esito).toBe('risolto');
  });

  it('la pagina ripresa si ricontrolla: se non è più quel prodotto, si ricerca', async () => {
    // Un indirizzo viene riusato. Riprendere l'aggancio senza guardare vorrebbe
    // dire scrivere in scheda i dati di un altro prodotto con la fiducia di uno
    // verificato.
    const fake = db();
    const vecchioUrl = 'https://ferrini.it/p/vecchio';
    pagine.set(vecchioUrl, paginaProdotto('TUTTALTRO-99'));
    fake.seed('sku_resolutions', [
      rigaInCoda('vecchia', 'SED-AUR-01', {
        batch_id: 'b0',
        esito: 'risolto',
        url_scelto: vecchioUrl,
        dominio_scelto: 'ferrini.it',
        aggiornato_il: new Date(ORA - 24 * 60 * 60 * 1000).toISOString(),
      }),
      rigaInCoda('r1', 'SED-AUR-01'),
    ]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    const esito = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });

    expect(ricerca.chiamate).toHaveLength(1);
    expect(esito.riusateDaCache).toBe(0);
    const riga = fake.byId('sku_resolutions', 'r1');
    expect(riga.da_cache).toBe(false);
    expect(riga.url_scelto).toBe('https://ferrini.it/p/sed-aur-01');
  });

  it('non riprende una risposta di un’altra organizzazione', async () => {
    const fake = db();
    const url = 'https://ferrini.it/p/sed-aur-01';
    pagine.set(url, paginaProdotto('SED-AUR-01'));
    fake.seed('sku_resolutions', [
      rigaInCoda('altrui', 'SED-AUR-01', {
        organization_id: 'org-2',
        batch_id: 'b9',
        esito: 'risolto',
        url_scelto: url,
        dominio_scelto: 'ferrini.it',
        aggiornato_il: new Date(ORA - 60_000).toISOString(),
      }),
      rigaInCoda('r1', 'SED-AUR-01'),
    ]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });
    expect(ricerca.chiamate).toHaveLength(1);
  });

  it('un «non trovato» recente si riprende senza cercare di nuovo', async () => {
    const fake = db();
    fake.seed('sku_resolutions', [
      rigaInCoda('vecchia', 'INESISTENTE-1', {
        batch_id: 'b0',
        esito: 'non-trovato',
        url_scelto: null,
        aggiornato_il: new Date(ORA - 60 * 60 * 1000).toISOString(),
      }),
      rigaInCoda('r1', 'INESISTENTE-1'),
    ]);
    const ricerca = new RicercaDiProva(() => []);
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    const esito = await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });
    expect(ricerca.chiamate).toHaveLength(0);
    expect(esito.riusateDaCache).toBe(1);
    expect(fake.byId('sku_resolutions', 'r1').esito).toBe('non-trovato');
  });
});

describe('il ritmo verso i siti', () => {
  it('due richieste allo stesso sito sono distanziate', async () => {
    const fake = db();
    fake.seed('sku_resolutions', [rigaInCoda('r1', 'A-1'), rigaInCoda('r2', 'A-2')]);
    const ricerca = new RicercaDiProva((c) => [risultatoSu('ferrini.it', c)]);
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });

    // Cinquecento codici dello stesso fornitore sono duemila richieste al suo
    // sito: senza distanziarle ci si fa bloccare l'indirizzo, e a quel punto
    // non è più solo questa lavorazione a non funzionare.
    expect(amb.attese.length).toBeGreaterThan(0);
    expect(Math.max(...amb.attese)).toBeGreaterThanOrEqual(1_000);
  });

  it('un sito in difficoltà non rallenta gli altri', async () => {
    // L'attesa progressiva è del dominio che soffre, non della lavorazione: se
    // fosse comune, un fornitore giù farebbe strisciare tutto il catalogo.
    const fake = db();
    fake.seed('sku_resolutions', [rigaInCoda('r1', 'A-1'), rigaInCoda('r2', 'A-2')]);
    const ricerca = new RicercaDiProva((c) =>
      c === 'A-1' ? [risultatoSu('guasto.it', c)] : [risultatoSu('ok.it', c)],
    );
    const amb = ambiente();
    const { dip } = dipendenze(fake, ricerca, amb);

    await eseguiScaglione(dip, { orgId: 'org-1', batchId: 'b1' });

    // guasto.it: il robots.txt risponde 503, quindi la pagina aspetta il doppio.
    // ok.it riparte dalla distanza normale, come se l'altro non esistesse.
    expect(amb.attese).toEqual([2_000, 1_000]);
  });
});
