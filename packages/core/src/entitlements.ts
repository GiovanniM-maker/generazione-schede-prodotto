// ---------------------------------------------------------------------------
// Cosa può fare questa organizzazione, e come dirglielo.
//
// Un posto solo. Prima di questo file la risposta si componeva dove serviva:
// l'intestazione leggeva il saldo, la pagina della fatturazione lo rileggeva, il
// wizard non lo leggeva affatto e scopriva il problema dal server con un 402.
// Tre punti che rispondono alla stessa domanda sono tre punti che prima o poi
// rispondono in modo diverso.
//
// Qui dentro non si legge niente: i dati arrivano già letti (`entitlements(org)`
// in SQL li mette insieme in un giro solo). Questo file decide **cosa
// significano** e **come si dicono**, ed è per questo che si può provare senza
// un database.
//
// UNA REGOLA CHE VALE PER TUTTE LE FRASI
//
// Non si nomina mai una cosa che non c'è. Se il listino è vuoto, la frase non
// dice quale pacchetto comprare; se un lotto non ha scadenza, non si inventa una
// data. Il prodotto ha una promessa sola — i dati posseggono i fatti — e vale
// anche quando i fatti riguardano il conto.
// ---------------------------------------------------------------------------

export type FonteLotto = 'trial' | 'pack' | 'subscription' | 'manual';

export interface Lotto {
  id: string;
  fonte: FonteLotto;
  /** Quanti crediti restano in questo lotto. Sempre > 0: gli altri non arrivano. */
  rimanenti: number;
  /** ISO, oppure `null` per i lotti che non scadono. */
  scadeIl: string | null;
}

export interface Abbonamento {
  stato: string;
  creditiMensili: number;
  rinnovaIl: string | null;
  disdettoAFineCiclo: boolean;
}

export interface StatoAssistente {
  dotazione: number;
  richieste: number;
  dotazioneUsata: number;
  oltreLaDotazione: number;
  creditiAddebitati: number;
  cicloIniziaIl: string;
  cicloFinisceIl: string;
}

export interface Pacchetto {
  chiave: string;
  nome: string;
  crediti: number;
  prezzoCent: number | null;
  valuta: string;
}

/** Quello che `entitlements(org)` restituisce, più il listino. */
export interface Diritti {
  saldo: number;
  lotti: Lotto[];
  abbonamento: Abbonamento | null;
  omaggioFinoAl: string | null;
  assistente: StatoAssistente | null;
  pacchetti: Pacchetto[];
  /** L'istante di riferimento, che arriva dal database e non dall'orologio del browser. */
  adesso: string;
}

// ---------------------------------------------------------------------------
// Il piano
// ---------------------------------------------------------------------------

export type ChiavePiano = 'abbonamento' | 'omaggio' | 'consumo';

export interface Piano {
  chiave: ChiavePiano;
  etichetta: string;
  /** Una riga che spiega, non che decora. Vuota quando non c'è niente da aggiungere. */
  dettaglio: string;
  /** ISO: quando questo piano finisce, se finisce. */
  fineIl: string | null;
}

/** Gli stati Stripe in cui l'abbonamento dà ancora diritti. */
const ABBONAMENTO_VALE = new Set(['trialing', 'active', 'past_due']);

export function abbonamentoAttivo(d: Diritti): boolean {
  return d.abbonamento != null && ABBONAMENTO_VALE.has(d.abbonamento.stato);
}

export function omaggioAttivo(d: Diritti): boolean {
  return d.omaggioFinoAl != null && new Date(d.omaggioFinoAl) > new Date(d.adesso);
}

