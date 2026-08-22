// Come si dice a qualcuno che ha sbagliato a compilare.
//
// IL DIFETTO CHE RISOLVE. In tutto il prodotto gli errori di modulo sono
// riquadri in cima alla pagina. Su un modulo da sedici campi — la pagina degli
// attributi ne ha proprio sedici — un riquadro che dice «controlla i dati»
// costringe a rileggere tutto per trovare quale campo lamenta cosa.
//
// La validazione in linea da sola però non basta, ed è la cosa che si sbaglia
// quando si prova a rimediare: se il campo colpevole è fuori schermo, chi
// preme «Salva» non vede succedere niente e ripreme. Servono ENTRAMBI — il
// messaggio accanto al campo, e un sommario in cima che dice quanti sono e
// porta al primo.
//
// Funzioni PURE.

export interface ErroreCampo {
  /** L'id del controllo: serve a portarci il fuoco. */
  id: string;
  /** Come si chiama il campo per chi legge: «Prezzo», non «prezzo_unitario». */
  etichetta: string;
  messaggio: string;
}

export interface RiassuntoErrori {
  /** Quanti campi hanno un problema. */
  quanti: number;
  /** La frase del sommario. Vuota quando non c'è niente da dire. */
  titolo: string;
  /** Dove va il fuoco quando si preme il sommario. `null` se non c'è nulla. */
  primo: string | null;
  /** Gli errori nell'ordine in cui i campi stanno nella pagina. */
  campi: ErroreCampo[];
}

/**
 * Il sommario degli errori di un modulo.
 *
 * L'ORDINE È QUELLO DELLA PAGINA, non quello in cui il validatore li ha
 * trovati. Sembra un dettaglio e non lo è: chi legge «tre campi da sistemare»
 * e preme il primo si aspetta di essere portato in cima al modulo, non a metà.
 * Un elenco in ordine di validazione manda a rimbalzo su e giù.
 *
 * Il conteggio è di CAMPI e non di messaggi: un campo con due problemi resta
 * un campo. «5 errori» su tre campi fa sembrare il modulo peggio di com'è, e
 * chi lo legge non capisce quante volte dovrà fermarsi.
 */
export function riassuntoErrori(
  errori: Record<string, string | null | undefined>,
  ordine: Array<{ id: string; etichetta: string }>,
): RiassuntoErrori {
  const campi: ErroreCampo[] = [];
  for (const { id, etichetta } of ordine ?? []) {
    const messaggio = errori?.[id];
    if (typeof messaggio === 'string' && messaggio.trim() !== '') {
      campi.push({ id, etichetta, messaggio: messaggio.trim() });
    }
  }

  const quanti = campi.length;
  if (quanti === 0) return { quanti: 0, titolo: '', primo: null, campi: [] };

  // Con un campo solo si nomina: «Manca il nome del lavoro» dice già tutto e
  // rende inutile andare a cercare. Da due in su si conta, perché elencarli
  // tutti nel titolo lo renderebbe più lungo del modulo.
  const titolo =
    quanti === 1
      ? `${campi[0]!.etichetta}: ${campi[0]!.messaggio}`
      : `${quanti} campi da sistemare`;

  return { quanti, titolo, primo: campi[0]!.id, campi };
}

/**
 * Se il modulo si può inviare.
 *
 * Restituisce sempre `true` quando non ci sono errori GIÀ TROVATI, e questo è
 * il punto: il comando non si spegne per i campi che nessuno ha ancora
 * toccato. Un pulsante grigio non sa dire perché è grigio, e su telefono
 * l'autocompilazione spesso non fa scattare la validazione — il modulo è
 * giusto, il comando resta spento, e non c'è modo di capire cosa manca.
 *
 * Si valida al clic: se qualcosa non va, l'errore compare e il fuoco ci va
 * sopra.
 */
export function puoInviare(errori: Record<string, string | null | undefined>): boolean {
  return Object.values(errori ?? {}).every((m) => !m || m.trim() === '');
}

/**
 * Quando far comparire l'errore di un campo.
 *
 * Non a ogni battuta di tasto: chi scrive «gio» dentro un campo email vedrebbe
 * «indirizzo non valido» prima ancora di aver finito il nome, e la validazione
 * si trasforma in un rimprovero continuo.
 *
 * La regola che funziona ha tre tempi:
 *   - mentre si scrive per la prima volta: zitti;
 *   - uscendo dal campo: si dice;
 *   - una volta detto, si corregge mentre si scrive — così chi sta rimediando
 *     vede sparire l'errore appena ha rimediato, invece di dover uscire di
 *     nuovo dal campo per sapere se è a posto.
 */
export function mostraErrore(stato: {
  toccato: boolean;
  inviato: boolean;
  giaSbagliato: boolean;
  scrivendo: boolean;
}): boolean {
  if (stato.inviato) return true;
  if (stato.giaSbagliato) return true;
  if (stato.scrivendo) return false;
  return stato.toccato;
}
