// La coda a scaglioni della fonte «Lista SKU»: cosa rifare, cosa riprendere,
// quanto aspettare.
//
// Funzioni PURE. Il tempo entra come parametro, non come `Date.now()`: senza,
// le prove sull'attesa progressiva durerebbero un minuto l'una, e una prova
// lenta è una prova che prima o poi qualcuno salta.
//
// Un catalogo da cinquecento codici non entra in una richiesta sola. Da qui in
// avanti la lavorazione non è più «una chiamata che o riesce o scade»: è un
// registro di righe da fare, e ogni giro ne fa quante ne stanno nel tempo che
// ha. Le tre regole che rendono possibile fermarsi e riprendere stanno tutte
// qui.

import { normalizzaDominio } from './lista-sku.js';

// ---------------------------------------------------------------------------
// 1) COSA È GIÀ DECISO.
//
// Una riga decisa non si rifà: non perché costi, ma perché rifarla potrebbe
// dare una risposta diversa dalla prima, e il cliente si ritroverebbe due
// prodotti dallo stesso codice — o lo stesso codice agganciato a due pagine.
// ---------------------------------------------------------------------------

/** Il codice è in registro ma non è ancora stato cercato. */
export const IN_CODA = 'in-coda';

export const ESITI_DECISI = [
  'risolto',
  'risolto-con-riserva',
  'coda-conferma',
  'non-trovato',
] as const;

/** Dopo tanti tentativi falliti, un codice smette di essere riprovato. */
export const MAX_TENTATIVI = 3;

/**
 * `true` se per questa riga c'è una risposta, anche negativa.
 *
 * «Non trovato» è una risposta: abbiamo cercato e non c'era. «Errore» non lo è:
 * non siamo riusciti a cercare, e le due cose non vanno confuse — confonderle
 * vuol dire archiviare come inesistenti i prodotti cercati durante un guasto.
 */
export function esitoDeciso(esito: string): boolean {
  return (ESITI_DECISI as readonly string[]).includes(esito);
}

/** `true` se la riga va (ri)lavorata in questo giro. */
export function daLavorare(riga: { esito: string; tentativi: number }): boolean {
  if (esitoDeciso(riga.esito)) return false;
  if (riga.esito === IN_CODA) return true;
  return riga.tentativi < MAX_TENTATIVI;
}

// ---------------------------------------------------------------------------
// 2) IL RITMO PER DOMINIO.
//
// Cinquecento codici dello stesso fornitore vogliono dire duemila richieste al
// suo sito. Senza un ritmo si arriva a farsi bloccare l'indirizzo, e a quel
// punto non è più solo questa lavorazione a non funzionare.
//
// Il conto si tiene per dominio e non complessivo: due siti diversi non si
// disturbano a vicenda, e rallentare l'uno perché l'altro è lento sarebbe
// tempo buttato.
// ---------------------------------------------------------------------------

export interface StatoDominio {
  /** Quando è partita l'ultima richiesta a questo dominio. */
  ultima: number;
  /** Errori di fila. Si azzera alla prima risposta buona. */
  errori: number;
}

/** Distanza minima fra due richieste allo stesso sito. */
export const INTERVALLO_MINIMO_MS = 1_000;
/** Prima attesa dopo un errore; poi raddoppia. */
export const ATTESA_ERRORE_BASE_MS = 2_000;
/** Oltre questa non si sale: aspettare due minuti non fa tornare su un sito. */
export const ATTESA_ERRORE_MASSIMA_MS = 60_000;

/**
 * Quanto aspettare prima della prossima richiesta a quel dominio.
 *
 * Dopo un errore l'attesa cresce: 2s, 4s, 8s… Un sito che risponde male perché
 * è sotto carico va lasciato respirare, e insistere allo stesso ritmo è il modo
 * più rapido per trasformare un rallentamento in un blocco.
 */
export function attesaPrimaDi(stato: StatoDominio | undefined, adesso: number): number {
  if (!stato) return 0;
  const intervallo =
    stato.errori > 0
      ? Math.min(ATTESA_ERRORE_BASE_MS * 2 ** (stato.errori - 1), ATTESA_ERRORE_MASSIMA_MS)
      : INTERVALLO_MINIMO_MS;
  return Math.max(0, stato.ultima + intervallo - adesso);
}

/** Lo stato del dominio dopo una risposta. */
export function dopoLaRisposta(
  stato: StatoDominio | undefined,
  adesso: number,
  ok: boolean,
): StatoDominio {
  return { ultima: adesso, errori: ok ? 0 : (stato?.errori ?? 0) + 1 };
}

