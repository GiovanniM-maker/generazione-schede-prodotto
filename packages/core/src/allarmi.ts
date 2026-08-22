// Quando un guasto merita di svegliare qualcuno.
//
// Funzioni PURE: entrano degli eventi registrati, esce la decisione se
// avvisare e cosa scrivere.
//
// IL PROBLEMA CHE RISOLVE non è raccogliere gli errori — quelli finiscono già
// in `app_events`. È che nessuno li legge: bisogna ricordarsi di aprire un
// pannello, e nessuno se ne ricorda finché non è un cliente a scrivere.
//
// IL MODO IN CUI UN SISTEMA DI ALLARMI MUORE è sempre lo stesso: manda troppo.
// Un guasto che si ripete duecento volte in un'ora manda duecento email, chi
// le riceve spegne le notifiche, e da quel momento non arriva più niente —
// nemmeno il guasto vero della settimana dopo. Per questo qui dentro ci sono
// due cose e non una: il raggruppamento, che trasforma duecento occorrenze in
// una riga, e il silenzio, che impedisce di riprovarci subito.

/**
 * Gli eventi che raccontano un guasto, non un'attività normale.
 *
 * Sono i nomi che il codice SCRIVE DAVVERO in `app_events`: `write_failed` da
 * `writeOrTrace`, `credit_ledger_failed` da `creditOp`, `unhandled_error` da
 * `registraErrore`, `errore_server` dalla strumentazione. Un nome inventato qui
 * dentro non darebbe nessun errore — darebbe zero guasti per sempre, che è il
 * modo peggiore in cui un sistema di allarmi può rompersi.
 */
export const EVENTI_DI_GUASTO = [
  'unhandled_error',
  'errore_server',
  'write_failed',
  'credit_ledger_failed',
] as const;

/** Il nome sotto cui si registra un avviso spedito: è il segnaposto del silenzio. */
export const EVENTO_AVVISO_MANDATO = 'alert_sent';

export interface EventoRegistrato {
  eventName: string;
  createdAt: string;
  /** Il contenuto dell'evento: messaggio, operazione, percorso… */
  dettagli: Record<string, unknown> | null;
}

/**
 * La firma di un guasto: cosa lo rende «lo stesso problema» di un altro.
 *
 * Due errori che differiscono solo per un identificativo sono lo stesso
 * problema visto due volte, e vanno contati insieme. Senza questa
 * normalizzazione «batch a1b2… fallito» e «batch c3d4… fallito» sarebbero due
 * righe diverse, e un guasto che colpisce cento batch arriverebbe come cento
 * problemi distinti — cioè come rumore illeggibile.
 *
 * Si tolgono: identificativi, numeri lunghi, indirizzi, virgolette. Restano le
 * parole, che sono quello che distingue un guasto da un altro.
 */