export function pianoAttuale(d: Diritti): Piano {
  if (abbonamentoAttivo(d)) {
    const a = d.abbonamento!;
    const dettaglio = a.disdettoAFineCiclo
      ? `Disdetto: resta attivo fino al ${dataBreve(a.rinnovaIl)}, poi non si rinnova.`
      : a.rinnovaIl
        ? `${a.creditiMensili} crediti al mese. Si rinnova il ${dataBreve(a.rinnovaIl)}.`
        : `${a.creditiMensili} crediti al mese.`;
    return { chiave: 'abbonamento', etichetta: 'Abbonamento', dettaglio, fineIl: a.rinnovaIl };
  }

  if (omaggioAttivo(d)) {
    return {
      chiave: 'omaggio',
      etichetta: 'Periodo in omaggio',
      dettaglio: `Hai i diritti del piano a pagamento fino al ${dataBreve(d.omaggioFinoAl)}, senza pagare.`,
      fineIl: d.omaggioFinoAl,
    };
  }

  return {
    chiave: 'consumo',
    etichetta: 'A consumo',
    dettaglio: 'Paghi i crediti che usi, quando li usi. Nessun canone.',
    fineIl: null,
  };
}

// ---------------------------------------------------------------------------
// Le scadenze
// ---------------------------------------------------------------------------

export interface InScadenza {
  crediti: number;
  /** ISO della prima scadenza fra quelle contate. */
  laPrimaIl: string;
  giorniAllaPrima: number;
  /** Quanti lotti diversi se ne vanno entro il termine. */
  lotti: number;
  /** L'avviso già scritto. */
  frase: string;
}

/**
 * Quanti crediti se ne vanno entro `giorni`, e quando comincia il conto alla
 * rovescia. `null` se non se ne va niente: un riquadro «0 crediti in scadenza»
 * è rumore che insegna a non leggere i riquadri.
 */
export function creditiInScadenza(d: Diritti, giorni = 30): InScadenza | null {
  const adesso = new Date(d.adesso).getTime();
  const limite = adesso + giorni * 24 * 3600 * 1000;

  const inScadenza = d.lotti
    .filter((l) => l.scadeIl != null && new Date(l.scadeIl).getTime() <= limite)
    .sort((a, b) => new Date(a.scadeIl!).getTime() - new Date(b.scadeIl!).getTime());

  if (inScadenza.length === 0) return null;

  const totale = inScadenza.reduce((n, l) => n + l.rimanenti, 0);
  const primo = inScadenza[0]!.scadeIl!;
  const giorniAllaPrima = giorniDa(d.adesso, primo);

  // Con un lotto solo la data sta già nella riga sopra, e ripeterla qui fa
  // leggere due volte la stessa cosa — che è il modo più rapido per insegnare
  // a saltare gli avvisi. Da due in su la data serve: dice quando comincia.
  const apertura =
    totale === 1
      ? `1 credito scade entro ${giorni} giorni`
      : `${totale} crediti scadono entro ${giorni} giorni`;
  const quando =
    inScadenza.length > 1
      ? ` I primi il ${dataBreve(primo)}, fra ${giorniAllaPrima} giorni.`
      : '';

  return {
    crediti: totale,
    laPrimaIl: primo,
    giorniAllaPrima,
    lotti: inScadenza.length,
    frase:
      `${apertura}.${quando} Vengono consumati per primi, ` +
      'quindi ti basta generare per non perderli.',
  };
}

// ---------------------------------------------------------------------------
// Bastano i crediti?
// ---------------------------------------------------------------------------

export interface EsitoVerifica {
  ok: boolean;
  richiesti: number;
  disponibili: number;
  /** Quanti ne mancano. Zero quando bastano. */
  mancano: number;
  /** Il pacchetto più piccolo che copre l'ammanco, se ce n'è uno. */
  pacchetto: Pacchetto | null;
  /** Quante volte va comprato: >1 solo se nemmeno il più grande basta da solo. */
  quantiPacchetti: number;
  /** La frase da mostrare. Mai vuota. */
  frase: string;
}

/**
 * Dice **prima di partire** se un batch si può generare.
 *
 * Il punto è tutto qui: la stessa risposta arrivava dal server dopo aver
 * premuto «Genera», sotto forma di 402, con un messaggio che rimandava a una
 * pagina chiamata col nome sbagliato. Chi ha caricato cinquecento righe merita
 * di saperlo mentre le guarda, con il numero esatto che manca e cosa comprare.
 */
