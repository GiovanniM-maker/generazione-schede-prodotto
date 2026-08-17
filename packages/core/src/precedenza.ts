// Chi vince quando due fonti dicono cose diverse dello stesso prodotto.
//
// Con la ricerca per codice il catalogo smette di avere una fonte sola. Un
// campo può arrivare dal foglio del cliente, da una scheda tecnica, da una
// pagina che l'utente ha incollato, o da una pagina che abbiamo trovato noi
// cercando lo SKU. Non sono la stessa cosa e non possono pesare uguale: un dato
// che il cliente ha scritto nel suo gestionale vale più di uno raccolto su un
// marketplace, sempre.
//
// La regola che conta, e che qui è l'unica non negoziabile: **una fonte più
// debole non sovrascrive mai una più forte**. Riempie i buchi. E quando la
// contraddice su un campo già pieno non si scrive e non si tace — si apre un
// dubbio di conflitto, con tutti e due i valori e le loro provenienze, e decide
// l'utente. Tacere vorrebbe dire buttare via un'informazione; scrivere
// vorrebbe dire sostituire un dato del cliente con uno preso da internet.
//
// Funzioni PURE.

export type OrigineFatto =
  /** Scritto o corretto a mano dall'utente. Nessuno lo scavalca. */
  | 'manuale'
  /** Dal CSV/Excel del cliente. */
  | 'foglio'
  /** Da una scheda tecnica in PDF del cliente. */
  | 'pdf'
  /** Da un URL che l'utente ha incollato: l'ha scelto lui. */
  | 'url-utente'
  /** Da una pagina trovata cercando lo SKU, su dominio produttore o fornitore. */
  | 'ricerca-ufficiale'
  /** Da una pagina trovata cercando lo SKU, su un dominio di terza parte. */
  | 'ricerca-terza-parte'
  /** Calcolato da altri fatti. */
  | 'derivato';

/**
 * Dal più forte al più debole. Il numero più basso vince.
 *
 * L'ordine non è un'opinione sulla qualità dei siti: è una scala di quanto il
 * cliente risponde di quel dato. Del suo foglio risponde lui; di un
 * marketplace non risponde nessuno.
 */
export const FORZA_ORIGINE: Record<OrigineFatto, number> = {
  manuale: 1,
  foglio: 2,
  pdf: 3,
  'url-utente': 4,
  'ricerca-ufficiale': 5,
  'ricerca-terza-parte': 6,
  derivato: 7,
};

/** `true` se `a` batte `b`. A parità è `false`: nessuna delle due vince. */
export function piuForte(a: OrigineFatto, b: OrigineFatto): boolean {
  return FORZA_ORIGINE[a] < FORZA_ORIGINE[b];
}

export interface Fatto {
  chiave: string;
  valore: string;
  origine: OrigineFatto;
  /** La pagina esatta da cui viene, quando c'è. Va mostrata come collegamento. */
  url?: string | null;
  /** Quando è stato letto. Una pagina cambia; questa data dice quando era vero. */
  lettoIl?: string | null;
  /** Da 0 a 1, già moltiplicata per il punteggio di identità dove serve. */
  confidenza?: number | null;
}

export type EsitoUnione =
  /** Si scrive: il campo era vuoto, o arriva da una fonte più forte. */
  | { azione: 'scrivi'; fatto: Fatto; sostituito: Fatto | null; motivo: string }
  /** Non si scrive e non c'è niente da chiedere: stesso valore, o fonte più debole su campo pieno con lo stesso contenuto. */
  | { azione: 'ignora'; motivo: string }
  /** Non si scrive, e si chiede: due fonti dicono cose diverse. */
  | { azione: 'dubbio-conflitto'; esistente: Fatto; entrante: Fatto; motivo: string };

/** Due valori sono «lo stesso» se differiscono solo per spazi e maiuscole. */
export function stessoValore(a: string, b: string): boolean {
  const n = (s: string) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return n(a) === n(b);
}

const ETICHETTA: Record<OrigineFatto, string> = {
  manuale: 'inserito a mano',
  foglio: 'dal foglio',
  pdf: 'da scheda tecnica',
  'url-utente': 'da URL indicato',
  'ricerca-ufficiale': 'da ricerca, sito ufficiale',
  'ricerca-terza-parte': 'da ricerca, terza parte',
  derivato: 'derivato',
};

