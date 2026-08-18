import {
  analizzaRobots,
  attesaPrimaDi,
  consentito,
  decidiIdentita,
  dominioDi,
  dopoLaRisposta,
  extractProductFromHtml,
  livelloDelDominio,
  motivoSenzaCandidati,
  type CandidatoPagina,
  type FornitoreRicerca,
  type Risoluzione,
  type StatoDominio,
} from '@app/core';
import { safeFetch } from '@/lib/safe-fetch';

// ---------------------------------------------------------------------------
// Da un codice a una pagina agganciata.
//
// Mette insieme pezzi che sono già stati provati da soli: la ricerca (Brave o
// il finto), robots.txt, il fetch SSRF-safe, l'estrattore della fonte URL, e la
// decisione sull'identità. Qui non c'è nessuna regola nuova — le regole stanno
// in @app/core — c'è l'ordine in cui si applicano e cosa si fa quando qualcosa
// non risponde.
//
// L'estrattore è QUELLO della fonte URL, non un secondo estrattore che gli
// somiglia: la ricerca per SKU è un risolutore che si innesta a monte, non una
// pipeline parallela. Il giorno in cui si corregge un difetto di estrazione, si
// corregge per tutte e due.
// ---------------------------------------------------------------------------

/** Quante pagine scaricare per prodotto: oltre, si paga banda per niente. */
const MAX_PAGINE_DA_LEGGERE = 4;
const MAX_BYTE_PAGINA = 3_000_000;
/** Il nome con cui ci presentiamo. Compare nei log di chi ci ospita. */
export const USER_AGENT = 'VerificatoBot';

export interface EsitoRisoluzione {
  risoluzione: Risoluzione;
  /** I dati estratti dalla pagina scelta. `null` se non c'è una pagina scelta. */
  estratto: ReturnType<typeof extractProductFromHtml> | null;
  /** Pagine saltate perché robots.txt le escludeva. */
  escluseDaRobots: string[];
  /** Pagine proposte dal motore ma che non si sono lasciate leggere. */
  nonLeggibili: string[];
  /** Quante pagine ha proposto il motore, prima di ogni filtro. */
  propostiDalMotore: number;
  /** `true` quando la ricerca stessa è fallita: NON è «non trovato». */
  ricercaFallita: boolean;
}

/** Cache di robots.txt per dominio, viva quanto la lavorazione. */
type CacheRobots = Map<string, ReturnType<typeof analizzaRobots> | null>;

// ---------------------------------------------------------------------------
// Il contesto di rete di una lavorazione: robots.txt già letti e ritmo per
// dominio.
//
// Vive quanto la lavorazione e non quanto la singola riga, ed è tutto il punto:
// cinquecento codici dello stesso fornitore sono duemila richieste al suo sito,
// e senza una memoria fra una riga e l'altra il ritmo non esiste — ogni riga
// ripartirebbe da zero e il sito le vedrebbe arrivare tutte insieme.
//
// Le regole di quanto aspettare stanno in @app/core, provate col tempo passato
// come parametro. Qui c'è solo l'orologio vero e l'attesa vera.
// ---------------------------------------------------------------------------

export interface ContestoRete {
  robots: CacheRobots;
  /** Aspetta il turno di quel dominio. */
  prima(dominio: string): Promise<void>;
  /** Registra com'è andata: un errore allunga l'attesa successiva. */
  dopo(dominio: string, ok: boolean): void;
}

export function creaContestoRete(
  opzioni: { adesso?: () => number; attesa?: (ms: number) => Promise<void> } = {},
): ContestoRete {
  const adesso = opzioni.adesso ?? (() => Date.now());
  const attesa = opzioni.attesa ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stati = new Map<string, StatoDominio>();

  return {
    robots: new Map(),
    async prima(dominio: string) {
      const ms = attesaPrimaDi(stati.get(dominio), adesso());
      if (ms > 0) await attesa(ms);
      // Il momento che conta è quello in cui la richiesta parte, non quello in
      // cui è tornata: distanziando dalla fine, due risposte lente basterebbero
      // a far partire due richieste a un millisecondo l'una dall'altra.
      stati.set(dominio, { ...(stati.get(dominio) ?? { errori: 0 }), ultima: adesso() });
    },
    dopo(dominio: string, ok: boolean) {
      stati.set(dominio, dopoLaRisposta(stati.get(dominio), adesso(), ok));
    },
  };
}

async function robotsDi(dominio: string, rete: ContestoRete) {
  if (rete.robots.has(dominio)) return rete.robots.get(dominio) ?? null;
  const res = await recupera(`https://${dominio}/robots.txt`, dominio, rete, {
    maxBytes: 500_000,
    accept: 'text/plain',
  });
  // Un robots.txt che non risponde non è un divieto: è un file che non c'è, e
  // un sito che non dice niente non ha vietato niente. Un 500 momentaneo non
  // deve impedire per sempre di leggere un catalogo.
  const regole = res.ok ? analizzaRobots(new TextDecoder('utf-8').decode(res.bytes)) : null;
  rete.robots.set(dominio, regole);
  return regole;
}

