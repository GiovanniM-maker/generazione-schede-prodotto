// Il suggerimento: dove si mette, quando compare, e come si chiama la cosa che
// lo porta.
//
// IL DIFETTO CHE RISOLVE. Nel prodotto ci sono ventisei attributi `title` nativi
// del browser. Su un dito NON COMPAIONO MAI: non esiste il passaggio del
// puntatore. Venti di questi stanno su comandi fatti di sola icona — «Rinomina»,
// «Duplica», «Archivia», «Sposta su», «Elimina batch» — dove il `title` non è un
// di più, è L'UNICO NOME che quel comando abbia. Su telefono quindi restano
// icone mute, e chi usa un lettore di schermo sente «pulsante» e basta, perché
// diversi lettori il `title` non lo annunciano affatto.
//
// Gli altri sei sono spiegazioni («se spento, l'attributo non viene estratto»)
// nascoste dietro un passaggio del mouse che nessuno sa di dover fare.
//
// Qui sta la parte che si può provare senza montare un browser: DOVE va il
// riquadro, QUANDO si apre, e — la decisione che si sbaglia sempre — se il testo
// diventa il nome del comando o solo la sua descrizione.
//
// Funzioni PURE.

export type Lato = 'sopra' | 'sotto' | 'sinistra' | 'destra';

export interface Riquadro {
  x: number;
  y: number;
  larghezza: number;
  altezza: number;
}

export interface Misura {
  larghezza: number;
  altezza: number;
}

export interface Vista {
  larghezza: number;
  altezza: number;
}

/** Quanto il riquadro sta staccato dall'ancora. */
export const DISTANZA_PX = 8;
/** Quanto resta libero ai bordi della vista. */
export const MARGINE_PX = 8;
/** La larghezza della punta. */
export const FRECCIA_PX = 10;
/** Il raggio degli angoli: la punta non ci può finire dentro. */
export const RAGGIO_PX = 8;

/**
 * L'attesa prima di aprire col puntatore.
 *
 * Senza attesa, attraversare una barra di sei icone accende sei riquadri uno
 * dopo l'altro: il puntatore diventa una torcia che illumina rumore. Con
 * un'attesa il riquadro compare solo dove ci si è fermati davvero.
 */
export const RITARDO_APERTURA_MS = 400;

/**
 * L'attesa prima di chiudere.
 *
 * Serve a due cose: attraversare lo spazio vuoto fra l'ancora e il riquadro
 * senza farlo sparire, e non far lampeggiare niente quando il puntatore
 * scivola di un pixel fuori dall'icona.
 */
export const RITARDO_CHIUSURA_MS = 120;

/**
 * Quanto dura l'eco.
 *
 * Aperto un riquadro, per un po' i vicini si aprono SUBITO. È la regola che
 * rende una barra di icone leggibile: la prima costa quattro decimi, le altre
 * cinque no. Senza, confrontare due comandi accanto è un'attesa a ogni passo.
 */
export const ECO_MS = 800;

export type MotivoApertura = 'puntatore' | 'fuoco' | 'tocco';

/**
 * Quanto si aspetta prima di far comparire il riquadro.
 *
 * Col fuoco e col tocco NON si aspetta: lì l'intenzione è già dichiarata — si è
 * premuto Tab fin lì, o ci si è appoggiato un dito. L'attesa serve solo al
 * puntatore, che attraversa le cose senza volerlo.
 */
export function ritardoApertura(stato: {
  motivo: MotivoApertura;
  /** Da quanto è chiuso l'ultimo riquadro. `null` se non ce n'è mai stato uno. */
  msDallUltimaChiusura: number | null;
}): number {
  if (stato.motivo !== 'puntatore') return 0;
  const eco = stato.msDallUltimaChiusura;
  if (eco !== null && eco >= 0 && eco < ECO_MS) return 0;
  return RITARDO_APERTURA_MS;
}

export interface Collocazione {
  x: number;
  y: number;
  lato: Lato;
  /** Dove sta la punta, misurata dal bordo del riquadro sul lato lungo. */
  freccia: number;
}

