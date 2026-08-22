// Le regole dell'interfaccia che si possono provare senza un browser.
//
// PERCHÉ ESISTE QUESTO FILE
//
// I componenti dell'interfaccia sono la parte del prodotto meno provata, e non
// per pigrizia: provare un componente React vuol dire montare un DOM finto, e
// quello che si finisce per provare è quasi sempre il DOM finto. Ma dentro ogni
// componente ci sono due o tre DECISIONI vere — quale elemento riceve il fuoco,
// quale attributo collega l'errore al campo, quando un riscontro va tolto — e
// quelle sono funzioni pure travestite da interfaccia.
//
// Qui stanno quelle. Il componente resta un guscio che le chiama, e le regole
// si provano esaustivamente con dei numeri.
//
// Funzioni PURE.

// ---------------------------------------------------------------------------
// L'anello del fuoco
// ---------------------------------------------------------------------------

/**
 * Chi riceve il fuoco premendo Tab dentro una finestra sovrapposta.
 *
 * IL DIFETTO CHE RISOLVE: tre overlay su quattro, in questo prodotto, non
 * trattengono il fuoco. Premendo Tab si esce dal pannello e si finisce a
 * navigare la pagina sottostante — che nel frattempo è coperta da un velo e
 * non si può usare. Chi non vede lo schermo si ritrova a leggere qualcosa che
 * per tutti gli altri non c'è più.
 *
 * La regola è un anello: dall'ultimo si torna al primo, dal primo si va
 * all'ultimo. Sembra banale e ha tre casi che si sbagliano sempre —
 * l'elemento attivo FUORI dal gruppo (succede appena la finestra si apre),
 * il gruppo vuoto, e il gruppo con un solo elemento.
 *
 * @param totale quanti elementi possono ricevere il fuoco
 * @param attivo indice di quello che ce l'ha adesso, `-1` se è fuori
 * @param indietro `true` con Maiusc premuto
 * @returns l'indice da mettere a fuoco, oppure `null` se non c'è niente da fare
 */
export function prossimoFuoco(
  totale: number,
  attivo: number,
  indietro: boolean,
): number | null {
  if (!Number.isFinite(totale) || totale <= 0) return null;
  const ultimo = totale - 1;

  // Il fuoco è fuori dal gruppo: succede all'apertura, e succede se qualcuno
  // clicca sulla pagina coperta. Si rientra dal capo giusto.
  if (attivo < 0 || attivo > ultimo) return indietro ? ultimo : 0;

  if (indietro) return attivo === 0 ? ultimo : attivo - 1;
  return attivo === ultimo ? 0 : attivo + 1;
}

/**
 * Se il browser farebbe già la cosa giusta da solo.
 *
 * Con più di un elemento, andare dal secondo al terzo è esattamente quello che
 * fa Tab senza che nessuno intervenga: chiamare `preventDefault` lì è lavoro
 * sprecato e, peggio, rompe le scorciatoie di chi usa una tastiera braille.
 * Si interviene SOLO ai due capi dell'anello.
 */
export function serveIntervenire(totale: number, attivo: number, indietro: boolean): boolean {
  if (totale <= 0) return true; // niente da mettere a fuoco: si blocca e basta
  if (attivo < 0 || attivo > totale - 1) return true;
  return indietro ? attivo === 0 : attivo === totale - 1;
}

// ---------------------------------------------------------------------------
// Il movimento
// ---------------------------------------------------------------------------

/**
 * I tempi, in millisecondi.
 *
 * Non sono gusto. Sotto i 100 ms un cambio di colore non si vede — si vede il
 * risultato e basta — e sopra i 150 si SENTE, cioè l'interfaccia comincia a
 * sembrare lenta invece che animata. L'uscita è sempre più corta dell'entrata
 * per una ragione precisa: chi apre sta scoprendo qualcosa e vale la pena
 * accompagnarlo, chi chiude ha già deciso e ogni millisecondo è un intralcio.
 */