/** Una richiesta a un sito di terzi, al ritmo che quel sito si è guadagnato. */
async function recupera(
  url: string,
  dominio: string,
  rete: ContestoRete,
  opzioni: { maxBytes: number; accept: string },
) {
  await rete.prima(dominio);
  const res = await safeFetch(url, opzioni);
  // Solo un sito in DIFFICOLTÀ allunga l'attesa: troppe richieste, guasto,
  // rete che non risponde. Un 404 non è un sito che soffre — è una pagina che
  // non c'è, e il caso più comune di tutti è il robots.txt che manca. Contarlo
  // come guasto vorrebbe dire due secondi di penalità su quasi ogni dominio
  // visitato, cioè far durare un'ora una lavorazione da dieci minuti.
  const inDifficolta = !res.ok && (res.status === 0 || res.status === 429 || res.status >= 500);
  rete.dopo(dominio, !inDifficolta);
  return res;
}

async function paginaConsentita(url: string, rete: ContestoRete): Promise<boolean> {
  let percorso = '/';
  let dominio = '';
  try {
    const u = new URL(url);
    percorso = u.pathname + u.search;
    dominio = u.hostname;
  } catch {
    return false;
  }
  const regole = await robotsDi(dominio, rete);
  return regole ? consentito(regole, percorso, USER_AGENT) : true;
}