const OPPOSTO: Record<Lato, Lato> = {
  sopra: 'sotto',
  sotto: 'sopra',
  sinistra: 'destra',
  destra: 'sinistra',
};

const VERTICALE = (l: Lato) => l === 'sopra' || l === 'sotto';

/** Lo spazio libero da quel lato dell'ancora, margine già tolto. */
function spazio(lato: Lato, ancora: Riquadro, vista: Vista, margine: number): number {
  switch (lato) {
    case 'sopra':
      return ancora.y - margine;
    case 'sotto':
      return vista.altezza - (ancora.y + ancora.altezza) - margine;
    case 'sinistra':
      return ancora.x - margine;
    case 'destra':
      return vista.larghezza - (ancora.x + ancora.larghezza) - margine;
  }
}

function stretto(v: number, min: number, max: number): number {
  // Quando lo spazio non basta, `max` finisce sotto `min`: allora vince `min`,
  // cioè si sborda dal lato dove sbordare fa meno danno (in alto e a sinistra il
  // contenuto è già stato letto).
  return Math.max(min, Math.min(v, max));
}

/**
 * Dove va il riquadro.
 *
 * LA REGOLA DEL RIBALTAMENTO, che è il motivo per cui questa funzione esiste.
 * Il lato preferito si usa solo se ci sta. Se non ci sta si prova l'OPPOSTO —
 * non uno qualsiasi: un riquadro che doveva stare sotto e compare a destra è
 * disorientante quanto uno che esce dallo schermo. Solo se non ci sta nemmeno
 * l'opposto si guarda altrove, e allora si sceglie il lato con più spazio.
 *
 * È il caso della riga di una tabella in fondo alla pagina: il suggerimento
 * preferisce stare sotto, sotto non c'è niente, e senza ribaltamento finirebbe
 * tagliato fuori dalla vista — cioè esattamente dove non lo si può leggere.
 */
export function collocaSuggerimento(opts: {
  ancora: Riquadro;
  suggerimento: Misura;
  vista: Vista;
  lato?: Lato;
  distanza?: number;
  margine?: number;
}): Collocazione {
  const distanza = opts.distanza ?? DISTANZA_PX;
  const margine = opts.margine ?? MARGINE_PX;
  const { ancora, vista } = opts;
  const s = opts.suggerimento;
  const preferito = opts.lato ?? 'sopra';

  const serve = (l: Lato) => (VERTICALE(l) ? s.altezza : s.larghezza) + distanza;
  const ci_sta = (l: Lato) => spazio(l, ancora, vista, margine) >= serve(l);

  let lato: Lato;
  if (ci_sta(preferito)) lato = preferito;
  else if (ci_sta(OPPOSTO[preferito])) lato = OPPOSTO[preferito];
  else {
    const tutti: Lato[] = ['sopra', 'sotto', 'sinistra', 'destra'];
    lato = tutti.reduce((migliore, l) =>
      spazio(l, ancora, vista, margine) - serve(l) >
      spazio(migliore, ancora, vista, margine) - serve(migliore)
        ? l
        : migliore,
    );
  }

  let x: number;
  let y: number;
  if (VERTICALE(lato)) {
    y = lato === 'sopra' ? ancora.y - distanza - s.altezza : ancora.y + ancora.altezza + distanza;
    x = stretto(
      ancora.x + ancora.larghezza / 2 - s.larghezza / 2,
      margine,
      vista.larghezza - margine - s.larghezza,
    );
  } else {
    x = lato === 'sinistra' ? ancora.x - distanza - s.larghezza : ancora.x + ancora.larghezza + distanza;
    y = stretto(
      ancora.y + ancora.altezza / 2 - s.altezza / 2,
      margine,
      vista.altezza - margine - s.altezza,
    );
  }

  // La punta insegue il centro dell'ancora, non il centro del riquadro: quando
  // il riquadro è stato spinto contro un bordo i due non coincidono più, e una
  // punta ferma al centro indicherebbe la cosa sbagliata. Non può però entrare
  // negli angoli arrotondati, dove sporgerebbe da un bordo curvo.
  const lungo = VERTICALE(lato) ? s.larghezza : s.altezza;
  const centro = VERTICALE(lato)
    ? ancora.x + ancora.larghezza / 2 - x
    : ancora.y + ancora.altezza / 2 - y;
  const bordo = RAGGIO_PX + FRECCIA_PX / 2;
  const freccia = lungo <= bordo * 2 ? lungo / 2 : stretto(centro, bordo, lungo - bordo);

  return { x, y, lato, freccia };
}