export function firmaErrore(evento: EventoRegistrato): string {
  const d = evento.dettagli ?? {};
  const testo = [d['messaggio'], d['operazione'], d['errore'], d['origine']]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' · ');

  const nudo = (testo || evento.eventName)
    .toLowerCase()
    // Identificativi e numeri: cambiano a ogni occorrenza e non distinguono
    // niente. `\d{4,}` e non `\d{3,}` perché i codici HTTP sono di tre cifre, e
    // «ha risposto 500» e «ha risposto 404» sono due guasti diversi che
    // mandano a cercare in due posti diversi: un limite a tre cifre li
    // cancellerebbe entrambi e li farebbe arrivare come un problema solo.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '·')
    .replace(/https?:\/\/[^\s"']+/g, '·')
    .replace(/\b\d{4,}\b/g, '·')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return nudo.slice(0, 160) || evento.eventName;
}

export interface GruppoGuasti {
  firma: string;
  quante: number;
  /** L'evento più recente del gruppo: serve a datare il problema. */
  ultimo: string;
  /** Il testo da mostrare, preso dalla prima occorrenza. */
  esempio: string;
}

/** Raggruppa gli eventi per firma, dal più frequente. */
export function raggruppaGuasti(eventi: EventoRegistrato[]): GruppoGuasti[] {
  const per = new Map<string, GruppoGuasti>();
  for (const e of eventi ?? []) {
    const firma = firmaErrore(e);
    const esistente = per.get(firma);
    if (esistente) {
      esistente.quante++;
      if (e.createdAt > esistente.ultimo) esistente.ultimo = e.createdAt;
      continue;
    }
    const d = e.dettagli ?? {};
    const esempio =
      [d['messaggio'], d['operazione'], d['errore']].find(
        (x): x is string => typeof x === 'string' && x.length > 0,
      ) ?? e.eventName;
    per.set(firma, { firma, quante: 1, ultimo: e.createdAt, esempio: esempio.slice(0, 300) });
  }
  return [...per.values()].sort((a, b) => b.quante - a.quante || (a.ultimo < b.ultimo ? 1 : -1));
}

/** Quanto silenzio fra due avvisi: sotto, si accumula invece di scrivere. */
export const SILENZIO_MS = 30 * 60 * 1000;

/** Il periodo più lungo che un singolo avviso può raccontare. */
export const FINESTRA_MASSIMA_MS = 6 * 60 * 60 * 1000;

/**
 * Da quando leggere i guasti.
 *
 * Si riparte DALL'ULTIMO AVVISO e non dall'ultimo giro: fra un giro e l'altro
 * passa un minuto, ma fra un avviso e l'altro passa almeno mezz'ora di
 * silenzio, e i guasti capitati in quella mezz'ora devono comunque arrivare.
 * Leggendo solo l'ultimo minuto si perderebbero quasi tutti.
 *
 * Il tetto di sei ore serve al primo avviso in assoluto — e a quello dopo una
 * lunga pausa: senza, la prima email conterrebbe tutti i guasti mai registrati,
 * cioè un muro illeggibile su un problema che magari non esiste più.
 */
export function inizioFinestra(opzioni: {
  adesso: number;
  ultimoAvviso: number | null;
  finestraMassimaMs?: number;
}): number {
  const tetto = opzioni.adesso - (opzioni.finestraMassimaMs ?? FINESTRA_MASSIMA_MS);
  if (opzioni.ultimoAvviso === null) return tetto;
  return Math.max(tetto, opzioni.ultimoAvviso);
}

export interface DecisioneAvviso {
  avvisa: boolean;
  motivo: string;
  gruppi: GruppoGuasti[];
  /** Quanti guasti in tutto: il numero che va nell'oggetto dell'email. */
  totale: number;
}

/**
 * Se mandare l'avviso adesso.
 *
 * Il silenzio è il cuore della cosa: senza, un guasto ripetuto svuota la
 * casella di posta e il sistema di allarmi si autodistrugge. Con il silenzio,
 * quelle occorrenze si accumulano e arrivano insieme al giro successivo —
 * nessuna si perde, perché il conteggio parte da quando è stato mandato
 * l'ultimo avviso e non da quando è iniziato questo giro.
 */
export function decidiAvviso(
  eventi: EventoRegistrato[],
  opzioni: { adesso: number; ultimoAvviso: number | null; silenzioMs?: number },
): DecisioneAvviso {
  const gruppi = raggruppaGuasti(eventi);
  const totale = gruppi.reduce((n, g) => n + g.quante, 0);

  if (totale === 0) {
    return { avvisa: false, motivo: 'Nessun guasto da segnalare.', gruppi: [], totale: 0 };
  }

  const silenzio = opzioni.silenzioMs ?? SILENZIO_MS;
  if (opzioni.ultimoAvviso !== null && opzioni.adesso - opzioni.ultimoAvviso < silenzio) {
    const restano = Math.ceil((silenzio - (opzioni.adesso - opzioni.ultimoAvviso)) / 60000);
    return {
      avvisa: false,
      motivo: `Avviso già mandato da poco: si riprova fra ${restano} minuti.`,
      gruppi,
      totale,
    };
  }

  return {
    avvisa: true,
    motivo: `${totale} ${totale === 1 ? 'guasto' : 'guasti'} in ${gruppi.length} ${gruppi.length === 1 ? 'tipo' : 'tipi'}.`,
    gruppi,
    totale,
  };
}

/** L'oggetto dell'email: dice il numero e il problema principale. */
export function oggettoAvviso(d: DecisioneAvviso): string {
  const primo = d.gruppi[0];
  const testa = `Verificato: ${d.totale} ${d.totale === 1 ? 'guasto' : 'guasti'}`;
  if (!primo) return testa;
  // Il problema più frequente nell'oggetto: chi legge dal telefono deve capire
  // se aprire adesso o dopo pranzo senza aprire niente.
  return `${testa} — ${primo.esempio.slice(0, 60)}`;
}
