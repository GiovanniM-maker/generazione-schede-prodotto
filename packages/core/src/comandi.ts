// Spento non vuol dire una cosa sola.
//
// IL DIFETTO CHE RISOLVE. Nel prodotto ci sono 118 comandi con `disabled`, e
// dietro quella parola sola ci stanno tre situazioni diverse che meritano tre
// trattamenti diversi:
//
//   1. STA LAVORANDO — «Salva» premuto, la richiesta è partita. Qui spegnere è
//      giusto: un secondo clic manderebbe la stessa cosa due volte. Dura un
//      istante, e la rotella lo dice.
//
//   2. NON ANCORA — il modulo non è completo, quindi il comando è grigio. È il
//      caso più comune e il più dannoso: **un pulsante grigio non sa dire
//      perché è grigio**. Chi guarda vede un comando morto e non sa cosa
//      manchi; su telefono l'autocompilazione spesso non fa scattare la
//      validazione, quindi il modulo è GIUSTO e il comando resta spento lo
//      stesso, senza appello.
//
//   3. NON DISPONIBILE — il preset è pubblicato e non si modifica, il browser
//      non registra l'audio, non ci sono attributi da aggiungere. Qui il
//      comando resta spento davvero, ma il motivo va detto.
//
// E c'è un difetto che tutti e tre condividono, invisibile finché non si prova:
// **un elemento `disabled` non prende il fuoco**. Con la tastiera lo si salta,
// quindi non si scopre mai che esiste, e il motivo per cui è spento — anche
// quando c'è — non lo si può leggere. È il modo più efficace di nascondere una
// funzione a chi non usa il mouse.
//
// LA REGOLA. `disabled` vero solo mentre lavora, che dura un istante.
// `aria-disabled` in tutti gli altri casi: il comando resta RAGGIUNGIBILE, si
// legge, si può interrogare — semplicemente non fa niente se premuto.
//
// Funzioni PURE.

export type ModoComando = 'pronto' | 'lavora' | 'nonDisponibile';

export interface AspettoComando {
  modo: ModoComando;
  /**
   * L'attributo `disabled` vero.
   *
   * Solo mentre lavora. Toglie il fuoco e blocca gli eventi del puntatore — è
   * accettabile per il mezzo secondo di una richiesta in volo, non per uno
   * stato in cui il comando può restare tutto il tempo.
   */
  spentoDavvero: boolean;
  /**
   * `aria-disabled`: dichiarato spento ma raggiungibile.
   *
   * Si trova con Tab, si legge, e il suo motivo si può ascoltare. Premerlo non
   * fa niente — ma è un niente che si può capire, invece di un comando che non
   * si incontra proprio.
   */
  dichiaratoSpento: boolean;
  /** Il clic va ignorato: `disabled` da solo qui non basta più. */
  ignoraClic: boolean;
  /**
   * Cosa si aggiunge al nome per chi ascolta.
   *
   * Non un `aria-describedby`: la descrizione è facoltativa e molti lettori la
   * saltano. Un comando che non si può usare deve dire perché nel NOME, che
   * viene letto sempre.
   */
  aggiuntaAlNome: string;
}

function pulito(s: string | null | undefined): string {
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * Come si presenta un comando, dato quello che sta facendo e perché non si può
 * usare.
 *
 * LA PRECEDENZA CONTA: se sta lavorando, vince quello. Un comando che è partito
 * e intanto porta ancora addosso il motivo per cui prima era spento
 * racconterebbe una cosa vecchia proprio nel momento in cui ne sta succedendo
 * una nuova.
 */
export function aspettoComando(stato: {
  lavora?: boolean;
  /** Perché non si può usare. Vuoto o assente = si può. */
  motivo?: string | null;
}): AspettoComando {
  if (stato.lavora) {
    return {
      modo: 'lavora',
      spentoDavvero: true,
      dichiaratoSpento: false,
      ignoraClic: true,
      // `aria-busy` dice già che è partito qualcosa: aggiungerlo anche al nome
      // vorrebbe dire sentirlo due volte.
      aggiuntaAlNome: '',
    };
  }
  const motivo = pulito(stato.motivo);
  if (motivo !== '') {
    return {
      modo: 'nonDisponibile',
      spentoDavvero: false,
      dichiaratoSpento: true,
      ignoraClic: true,
      aggiuntaAlNome: motivo,
    };
  }
  return {
    modo: 'pronto',
    spentoDavvero: false,
    dichiaratoSpento: false,
    ignoraClic: false,
    aggiuntaAlNome: '',
  };
}

/**
 * Il motivo per cui un comando non si può ancora usare, dalle condizioni che
 * mancano.
 *
 * PERCHÉ NON BASTA UN BOOLEANO. Il difetto non è che il comando sia spento: è
 * che sia spento SENZA DIRLO. Un modulo con tre requisiti mancanti e un
 * pulsante grigio costringe a indovinare quale dei tre; nominarli costa le
 * stesse parole e risparmia il giro.
 *
 * Uno solo si nomina per esteso. Da due in su si nominano tutti, separati da
 * «e», perché la lista è corta per costruzione — se un comando ha sei
 * requisiti, il problema è il comando.
 */
export function motivoMancante(condizioni: Array<{ manca: boolean; cosa: string }>): string {
  const mancanti = (condizioni ?? [])
    .filter((c) => c && c.manca && pulito(c.cosa) !== '')
    .map((c) => pulito(c.cosa));
  if (mancanti.length === 0) return '';
  if (mancanti.length === 1) return `Serve prima: ${mancanti[0]}.`;
  const ultimo = mancanti[mancanti.length - 1]!;
  return `Serve prima: ${mancanti.slice(0, -1).join(', ')} e ${ultimo}.`;
}
