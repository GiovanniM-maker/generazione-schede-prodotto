// Riconoscere il prodotto giusto fra i candidati trovati cercando uno SKU.
//
// È il punto più pericoloso di tutta la ricerca per codice, e va detto perché:
// un aggancio sbagliato produce una scheda in cui OGNI campo è errato pur
// avendo confidenza alta. Il meccanismo dei dubbi per campo non lo intercetta,
// perché ogni singolo dato è stato letto benissimo — dalla pagina sbagliata.
// Per questo l'identità è una decisione a sé, presa prima di scrivere qualunque
// campo, e presa su segnali che si possono verificare: il codice compare o non
// compare nella pagina, la marca coincide o non coincide, il dominio è quello
// del produttore o no. Nessuna valutazione libera, nessun «sembra il più
// pertinente».
//
// Funzioni PURE: chi cerca e chi scarica le pagine sta fuori.

import { normalizzaSku } from './sku-raggruppamento.js';

export type LivelloDominio = 'produttore' | 'fornitore' | 'terza-parte' | 'sconosciuto';

export interface CandidatoPagina {
  url: string;
  dominio: string;
  livelloDominio: LivelloDominio;
  titolo: string | null;
  /** La marca dichiarata dalla pagina (dati strutturati, meta, testo). */
  marcaPagina: string | null;
  /** Testo della pagina e dei suoi dati strutturati, già uniti da chi l'ha letta. */
  testo: string;
  prezzo: string | null;
  immaginePrincipale: string | null;
}

export interface RichiestaRisoluzione {
  /** Lo SKU o il codice modello da cercare. */
  codice: string;
  /** La marca dichiarata dal cliente. Disambigua, e quando manca si vede. */
  marca: string | null;
}

export interface SegnaliCandidato {
  /** Il codice compare nella pagina esattamente come l'ha scritto il cliente. */
  codiceEsatto: boolean;
  /** Compare in una forma equivalente: con altri separatori, o senza. */
  codiceNormalizzato: boolean;
  /** `null` quando la marca non è dichiarata da una delle due parti. */
  marcaCoincide: boolean | null;
  livelloDominio: LivelloDominio;
}

/** Soglie di decisione. Vanno tarate sui primi dati veri, non prima. */
export const SOGLIA_AUTOMATICA = 0.85;
export const SOGLIA_RISERVA = 0.6;
/** Sotto questa, il candidato non è un candidato. */
export const SOGLIA_MINIMA = 0.35;

/** Sigle societarie: «Ferrini» e «Ferrini S.r.l.» sono la stessa marca. */
const FORME_SOCIETARIE =
  /\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|gmbh|ltd|limited|inc|llc|b\.?v\.?|s\.?a\.?|co|company|group|italia|italy)\b/g;

/**
 * Il nome della marca ridotto a ciò che la identifica: niente sigle societarie,
 * niente accenti, niente punteggiatura. Esportata perché serve anche a decidere
 * se un dominio è quello del produttore, e due definizioni della stessa cosa
 * prima o poi divergono su un caso solo.
 */