export function verificaCrediti(d: Diritti, richiesti: number): EsitoVerifica {
  const disponibili = d.saldo;

  if (richiesti <= 0) {
    return {
      ok: false,
      richiesti,
      disponibili,
      mancano: 0,
      pacchetto: null,
      quantiPacchetti: 0,
      frase:
        'Nessun prodotto idoneo: servono uno SKU e almeno due attributi valorizzati per ' +
        'prodotto. Torna alla verifica dei dati e controlla la mappatura.',
    };
  }

  if (disponibili >= richiesti) {
    return {
      ok: true,
      richiesti,
      disponibili,
      mancano: 0,
      pacchetto: null,
      quantiPacchetti: 0,
      frase: `${crediti(richiesti)} su ${crediti(disponibili)} disponibili: ${
        disponibili - richiesti === 0
          ? 'li usi tutti.'
          : `te ne restano ${disponibili - richiesti}.`
      }`,
    };
  }

  const mancano = richiesti - disponibili;
  const acquistabili = d.pacchetti
    .filter((p) => p.crediti > 0)
    .sort((a, b) => a.crediti - b.crediti);

  const copre = acquistabili.find((p) => p.crediti >= mancano) ?? null;
  const piuGrande = acquistabili.length > 0 ? acquistabili[acquistabili.length - 1]! : null;
  const pacchetto = copre ?? piuGrande;
  const quantiPacchetti = pacchetto ? Math.ceil(mancano / pacchetto.crediti) : 0;

  const apertura = `Servono ${crediti(richiesti)} e ne hai ${disponibili}: ne mancano ${mancano}.`;

  // Senza listino non si nomina nessun pacchetto: sarebbe una promessa che la
  // pagina della fatturazione non può mantenere.
  let seguito: string;
  if (!pacchetto) {
    seguito = 'Aggiungi crediti dalla pagina Fatturazione.';
  } else if (quantiPacchetti === 1) {
    seguito = `Il pacchetto da ${pacchetto.crediti} li copre.`;
  } else {
    seguito = `Il pacchetto più grande è da ${pacchetto.crediti}: ne servono ${quantiPacchetti}.`;
  }

  return { ok: false, richiesti, disponibili, mancano, pacchetto, quantiPacchetti, frase: `${apertura} ${seguito}` };
}

export interface EsitoBatch {
  verifica: EsitoVerifica;
  /**
   * Quando i prodotti solo-immagini potrebbero far salire il conto oltre il
   * saldo. Non blocca: è un forse, e un forse non si spaccia per un no.
   */
  avvisoSoloImmagini: string | null;
}

/**
 * La verifica di un batch prima di avviarlo, con il caso che rende la cosa
 * meno ovvia di quanto sembri.
 *
 * I prodotti con le sole foto non sono ancora idonei: lo diventano dopo che
 * l'AI ha letto le etichette, e la lettura avviene **all'avvio**. Quindi il
 * numero di crediti che verranno riservati non si conosce con certezza finché
 * non si parte.
 *
 * Si blocca solo su quello che è certo — i prodotti già idonei — e si avvisa su
 * quello che è possibile. Bloccare sul forse vorrebbe dire fermare chi avrebbe
 * potuto generare; tacere sul forse vorrebbe dire farlo sbattere contro un
 * rifiuto a metà strada.
 */
export function verificaBatch(
  d: Diritti,
  conteggi: { idonei: number; soloImmagini: number },
): EsitoBatch {
  const massimo = conteggi.idonei + conteggi.soloImmagini;

  // Zero idonei ma delle foto da leggere non è «niente da generare»: è «non lo
  // so ancora». Bloccare qui fermerebbe proprio il caso per cui la lettura
  // delle etichette esiste — un catalogo di sole immagini, che è il modo in cui
  // arriva mezzo settore alimentare.
  if (conteggi.idonei === 0 && conteggi.soloImmagini > 0) {
    return {
      verifica: {
        ok: true,
        richiesti: 0,
        disponibili: d.saldo,
        mancano: 0,
        pacchetto: null,
        quantiPacchetti: 0,
        frase:
          `Nessun prodotto è ancora idoneo, ma ci sono ${conteggi.soloImmagini} prodotti con le ` +
          'sole foto: all’avvio l’AI legge le etichette e quelli con abbastanza dati diventano ' +
          `idonei. Hai ${d.saldo} crediti.`,
      },
      avvisoSoloImmagini:
        massimo > d.saldo
          ? `Se diventassero idonei tutti servirebbero ${massimo} crediti, ${massimo - d.saldo} ` +
            'più di quanti ne hai. Quelli scoperti restano da generare dopo.'
          : null,
    };
  }

  const verifica = verificaCrediti(d, conteggi.idonei);

  const avvisoSoloImmagini =
    verifica.ok && conteggi.soloImmagini > 0 && massimo > d.saldo
      ? `Ci sono ${conteggi.soloImmagini} prodotti con le sole foto: se l’AI riesce a leggerne le ` +
        `etichette diventano idonei, e potrebbero servire fino a ${massimo} crediti — ${
          massimo - d.saldo
        } più di quanti ne hai. Quelli scoperti restano da generare dopo.`
      : null;

  return { verifica, avvisoSoloImmagini };
}