export const DURATE = {
  /** Colore, sfondo, bordo. */
  rapida: 120,
  /** Pressione di un comando: giù svelto, su un po' meno. */
  pressione: 60,
  /** Comparsa di riscontri e pannelli. */
  entrata: 180,
  /** Scomparsa: sempre più corta dell'entrata. */
  uscita: 120,
  /** Il foglio che sale dal basso: più lungo perché percorre più strada. */
  foglio: 260,
} as const;

/**
 * Le curve.
 *
 * `uscita` parte veloce e frena: è come si muove una cosa che arriva.
 * `entrata` fa il contrario, ed è giusta per una cosa che se ne va.
 * `foglio` è quasi tutta frenata, e serve a far sembrare che il pannello abbia
 * un peso — è l'unico punto del prodotto in cui vale la pena simulare la fisica.
 */
export const CURVE = {
  uscita: 'cubic-bezier(.2,.8,.2,1)',
  entrata: 'cubic-bezier(.4,0,1,1)',
  foglio: 'cubic-bezier(.32,.72,0,1)',
} as const;

/** Oltre questa velocità il foglio si chiude comunque, anche se trascinato poco. */
export const VELOCITA_CHIUSURA_PX_S = 500;
/** Sotto questa frazione dell'altezza, il foglio torna su. */
export const FRAZIONE_CHIUSURA = 0.45;

/**
 * Se un foglio trascinato col dito deve chiudersi o tornare su.
 *
 * Due strade e non una: il TRASCINAMENTO LUNGO (l'ho portato giù per metà,
 * evidentemente lo voglio chiudere) e il LANCIO VELOCE (l'ho appena sfiorato,
 * ma di scatto). Con la sola soglia di distanza, un colpetto rapido verso il
 * basso — che è il gesto naturale per chiudere — non farebbe niente, e si
 * finirebbe a trascinare mezzo schermo ogni volta.
 */
export function chiudeIlFoglio(opzioni: {
  spostamentoPx: number;
  altezzaPx: number;
  durataMs: number;
}): boolean {
  const { spostamentoPx, altezzaPx, durataMs } = opzioni;
  if (spostamentoPx <= 0) return false;
  const velocita = (spostamentoPx / Math.max(1, durataMs)) * 1000;
  if (velocita > VELOCITA_CHIUSURA_PX_S) return true;
  return spostamentoPx > Math.max(1, altezzaPx) * FRAZIONE_CHIUSURA;
}

// ---------------------------------------------------------------------------
// Il cablaggio di un campo
// ---------------------------------------------------------------------------

export interface AttributiCampo {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
  'aria-required'?: true;
}

export interface DescrizioneCampo {
  /** Gli attributi da mettere sul controllo. */
  controllo: AttributiCampo;
  /** L'id del paragrafo d'aiuto, quando va disegnato. */
  idAiuto: string | null;
  /** L'id del messaggio d'errore, quando va disegnato. */
  idErrore: string | null;
}

/**
 * Come si collegano etichetta, aiuto ed errore a un campo.
 *
 * IL DIFETTO CHE RISOLVE: in tutto il prodotto `aria-invalid` compare **zero
 * volte**, e `aria-describedby` nemmeno. Gli errori sono riquadri in cima alla
 * pagina: su un modulo lungo dicono «qualcosa non va» senza dire DOVE, e chi
 * usa un lettore di schermo non ha alcun legame fra il messaggio e il campo che
 * lo ha causato.
 *
 * La regola sottile è l'ORDINE di `aria-describedby`: quando ci sono sia
 * l'aiuto sia l'errore, l'errore va PRIMA. Il lettore di schermo li legge
 * nell'ordine scritto, e chi ha appena sbagliato vuole sapere cosa è andato
 * storto prima di risentirsi spiegare come si compila il campo.
 *
 * L'altra: con l'errore presente, l'aiuto NON sparisce. Toglierlo è la
 * tentazione naturale — fa spazio — ma è proprio nel momento dell'errore che
 * l'istruzione serve.
 */
