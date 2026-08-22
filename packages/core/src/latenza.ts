// Quanto è lontano il database, letto da un pugno di misure.
//
// Funzioni PURE: entrano dei millisecondi, esce un giudizio.
//
// Sta qui e non nella sonda perché è l'unica parte che decide qualcosa, ed è
// anche l'unica che si può sbagliare in modo silenzioso: un riassunto che
// prende la misura sbagliata fa concludere «siamo lontani» a chi è vicino, e
// manda a spostare un servizio che stava benissimo dov'era.

export interface RiassuntoMisure {
  /** La misura più bassa: la stima più pulita della sola distanza. */
  minimo: number;
  mediana: number;
  /** Il primo giro, tenuto a parte perché non è confrontabile con gli altri. */
  primo: number;
  giri: number[];
}

/**
 * Il riassunto di più giri, con il primo tenuto fuori dal conto.
 *
 * IL PRIMO GIRO NON VALE. Paga l'apertura della connessione — DNS, TLS,
 * autenticazione del pooler — che le richieste successive non pagano più.
 * Includerlo gonfia il risultato di decine di millisecondi, e siccome il
 * numero serve proprio a distinguere «due millisecondi» da «ottanta», sarebbe
 * l'errore che rovina la misura.
 *
 * Si riporta il MINIMO e non la media: ogni giro può prendersi un ritardo
 * casuale (il vicino di casa sulla stessa macchina, un picco di rete), e quei
 * ritardi si sommano solo verso l'alto. Il giro più veloce è quello in cui non
 * è successo niente di strano, ed è quello che dice la distanza vera.
 */
export function riassumiMisure(giri: number[]): RiassuntoMisure {
  const puliti = (giri ?? []).filter((n) => Number.isFinite(n) && n >= 0);
  if (puliti.length === 0) return { minimo: 0, mediana: 0, primo: 0, giri: [] };

  const primo = puliti[0]!;
  // Con un giro solo non c'è niente da scartare: è tutto quello che si ha.
  const daContare = puliti.length > 1 ? puliti.slice(1) : puliti;
  const ordinati = [...daContare].sort((a, b) => a - b);
  const meta = Math.floor(ordinati.length / 2);
  const mediana =
    ordinati.length % 2 === 0
      ? Math.round(((ordinati[meta - 1] ?? 0) + (ordinati[meta] ?? 0)) / 2)
      : (ordinati[meta] ?? 0);

  return { minimo: ordinati[0] ?? 0, mediana, primo, giri: puliti };
}

export type Distanza = 'vicino' | 'stesso-continente' | 'lontano';

/** Sotto questo, il database è nello stesso data center. */
export const SOGLIA_VICINO_MS = 10;
/** Sopra questo, c'è di mezzo un oceano. */
export const SOGLIA_LONTANO_MS = 40;

export interface Giudizio {
  distanza: Distanza;
  titolo: string;
  spiegazione: string;
}

/**
 * Da quanti millisecondi costa un viaggio a cosa conviene fare.
 *
 * Le tre fasce non sono arbitrarie: dentro lo stesso data center una richiesta
 * torna in pochi millisecondi; fra due città europee sono venti o trenta; fra
 * due continenti non si scende sotto i settanta, perché è la luce che ci mette
 * quel tempo a fare il giro. Non è un problema che si risolve ottimizzando.
 */
export function giudicaDistanza(minimoMs: number): Giudizio {
  if (minimoMs < SOGLIA_VICINO_MS) {
    return {
      distanza: 'vicino',
      titolo: 'Il database è vicino',
      spiegazione:
        'Le funzioni girano accanto al database. Spostare la regione non serve: se l’applicazione sembra lenta, la causa è altrove — quante richieste fa, non quanto sono lunghe.',
    };
  }
  if (minimoMs < SOGLIA_LONTANO_MS) {
    return {
      distanza: 'stesso-continente',
      titolo: 'Vicini, ma non nello stesso posto',
      spiegazione:
        'Distanza da due città europee. Si può guadagnare qualcosa allineando le regioni, ma non è il problema principale: conviene prima ridurre il numero di richieste.',
    };
  }
  return {
    distanza: 'lontano',
    titolo: 'Il database è dall’altra parte dell’oceano',
    spiegazione:
      'Ogni singola richiesta paga questo tempo, e una pagina ne fa da sei a nove in fila. Allineare la regione delle funzioni a quella del database è l’intervento che rende più di tutti gli altri messi insieme.',
  };
}