// ---------------------------------------------------------------------------
// L'assistente
// ---------------------------------------------------------------------------

export interface RiepilogoAssistente {
  dotazione: number;
  usate: number;
  restanti: number;
  /** True quando si è oltre la dotazione e le richieste cominciano a costare. */
  aPagamento: boolean;
  frase: string;
}

/**
 * L'assistente è compreso: la frase deve dirlo prima di dire quanto costa.
 *
 * La regola precedente lo faceva pagare due volte — un quinto di credito a
 * richiesta, sopra al credito già speso per la scheda — e l'interfaccia lo
 * avrebbe raccontato come una tariffa. Non è una tariffa: è un tetto, e sopra il
 * tetto c'è un prezzo che quasi nessuno pagherà.
 */
export function riepilogoAssistente(a: StatoAssistente | null): RiepilogoAssistente | null {
  if (!a) return null;

  const restanti = Math.max(0, a.dotazione - a.dotazioneUsata);
  const aPagamento = a.dotazioneUsata >= a.dotazione;

  if (!aPagamento) {
    // Il numero si dice una volta sola. «93 su 100» quando le usate sono 7 fa
    // dire alla stessa riga tre volte la stessa cosa.
    return {
      dotazione: a.dotazione,
      usate: a.dotazioneUsata,
      restanti,
      aPagamento: false,
      frase:
        a.dotazioneUsata === 0
          ? `${a.dotazione} richieste comprese in questo ciclo, ancora tutte da usare.`
          : `Ti restano ${restanti} richieste comprese su ${a.dotazione}, in questo ciclo.`,
    };
  }

  const alProssimo = 5 - (a.oltreLaDotazione % 5);
  return {
    dotazione: a.dotazione,
    usate: a.dotazioneUsata,
    restanti: 0,
    aPagamento: true,
    frase:
      `Dotazione finita (${a.dotazione} richieste comprese). Da qui un credito ogni cinque richieste: ` +
      `ne hai fatte ${a.oltreLaDotazione} oltre la dotazione, il prossimo credito scatta fra ${alProssimo}.`,
  };
}

// ---------------------------------------------------------------------------
// Come si chiamano le cose a schermo
// ---------------------------------------------------------------------------

export const NOME_FONTE: Record<FonteLotto, string> = {
  trial: 'Prova gratuita',
  pack: 'Pacchetto acquistato',
  subscription: 'Abbonamento',
  manual: 'Accreditati da noi',
};

/** Il movimento del registro, detto in italiano. */
export const NOME_MOVIMENTO: Record<string, string> = {
  purchase: 'Acquisto',
  welcome: 'Benvenuto',
  subscription_grant: 'Crediti dell’abbonamento',
  reservation: 'Prenotazione',
  release: 'Rilascio',
  consumption: 'Consumo',
  refund: 'Rimborso',
  expiry: 'Scaduti',
  admin_adjustment: 'Rettifica',
};

// ---------------------------------------------------------------------------
// Spiccioli
// ---------------------------------------------------------------------------

function crediti(n: number): string {
  return n === 1 ? '1 credito' : `${n} crediti`;
}

/** Giorni interi mancanti, arrotondati per eccesso: «scade fra 0 giorni» non si dice. */
export function giorniDa(daISO: string, aISO: string): number {
  const ms = new Date(aISO).getTime() - new Date(daISO).getTime();
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

export function dataBreve(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}