// ---------------------------------------------------------------------------
// 3) LA CACHE DELLA RISOLUZIONE.
//
// Lo stesso codice della stessa marca cercato due volte è la stessa domanda:
// la risposta si riusa. Ma solo se è ancora la risposta a QUELLA domanda, e le
// due condizioni che lo stabiliscono sono meno ovvie di quanto sembri.
//
//  - L'ETÀ. Una pagina prodotto sparisce, cambia indirizzo, cambia contenuto.
//    Un aggancio di sei mesi fa è una scommessa, non un dato.
//
//  - L'AMBITO. Se il cliente ha detto «cerca solo su fornitorex.it», una pagina
//    trovata altrove non è una risposta più economica: è una risposta a una
//    domanda che non ha fatto. E un «non trovato» ottenuto guardando solo un
//    sito non dice niente su tutto il resto del web.
// ---------------------------------------------------------------------------

/** Quanto vale un aggancio a una pagina. */
export const TTL_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Quanto vale un «non trovato».
 *
 * Meno di un aggancio, e apposta: una pagina che esiste tende a restare, un
 * prodotto che non si trovava il mese scorso può essere stato pubblicato ieri.
 * Tenersi un «non c'è» troppo a lungo vuol dire dire di no al cliente su un
 * prodotto che nel frattempo c'è.
 */
export const TTL_CACHE_NEGATIVA_MS = 7 * 24 * 60 * 60 * 1000;

export interface VoceCache {
  esito: string;
  dominioScelto: string | null;
  /** I domini a cui era limitata la ricerca allora. Vuoto = tutto il web. */
  ambito: string[];
  /** Quando è stata decisa, in ISO. */
  aggiornatoIl: string;
}

export interface ContestoCache {
  adesso: number;
  ttlMs?: number;
  ttlNegativoMs?: number;
  /** I domini a cui è limitata la ricerca adesso. Vuoto = tutto il web. */
  domini: string[];
}

function insieme(domini: string[]): Set<string> {
  return new Set((domini ?? []).map(normalizzaDominio).filter(Boolean));
}

/** `true` se `dominio` è fra quelli dichiarati, o è un loro sottodominio. */
function nelloScopo(dominio: string, domini: Set<string>): boolean {
  if (domini.size === 0) return true;
  const d = normalizzaDominio(dominio);
  if (!d) return false;
  if (domini.has(d)) return true;
  for (const dd of domini) if (d.endsWith(`.${dd}`)) return true;
  return false;
}

/**
 * Si può riusare questa risoluzione, e se no perché.
 *
 * Il motivo torna sempre, anche quando la risposta è sì: finisce nel registro,
 * ed è quello che permette a chi guarda una lavorazione di sapere quali righe
 * sono state cercate davvero e quali no.
 */
export function cacheUtilizzabile(
  voce: VoceCache,
  ctx: ContestoCache,
): { usa: boolean; motivo: string } {
  const trovata = voce.esito === 'risolto' || voce.esito === 'risolto-con-riserva';
  const negativa = voce.esito === 'non-trovato';
  // Una riga in coda di conferma non è una risposta: nessuno ha ancora deciso
  // quale pagina fosse. Riusarla vorrebbe dire riproporre una domanda, non
  // risparmiare una ricerca. Un errore, tanto meno.
  if (!trovata && !negativa) return { usa: false, motivo: 'Nessuna risposta da riusare.' };

  const eta = ctx.adesso - Date.parse(voce.aggiornatoIl);
  const ttl = negativa ? (ctx.ttlNegativoMs ?? TTL_CACHE_NEGATIVA_MS) : (ctx.ttlMs ?? TTL_CACHE_MS);
  if (!Number.isFinite(eta) || eta < 0 || eta > ttl) {
    return { usa: false, motivo: 'Ricerca precedente troppo vecchia: si rifà.' };
  }

  const adessoScopo = insieme(ctx.domini);
  const alloraScopo = insieme(voce.ambito);

  if (negativa) {
    // Un «non trovato» vale solo se allora si era guardato ALMENO dove si
    // guarderebbe adesso. Cercato su un sito solo, non dice niente sugli altri.
    const alloraPiuLarga =
      alloraScopo.size === 0 ||
      (adessoScopo.size > 0 && [...adessoScopo].every((d) => alloraScopo.has(d)));
    if (!alloraPiuLarga) {
      return { usa: false, motivo: 'La ricerca precedente guardava altrove: si rifà.' };
    }
    return { usa: true, motivo: 'Già cercato di recente senza trovarlo.' };
  }

  if (!nelloScopo(voce.dominioScelto ?? '', adessoScopo)) {
    return { usa: false, motivo: 'La pagina trovata prima è fuori dai siti indicati: si rifà.' };
  }
  return { usa: true, motivo: 'Ripresa da una ricerca già fatta.' };
}