/**
 * Cosa fare di un fatto che arriva su un campo che forse è già pieno.
 *
 * `esistente` è `null` quando il campo è vuoto. Il caso «vuoto» non è un
 * dettaglio: è tutto l'arricchimento — la ricerca serve a riempire i buchi, e
 * su un buco anche la fonte più debole ha diritto di scrivere.
 */
export function unisciFatto(esistente: Fatto | null, entrante: Fatto): EsitoUnione {
  if (!entrante.valore || !entrante.valore.trim()) {
    return { azione: 'ignora', motivo: 'Il valore in arrivo è vuoto.' };
  }

  if (!esistente || !esistente.valore.trim()) {
    return {
      azione: 'scrivi',
      fatto: entrante,
      sostituito: null,
      motivo: 'Il campo era vuoto.',
    };
  }

  if (stessoValore(esistente.valore, entrante.valore)) {
    // Conferma, non conflitto. Non si riscrive: la provenienza più forte è
    // quella che c'era, ed è quella che deve restare a schermo.
    return { azione: 'ignora', motivo: 'Stesso valore già presente.' };
  }

  if (piuForte(entrante.origine, esistente.origine)) {
    return {
      azione: 'scrivi',
      fatto: entrante,
      sostituito: esistente,
      motivo: `Sostituito: ${ETICHETTA[entrante.origine]} batte ${ETICHETTA[esistente.origine]}.`,
    };
  }

  // Più debole, o pari forza: in nessuno dei due casi si sovrascrive, e in
  // nessuno dei due si sta zitti.
  return {
    azione: 'dubbio-conflitto',
    esistente,
    entrante,
    motivo: piuForte(esistente.origine, entrante.origine)
      ? `Valori diversi: ${ETICHETTA[esistente.origine]} contro ${ETICHETTA[entrante.origine]}. Il dato del cliente resta.`
      : `Due fonti di pari peso dicono cose diverse (${ETICHETTA[esistente.origine]} e ${ETICHETTA[entrante.origine]}).`,
  };
}

export interface EsitoUnioneScheda {
  /** I fatti come restano dopo l'unione, per chiave. */
  fatti: Map<string, Fatto>;
  /** I conflitti da mostrare all'utente. */
  conflitti: Array<{ chiave: string; esistente: Fatto; entrante: Fatto; motivo: string }>;
  /** Quanti campi vuoti sono stati riempiti: è il numero dell'arricchimento. */
  riempiti: number;
  /** Quanti campi sono stati sostituiti da una fonte più forte. */
  sostituiti: number;
}

/**
 * Unisce un blocco di fatti in arrivo con quelli già sulla scheda.
 *
 * I fatti in arrivo vengono ordinati per forza PRIMA di unirli, e non è un
 * dettaglio di comodo: senza, l'esito dipenderebbe dall'ordine in cui il motore
 * di ricerca ha restituito le pagine. Arrivando prima la terza parte e poi il
 * sito ufficiale, la prima scriverebbe sul campo vuoto e la seconda la
 * sostituirebbe; nell'ordine opposto la seconda scriverebbe e la prima
 * aprirebbe un conflitto. Stesso valore finale, due schermate diverse per
 * l'utente, decise da un ordine che nessuno controlla.
 */
export function unisciScheda(esistenti: Fatto[], entranti: Fatto[]): EsitoUnioneScheda {
  const fatti = new Map<string, Fatto>();
  for (const f of esistenti) if (f.valore.trim()) fatti.set(f.chiave, f);

  const conflitti: EsitoUnioneScheda['conflitti'] = [];
  let riempiti = 0;
  let sostituiti = 0;

  const inOrdine = [...entranti].sort((a, b) => FORZA_ORIGINE[a.origine] - FORZA_ORIGINE[b.origine]);
  for (const entrante of inOrdine) {
    const esito = unisciFatto(fatti.get(entrante.chiave) ?? null, entrante);
    if (esito.azione === 'scrivi') {
      if (esito.sostituito) sostituiti++;
      else riempiti++;
      fatti.set(entrante.chiave, esito.fatto);
    } else if (esito.azione === 'dubbio-conflitto') {
      conflitti.push({
        chiave: entrante.chiave,
        esistente: esito.esistente,
        entrante: esito.entrante,
        motivo: esito.motivo,
      });
    }
  }

  return { fatti, conflitti, riempiti, sostituiti };
}