function hostDi(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export interface RichiestaRisolviSku {
  codice: string;
  marca: string | null;
  /** Domini a cui limitare la ricerca. Vuoto = tutto il web. */
  domini: string[];
}

/**
 * Trova la pagina di un prodotto a partire dal suo codice.
 *
 * Distingue due fallimenti che si assomigliano e vogliono dire cose opposte:
 * «ho cercato e non c'è» — che si scrive nella scheda e non si riprova — e
 * «non sono riuscito a cercare», che si riprova. Il secondo alza
 * `ricercaFallita`, e chi chiama NON deve archiviare quel codice come
 * inesistente.
 */
export async function risolviSku(
  ricerca: FornitoreRicerca,
  richiesta: RichiestaRisolviSku,
  rete: ContestoRete = creaContestoRete(),
): Promise<EsitoRisoluzione> {
  const vuoto: Risoluzione = {
    esito: 'non-trovato',
    scelto: null,
    valutati: [],
    punteggioIdentita: 0,
    motivo: 'Nessun candidato trovato per questo codice.',
  };

  let risultati;
  try {
    risultati = await ricerca.cerca({
      codice: richiesta.codice,
      marca: richiesta.marca,
      domini: richiesta.domini,
      limite: 10,
    });
  } catch (e) {
    return {
      risoluzione: {
        ...vuoto,
        motivo: `Ricerca non riuscita: ${e instanceof Error ? e.message : 'errore'}`,
      },
      estratto: null,
      escluseDaRobots: [],
      nonLeggibili: [],
      propostiDalMotore: 0,
      ricercaFallita: true,
    };
  }

  const escluseDaRobots: string[] = [];
  const nonLeggibili: string[] = [];
  const candidati: CandidatoPagina[] = [];
  // L'estratto di ogni pagina si tiene da parte mentre la si legge. Rifarlo
  // dopo, sulla sola pagina scelta, vorrebbe dire una seconda richiesta allo
  // stesso sito — e soprattutto un secondo contenuto: fra i due momenti la
  // pagina può cambiare, e i fatti scritti sulla scheda non sarebbero più
  // quelli su cui è stata decisa l'identità.
  const estrattoPerUrl = new Map<string, ReturnType<typeof extractProductFromHtml>>();

  for (const r of risultati) {
    if (candidati.length >= MAX_PAGINE_DA_LEGGERE) break;
    if (!(await paginaConsentita(r.url, rete))) {
      escluseDaRobots.push(r.url);
      continue;
    }
    const pagina = await recupera(r.url, hostDi(r.url) || r.dominio, rete, {
      maxBytes: MAX_BYTE_PAGINA,
      accept: 'text/html,application/xhtml+xml',
    });
    if (!pagina.ok) {
      // Non è un dettaglio da ingoiare: i siti di moda e i marketplace
      // rispondono spesso 403 a chi non sembra un browser, e senza questa riga
      // la pagina c'era, l'abbiamo trovata, e il cliente si sentiva dire che il
      // suo codice non esiste.
      nonLeggibili.push(r.url);
      continue;
    }
    const html = new TextDecoder('utf-8').decode(pagina.bytes);
    const dati = extractProductFromHtml(html, pagina.finalUrl);
    const dominio = dominioDi(pagina.finalUrl) || r.dominio;
    estrattoPerUrl.set(pagina.finalUrl, dati);

    candidati.push({
      url: pagina.finalUrl,
      dominio,
      livelloDominio: livelloDelDominio(dominio, richiesta.marca, richiesta.domini),
      titolo: dati.name ?? r.titolo,
      marcaPagina: dati.brand,
      // Il testo su cui si cerca il codice è quello della pagina, non l'estratto
      // del motore di ricerca: l'estratto è lungo duecento caratteri e il codice
      // articolo quasi mai ci sta dentro.
      testo: `${r.titolo}\n${r.descrizione}\n${testoDaEstratto(dati)}\n${html.replace(/<[^>]*>/g, ' ')}`,
      prezzo: dati.price,
      immaginePrincipale: dati.imageUrls[0] ?? null,
    });
  }

  const risoluzione = decidiIdentita(
    { codice: richiesta.codice, marca: richiesta.marca },
    candidati,
  );

  // Senza candidati, `decidiIdentita` non può sapere PERCHÉ non ce ne sono: da
  // lì dentro «zero pagine proposte» e «otto pagine che non si aprono» sono la
  // stessa cosa. Qui lo sappiamo, e va scritto.
  if (candidati.length === 0) {
    risoluzione.motivo = motivoSenzaCandidati({
      proposti: risultati.length,
      esclusiDaRobots: escluseDaRobots.length,
      nonLeggibili: nonLeggibili.length,
    });
  }

  const estratto = risoluzione.scelto ? (estrattoPerUrl.get(risoluzione.scelto.url) ?? null) : null;
  return {
    risoluzione,
    estratto,
    escluseDaRobots,
    nonLeggibili,
    propostiDalMotore: risultati.length,
    ricercaFallita: false,
  };
}

/**
 * Riprende una pagina già agganciata in passato, e ricontrolla che sia lei.
 *
 * È la metà utile della cache: la ricerca — che è la parte che si paga a
 * chiamata e che al motore costa un secondo di attesa — non si rifà, ma la
 * pagina sì. E la pagina va rivista, non creduta sulla parola: un indirizzo
 * viene riusato, un articolo esce di catalogo e al suo posto ne compare un
 * altro. Riprendere l'aggancio senza guardare vorrebbe dire scrivere in scheda
 * i dati di un prodotto diverso con la fiducia di uno verificato.
 *
 * Se il codice non si ritrova più sulla pagina, l'esito è `non-trovato` e chi
 * chiama rifà la ricerca vera: la cache era vecchia, non era una risposta.
 */
export async function riverificaPagina(
  url: string,
  richiesta: RichiestaRisolviSku,
  rete: ContestoRete = creaContestoRete(),
): Promise<EsitoRisoluzione> {
  const fuori: EsitoRisoluzione = {
    risoluzione: {
      esito: 'non-trovato',
      scelto: null,
      valutati: [],
      punteggioIdentita: 0,
      motivo: 'La pagina agganciata prima non conferma più questo codice.',
    },
    estratto: null,
    escluseDaRobots: [],
    nonLeggibili: [],
    propostiDalMotore: 0,
    ricercaFallita: false,
  };

  if (!(await paginaConsentita(url, rete))) return fuori;
  const pagina = await recupera(url, hostDi(url), rete, {
    maxBytes: MAX_BYTE_PAGINA,
    accept: 'text/html,application/xhtml+xml',
  });
  if (!pagina.ok) return fuori;

  const html = new TextDecoder('utf-8').decode(pagina.bytes);
  const dati = extractProductFromHtml(html, pagina.finalUrl);
  const dominio = dominioDi(pagina.finalUrl) || hostDi(url);
  const candidato: CandidatoPagina = {
    url: pagina.finalUrl,
    dominio,
    livelloDominio: livelloDelDominio(dominio, richiesta.marca, richiesta.domini),
    titolo: dati.name,
    marcaPagina: dati.brand,
    testo: `${testoDaEstratto(dati)}\n${html.replace(/<[^>]*>/g, ' ')}`,
    prezzo: dati.price,
    immaginePrincipale: dati.imageUrls[0] ?? null,
  };

  const risoluzione = decidiIdentita({ codice: richiesta.codice, marca: richiesta.marca }, [candidato]);
  if (!risoluzione.scelto) return fuori;
  return {
    risoluzione,
    estratto: dati,
    escluseDaRobots: [],
    nonLeggibili: [],
    propostiDalMotore: 1,
    ricercaFallita: false,
  };
}

function testoDaEstratto(dati: ReturnType<typeof extractProductFromHtml>): string {
  return [
    dati.name ?? '',
    dati.sku ?? '',
    dati.brand ?? '',
    ...Object.entries(dati.attributes).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
}
