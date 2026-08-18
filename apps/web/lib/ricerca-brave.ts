import {
  LIMITE_RISULTATI_MASSIMO,
  LIMITE_RISULTATI_PREDEFINITO,
  RicercaFinta,
  costruisciQuery,
  leggiRisultatiBrave,
  type FornitoreRicerca,
  type RichiestaRicerca,
  type RisultatoRicerca,
} from '@app/core';
import { getServerEnv } from '@/lib/env.server';

// ---------------------------------------------------------------------------
// Brave Search: la metà impura della ricerca per codice.
//
// Costruire la query e leggere la risposta stanno in @app/core, provati senza
// spendere una chiamata. Qui resta quello che non si può provare senza rete:
// l'indirizzo, le intestazioni, il limite di richieste al secondo, e cosa fare
// quando il servizio risponde male.
//
// Due scelte che non sono ovvie:
//
//  1) SENZA CHIAVE SI USA IL FINTO, E IL FINTO NON INVENTA NIENTE. Restituisce
//     zero risultati, quindi ogni prodotto risulta «non trovato». È scomodo
//     apposta: un finto che restituisse pagine plausibili farebbe sembrare
//     funzionante in sviluppo un percorso che in produzione non lo è.
//
//  2) UN ERRORE DEL SERVIZIO NON È UN PRODOTTO NON TROVATO. Sono due cose
//     diverse e vanno tenute diverse: «ho cercato e non c'è» si scrive nella
//     scheda, «non sono riuscito a cercare» si riprova. Confonderle vorrebbe
//     dire archiviare come inesistenti i prodotti cercati durante un guasto.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
/** Il piano base di Brave consente una richiesta al secondo. */
const INTERVALLO_MINIMO_MS = 1100;
const TIMEOUT_MS = 10_000;
const TENTATIVI = 3;

export class ErroreRicerca extends Error {
  constructor(
    message: string,
    /** `true` quando ritentare più tardi ha senso: quota, timeout, 5xx. */
    readonly ritentabile: boolean,
  ) {
    super(message);
    this.name = 'ErroreRicerca';
  }
}

export interface OpzioniRicercaBrave {
  /**
   * Come si aspetta. Esiste per i test: un'attesa vera renderebbe la prova del
   * ritentativo lunga tre secondi, e una prova lenta è una prova che qualcuno
   * prima o poi salta.
   */
  attesa?: (ms: number) => Promise<void>;
  tentativi?: number;
}

export class RicercaBrave implements FornitoreRicerca {
  readonly nome = 'brave';
  private ultimaChiamata = 0;
  private readonly attesa: (ms: number) => Promise<void>;
  private readonly tentativi: number;

  constructor(
    private readonly apiKey: string,
    opzioni: OpzioniRicercaBrave = {},
  ) {
    this.attesa = opzioni.attesa ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.tentativi = Math.max(1, opzioni.tentativi ?? TENTATIVI);
  }

  /** Una richiesta al secondo, contate da qui: il conto lo tiene il servizio. */
  private async aspettaIlTurno(): Promise<void> {
    const da = Date.now() - this.ultimaChiamata;
    if (this.ultimaChiamata > 0 && da < INTERVALLO_MINIMO_MS) {
      await this.attesa(INTERVALLO_MINIMO_MS - da);
    }
    this.ultimaChiamata = Date.now();
  }

  async cerca(richiesta: RichiestaRicerca): Promise<RisultatoRicerca[]> {
    const q = costruisciQuery(richiesta);
    // Senza codice non c'è ricerca da fare, e chiamare comunque costerebbe.
    if (!q) return [];

    const limite = Math.max(1, Math.min(richiesta.limite || LIMITE_RISULTATI_PREDEFINITO, LIMITE_RISULTATI_MASSIMO));
    const url = new URL(ENDPOINT);
    url.searchParams.set('q', q);
    url.searchParams.set('count', String(limite));
    // I cataloghi dei clienti sono italiani; l'attenuazione dei contenuti per
    // adulti resta al valore predefinito del servizio.
    url.searchParams.set('country', 'it');
    url.searchParams.set('search_lang', 'it');

    let ultimoErrore: ErroreRicerca | null = null;
    for (let tentativo = 1; tentativo <= this.tentativi; tentativo++) {
      await this.aspettaIlTurno();
      try {
        const risposta = await fetch(url, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (risposta.status === 429 || risposta.status >= 500) {
          ultimoErrore = new ErroreRicerca(`Brave ha risposto ${risposta.status}`, true);
        } else if (!risposta.ok) {
          // 401, 403, 422: la chiave è sbagliata o la query non è accettabile.
          // Ritentare non cambia niente e brucia quota.
          throw new ErroreRicerca(`Brave ha risposto ${risposta.status}`, false);
        } else {
          return leggiRisultatiBrave(await risposta.json(), limite);
        }
      } catch (e) {
        if (e instanceof ErroreRicerca && !e.ritentabile) throw e;
        ultimoErrore =
          e instanceof ErroreRicerca
            ? e
            : new ErroreRicerca(`Ricerca fallita: ${e instanceof Error ? e.message : 'errore'}`, true);
      }
      // Attesa progressiva: 1s, 2s, 4s.
      if (tentativo < this.tentativi) await this.attesa(1000 * 2 ** (tentativo - 1));
    }
    throw ultimoErrore ?? new ErroreRicerca('Ricerca fallita', true);
  }
}

let fornitore: FornitoreRicerca | null = null;

/**
 * Il fornitore di ricerca configurato.
 *
 * Senza `BRAVE_SEARCH_API_KEY` torna il finto, che non trova niente. È il
 * comportamento giusto: fa vedere subito che la ricerca non è configurata,
 * invece di far credere che funzioni.
 */
export function getFornitoreRicerca(): FornitoreRicerca {
  if (fornitore) return fornitore;
  const chiave = getServerEnv().BRAVE_SEARCH_API_KEY;
  fornitore = chiave ? new RicercaBrave(chiave) : new RicercaFinta();
  return fornitore;
}

/** Solo per i test: rimette il fornitore allo stato iniziale. */
export function azzeraFornitoreRicerca(): void {
  fornitore = null;
}