export type RuoloSuggerimento = 'nome' | 'descrizione';

export interface LegameSuggerimento {
  ruolo: RuoloSuggerimento;
  /** Gli attributi da mettere sull'ancora. */
  ancora: { 'aria-label'?: string; 'aria-describedby'?: string };
  /**
   * Serve una copia del testo sempre presente nel documento e invisibile.
   *
   * `aria-describedby` che punta a un elemento montato solo mentre il riquadro è
   * aperto è puntare al nulla per il 99% del tempo: il lettore di schermo cerca
   * quell'id quando arriva sul comando, non quando il puntatore ci passa sopra —
   * e col puntatore non ci passa mai.
   */
  copiaPerLettori: boolean;
  /** Il riquadro visibile è solo per gli occhi: il testo è già annunciato. */
  riquadroNascostoAiLettori: true;
  /** Il riquadro si apre anche al tocco. */
  apreAlTocco: boolean;
}

function normalizza(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Se un nome accessibile è ammesso su un comando che mostra già del testo.
 *
 * LA REGOLA CHE SI SBAGLIA SEMPRE. Su un pulsante che a schermo dice «Duplica»,
 * scrivere `aria-label="Duplica per personalizzare"` non aggiunge niente: lo
 * SOSTITUISCE. Chi comanda a voce dice quello che legge — «premi Duplica» — e da
 * quel momento non funziona più, perché il nome vero è diventato un altro.
 *
 * Il nome può allungare il testo visibile, mai contraddirlo: deve contenerlo.
 */
export function nomeAmmesso(testoVisibile: string, nome: string): boolean {
  const visibile = normalizza(testoVisibile);
  if (visibile === '') return true;
  return normalizza(nome).includes(visibile);
}

/**
 * Che ruolo ha il testo del suggerimento, e come si lega all'ancora.
 *
 * Due casi diversi che sembrano uno solo:
 *
 *   - l'ancora NON parla (un'icona sola): il testo è il suo NOME. Va in
 *     `aria-label`, dove sta sempre — non solo mentre il riquadro è aperto.
 *   - l'ancora parla già («Obbligatorio», «Duplica»): il testo è una
 *     DESCRIZIONE. Va in `aria-describedby`, e il nome visibile resta il nome.
 *
 * Scambiarli è il difetto vero: un `aria-label` messo sopra un pulsante che ha
 * già la sua etichetta la cancella per chi non vede e per chi comanda a voce.
 */
export function legaSuggerimento(opts: {
  id: string;
  testo: string;
  /** L'ancora ha già del testo che si legge a schermo? */
  ancoraParlante: boolean;
}): LegameSuggerimento {
  const ruolo: RuoloSuggerimento = opts.ancoraParlante ? 'descrizione' : 'nome';
  if (ruolo === 'nome') {
    return {
      ruolo,
      ancora: { 'aria-label': opts.testo },
      copiaPerLettori: false,
      riquadroNascostoAiLettori: true,
      // Sull'icona sola il tocco fa già la sua azione: aprire anche un riquadro
      // vorrebbe dire mostrare il nome di una cosa che è appena successa.
      apreAlTocco: false,
    };
  }
  return {
    ruolo,
    ancora: { 'aria-describedby': opts.id },
    copiaPerLettori: true,
    riquadroNascostoAiLettori: true,
    apreAlTocco: true,
  };
}