export function normalizzaMarca(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(FORME_SOCIETARIE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Le forme in cui lo stesso codice può essere scritto altrove.
 *
 * «AB-12-RED» sul sito del produttore può essere «AB12RED» nel gestionale del
 * cliente, o «AB 12 RED» in un marketplace. Si cercano tutte: cercarne una sola
 * vuol dire non trovare la pagina e dichiarare «non trovato» un prodotto che
 * c'era.
 */
export function formeDelCodice(codice: string): string[] {
  const originale = (codice ?? '').trim();
  if (!originale) return [];
  const { normalizzato, compatto } = normalizzaSku(originale);
  const forme = [
    originale,
    normalizzato,
    compatto,
    normalizzato.replace(/-/g, ' '),
    normalizzato.replace(/-/g, '_'),
    normalizzato.replace(/-/g, '.'),
  ];
  return [...new Set(forme.filter((f) => f.length >= 3))];
}

/** Il codice compare come parola a sé, non incastrato dentro un altro codice. */
function comparePerIntero(testo: string, forma: string): boolean {
  const fuga = forma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // I confini sono «non alfanumerico», non `\b`: `\b` non scatta fra «-» e «1»,
  // e «AB-12» dentro «XAB-12» passerebbe per un'occorrenza buona.
  return new RegExp(`(^|[^a-zA-Z0-9])${fuga}([^a-zA-Z0-9]|$)`, 'i').test(testo);
}

export function rilevaSegnali(
  richiesta: RichiestaRisoluzione,
  candidato: CandidatoPagina,
): SegnaliCandidato {
  const testo = `${candidato.testo ?? ''}\n${candidato.titolo ?? ''}`;
  const forme = formeDelCodice(richiesta.codice);
  const originale = (richiesta.codice ?? '').trim();

  const codiceEsatto = originale.length >= 3 && comparePerIntero(testo, originale);
  const codiceNormalizzato =
    !codiceEsatto && forme.some((f) => f !== originale && comparePerIntero(testo, f));

  const marcaCliente = richiesta.marca ? normalizzaMarca(richiesta.marca) : '';
  const marcaPagina = candidato.marcaPagina ? normalizzaMarca(candidato.marcaPagina) : '';
  let marcaCoincide: boolean | null = null;
  if (marcaCliente && marcaPagina) {
    marcaCoincide = marcaCliente === marcaPagina || marcaPagina.includes(marcaCliente) || marcaCliente.includes(marcaPagina);
  }

  return { codiceEsatto, codiceNormalizzato, marcaCoincide, livelloDominio: candidato.livelloDominio };
}

/**
 * Da segnali a punteggio, con pesi scritti invece che sentiti.
 *
 * La regola che regge tutto: **senza il codice non c'è punteggio**. Una pagina
 * dove il codice non compare in nessuna forma vale zero anche se la marca
 * coincide ed è il sito del produttore — perché «il sito giusto» non vuol dire
 * «il prodotto giusto», e un catalogo di mille articoli soddisfa marca e
 * dominio per tutti e mille.
 */
export function punteggio(s: SegnaliCandidato): number {
  if (!s.codiceEsatto && !s.codiceNormalizzato) return 0;

  let p = s.codiceEsatto ? 0.55 : 0.3;
  if (s.marcaCoincide === true) p += 0.25;
  if (s.marcaCoincide === false) p -= 0.4;
  if (s.livelloDominio === 'produttore') p += 0.2;
  else if (s.livelloDominio === 'fornitore') p += 0.15;

  return Math.max(0, Math.min(1, Number(p.toFixed(3))));
}

export type EsitoIdentita =
  /** Codice esatto, marca coerente, dominio del produttore o del fornitore. */
  | 'risolto'
  /** Aggancio plausibile ma non confermabile: procede, e si porta dietro il dubbio. */
  | 'risolto-con-riserva'
  /** Serve una persona: collisione fra produttori, o segnali troppo deboli. */
  | 'coda-conferma'
  /** Nessun candidato regge. Non si sceglie il meno peggio. */
  | 'non-trovato';

export interface CandidatoValutato {
  candidato: CandidatoPagina;
  segnali: SegnaliCandidato;
  punteggio: number;
}

export interface Risoluzione {
  esito: EsitoIdentita;
  /** Il candidato scelto. `null` per `coda-conferma` e `non-trovato`. */
  scelto: CandidatoPagina | null;
  /** Ordinati per punteggio: sono quelli da mostrare nella coda di conferma. */
  valutati: CandidatoValutato[];
  /** Da 0 a 1. Moltiplica la confidenza di ogni campo estratto da qui. */
  punteggioIdentita: number;
  /** Perché è finita così, in italiano. Va mostrato accanto alla decisione. */
  motivo: string;
}

export function valuta(
  richiesta: RichiestaRisoluzione,
  candidati: CandidatoPagina[],
): CandidatoValutato[] {
  return candidati
    .map((candidato) => {
      const segnali = rilevaSegnali(richiesta, candidato);
      return { candidato, segnali, punteggio: punteggio(segnali) };
    })
    .sort((a, b) => b.punteggio - a.punteggio);
}

export function decidiIdentita(
  richiesta: RichiestaRisoluzione,
  candidati: CandidatoPagina[],
): Risoluzione {
  const valutati = valuta(richiesta, candidati);
  const utili = valutati.filter((v) => v.punteggio >= SOGLIA_MINIMA);

  if (utili.length === 0) {
    return {
      esito: 'non-trovato',
      scelto: null,
      valutati,
      punteggioIdentita: 0,
      motivo:
        valutati.length === 0
          ? 'Nessun candidato trovato per questo codice.'
          : 'Nessun candidato porta il codice cercato: scegliere il migliore fra pagine deboli vorrebbe dire indovinare.',
    };
  }

  // Collisione fra produttori: lo stesso codice, marche diverse. Non la decide
  // il sistema — è esattamente il caso in cui indovinare produce una scheda
  // interamente sbagliata con tutti i campi «letti bene».
  const conCodiceEsatto = utili.filter((v) => v.segnali.codiceEsatto);
  const marche = new Set(
    conCodiceEsatto
      .map((v) => (v.candidato.marcaPagina ? normalizzaMarca(v.candidato.marcaPagina) : ''))
      .filter(Boolean),
  );
  if (conCodiceEsatto.length >= 2 && marche.size >= 2) {
    return {
      esito: 'coda-conferma',
      scelto: null,
      valutati,
      punteggioIdentita: 0,
      motivo: `Lo stesso codice esiste presso ${marche.size} produttori diversi: serve una scelta.`,
    };
  }

  const migliore = utili[0]!;
  const secondo = utili[1];

  // Due candidati forti e indistinguibili: la differenza fra il primo e il
  // secondo è più piccola di quanto i segnali sappiano misurare.
  if (secondo && migliore.punteggio - secondo.punteggio < 0.05 && migliore.punteggio < SOGLIA_AUTOMATICA) {
    return {
      esito: 'coda-conferma',
      scelto: null,
      valutati,
      punteggioIdentita: 0,
      motivo: 'Due candidati si equivalgono: i segnali non bastano a sceglierne uno.',
    };
  }

  const dominioAffidabile =
    migliore.segnali.livelloDominio === 'produttore' || migliore.segnali.livelloDominio === 'fornitore';

  if (
    migliore.punteggio >= SOGLIA_AUTOMATICA &&
    migliore.segnali.codiceEsatto &&
    migliore.segnali.marcaCoincide === true &&
    dominioAffidabile
  ) {
    return {
      esito: 'risolto',
      scelto: migliore.candidato,
      valutati,
      punteggioIdentita: migliore.punteggio,
      motivo: 'Codice esatto e marca coerente sul sito del produttore o del fornitore.',
    };
  }

  if (migliore.punteggio >= SOGLIA_RISERVA) {
    const perche = !migliore.segnali.codiceEsatto
      ? 'il codice compare in una forma equivalente, non identica'
      : migliore.segnali.marcaCoincide === null
        ? 'la marca non è dichiarata o non è verificabile'
        : 'la pagina non è del produttore né di un fornitore riconosciuto';
    return {
      esito: 'risolto-con-riserva',
      scelto: migliore.candidato,
      valutati,
      punteggioIdentita: migliore.punteggio,
      motivo: `Aggancio plausibile ma non confermato: ${perche}.`,
    };
  }

  return {
    esito: 'coda-conferma',
    scelto: null,
    valutati,
    punteggioIdentita: 0,
    motivo: 'Corrispondenza troppo debole per procedere senza una conferma.',
  };
}

/**
 * La confidenza di un campo tiene conto di DUE cose: quanto bene è stato letto,
 * e quanto è sicuro che sia la pagina giusta.
 *
 * Un campo estratto perfettamente da una pagina agganciata con riserva resta un
 * campo debole, e deve finire fra i dubbi come tale. Senza questo prodotto, un
 * aggancio incerto consegnerebbe campi al 100%.
 */
export function confidenzaCampo(confidenzaEstrazione: number, punteggioIdentita: number): number {
  const e = Math.max(0, Math.min(1, confidenzaEstrazione));
  const i = Math.max(0, Math.min(1, punteggioIdentita));
  return Number((e * i).toFixed(3));
}

/**
 * Perché non è rimasto nessun candidato, detto come sta.
 *
 * «Nessun candidato trovato per questo codice» copriva tre situazioni diverse,
 * e due su tre erano una bugia: il motore che non propone niente, le pagine
 * escluse da robots.txt, e le pagine che ci sono ma non si lasciano leggere —
 * quest'ultima è la normalità sui siti di moda, che rispondono 403 a chi non
 * sembra un browser. Dire «non trovato» quando le pagine c'erano manda il
 * cliente a cercare il problema nei suoi codici, che sono giusti.
 */
export function motivoSenzaCandidati(conto: {
  proposti: number;
  esclusiDaRobots: number;
  nonLeggibili: number;
}): string {
  if (conto.proposti === 0) {
    return 'Il motore di ricerca non ha proposto nessuna pagina per questo codice.';
  }
  const pezzi: string[] = [];
  if (conto.esclusiDaRobots > 0) {
    pezzi.push(
      `${conto.esclusiDaRobots} ${conto.esclusiDaRobots === 1 ? 'esclusa' : 'escluse'} dal robots.txt del sito`,
    );
  }
  if (conto.nonLeggibili > 0) {
    pezzi.push(
      `${conto.nonLeggibili} non ${conto.nonLeggibili === 1 ? 'raggiungibile' : 'raggiungibili'}`,
    );
  }
  const dettaglio = pezzi.length > 0 ? `: ${pezzi.join(', ')}` : ', ma nessuna leggibile';
  return `${conto.proposti} ${conto.proposti === 1 ? 'pagina trovata' : 'pagine trovate'}${dettaglio}. Il codice potrebbe esserci: è la pagina che non si è lasciata leggere.`;
}
