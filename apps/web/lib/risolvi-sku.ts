import {
  analizzaRobots,
  consentito,
  decidiIdentita,
  dominioDi,
  extractProductFromHtml,
  livelloDelDominio,
  type CandidatoPagina,
  type FornitoreRicerca,
  type Risoluzione,
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
  /** `true` quando la ricerca stessa è fallita: NON è «non trovato». */
  ricercaFallita: boolean;
}

/** Cache di robots.txt per dominio, viva quanto la lavorazione. */
type CacheRobots = Map<string, ReturnType<typeof analizzaRobots> | null>;

async function robotsDi(dominio: string, cache: CacheRobots) {
  if (cache.has(dominio)) return cache.get(dominio) ?? null;
  const res = await safeFetch(`https://${dominio}/robots.txt`, { maxBytes: 500_000, accept: 'text/plain' });
  // Un robots.txt che non risponde non è un divieto: è un file che non c'è, e
  // un sito che non dice niente non ha vietato niente. Un 500 momentaneo non
  // deve impedire per sempre di leggere un catalogo.
  const regole = res.ok ? analizzaRobots(new TextDecoder('utf-8').decode(res.bytes)) : null;
  cache.set(dominio, regole);
  return regole;
}

async function paginaConsentita(url: string, cache: CacheRobots): Promise<boolean> {
  let percorso = '/';
  let dominio = '';
  try {
    const u = new URL(url);
    percorso = u.pathname + u.search;
    dominio = u.hostname;
  } catch {
    return false;
  }
  const regole = await robotsDi(dominio, cache);
  return regole ? consentito(regole, percorso, USER_AGENT) : true;
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
  cacheRobots: CacheRobots = new Map(),
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
      ricercaFallita: true,
    };
  }

  const escluseDaRobots: string[] = [];
  const candidati: CandidatoPagina[] = [];
  // L'estratto di ogni pagina si tiene da parte mentre la si legge. Rifarlo
  // dopo, sulla sola pagina scelta, vorrebbe dire una seconda richiesta allo
  // stesso sito — e soprattutto un secondo contenuto: fra i due momenti la
  // pagina può cambiare, e i fatti scritti sulla scheda non sarebbero più
  // quelli su cui è stata decisa l'identità.
  const estrattoPerUrl = new Map<string, ReturnType<typeof extractProductFromHtml>>();

  for (const r of risultati) {
    if (candidati.length >= MAX_PAGINE_DA_LEGGERE) break;
    if (!(await paginaConsentita(r.url, cacheRobots))) {
      escluseDaRobots.push(r.url);
      continue;
    }
    const pagina = await safeFetch(r.url, {
      maxBytes: MAX_BYTE_PAGINA,
      accept: 'text/html,application/xhtml+xml',
    });
    if (!pagina.ok) continue;
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

  const estratto = risoluzione.scelto ? (estrattoPerUrl.get(risoluzione.scelto.url) ?? null) : null;
  return { risoluzione, estratto, escluseDaRobots, ricercaFallita: false };
}

function testoDaEstratto(dati: ReturnType<typeof extractProductFromHtml>): string {
  return [
    dati.name ?? '',
    dati.sku ?? '',
    dati.brand ?? '',
    ...Object.entries(dati.attributes).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
}