export function descriviCampo(opzioni: {
  id: string;
  aiuto?: string | null;
  errore?: string | null;
  obbligatorio?: boolean;
}): DescrizioneCampo {
  const { id } = opzioni;
  const haAiuto = Boolean(opzioni.aiuto);
  const haErrore = Boolean(opzioni.errore);
  const idAiuto = haAiuto ? `${id}-aiuto` : null;
  const idErrore = haErrore ? `${id}-errore` : null;

  // L'errore per primo: è quello che serve adesso.
  const descritto = [idErrore, idAiuto].filter((x): x is string => x !== null);

  const controllo: AttributiCampo = { id };
  if (haErrore) controllo['aria-invalid'] = true;
  if (descritto.length > 0) controllo['aria-describedby'] = descritto.join(' ');
  if (opzioni.obbligatorio) controllo['aria-required'] = true;

  return { controllo, idAiuto, idErrore };
}

// ---------------------------------------------------------------------------
// I riscontri transitori
// ---------------------------------------------------------------------------

export type TonoRiscontro = 'riuscito' | 'errore' | 'attenzione' | 'informazione';

export interface Riscontro {
  id: string;
  tono: TonoRiscontro;
  titolo: string;
  testo?: string;
  /** Quanto resta a schermo. `null` = finché non lo si chiude. */
  durataMs: number | null;
  /** Vero quando porta un «Annulla»: allora vive più a lungo. */
  annullabile?: boolean;
}

/** Più di così diventano un muro: i più vecchi escono da soli. */
export const MAX_RISCONTRI = 3;
/** Quanto resta un riscontro normale. */
export const DURATA_RISCONTRO_MS = 5_000;
/** Quanto resta un riscontro con «Annulla»: il tempo di accorgersene e reagire. */
export const DURATA_ANNULLABILE_MS = 10_000;

/**
 * Quanto deve restare a schermo un riscontro.
 *
 * Chi ha un «Annulla» resta il doppio, e non è generosità: è che l'utilità di
 * quel pulsante è tutta nel tempo in cui esiste. Cinque secondi bastano a
 * leggere «3 schede accettate»; non bastano a leggerlo, accorgersi che erano
 * quelle sbagliate, e trovare il pulsante.
 *
 * Gli errori NON scadono. Un errore che sparisce da solo è un errore che
 * qualcuno non ha letto, e siccome era l'unico posto in cui era scritto, da
 * quel momento non esiste più.
 */
export function durataDi(r: { tono: TonoRiscontro; annullabile?: boolean }): number | null {
  if (r.tono === 'errore') return null;
  return r.annullabile ? DURATA_ANNULLABILE_MS : DURATA_RISCONTRO_MS;
}

/**
 * Aggiunge un riscontro alla pila, tenendola corta.
 *
 * Escono i più VECCHI, non i più nuovi: quello appena comparso è la risposta
 * all'ultima cosa che si è fatta, ed è l'unico che si stava aspettando.
 *
 * Gli errori però non si buttano per fare spazio. Se la pila è piena di errori
 * si sfora il limite: tre errori sullo schermo sono brutti, ma un errore
 * cancellato da un messaggio di successo è peggio — sparisce l'unica traccia
 * di una cosa che non è andata.
 */
export function aggiungiRiscontro(pila: Riscontro[], nuovo: Riscontro): Riscontro[] {
  const insieme = [...(pila ?? []), nuovo];
  if (insieme.length <= MAX_RISCONTRI) return insieme;

  const daTogliere = insieme.length - MAX_RISCONTRI;
  const tolti: number[] = [];
  for (let i = 0; i < insieme.length && tolti.length < daTogliere; i++) {
    // Il nuovo non si tocca mai, e nemmeno gli errori.
    if (insieme[i]!.id === nuovo.id) continue;
    if (insieme[i]!.tono === 'errore') continue;
    tolti.push(i);
  }
  return insieme.filter((_, i) => !tolti.includes(i));
}
