// ---------------------------------------------------------------------------
// Com'è andata la generazione, in una parola sola.
//
// La pagina di avanzamento aveva due soli stati: «in corso» e «conclusa», con
// la spunta VERDE sul secondo. Uno stato `failed` finiva quindi nel ramo del
// successo — titolo «Elaborazione conclusa», spunta verde — e i contatori
// dicevano «0 Falliti», perché un batch fermato in blocco non arriva a segnare
// i singoli prodotti. Un lavoro fallito aveva l'aspetto identico a un lavoro
// riuscito, e l'unico indizio era una pastiglia rossa in alto a destra.
//
// La decisione sta qui, fuori dal componente, perché è una regola e non un
// disegno: si può provare senza aprire un browser, ed è l'unico punto in cui
// «concluso» viene distinto da «riuscito».
// ---------------------------------------------------------------------------

/** Gli stati in cui il lavoro non si muove più. */
export const STATI_FINALI = new Set(['completed', 'partial_failed', 'failed']);

export type Esito = 'in-corso' | 'riuscita' | 'con-errori' | 'fallita';

export interface EsitoElaborazione {
  esito: Esito;
  /** Quello che si legge accanto all'icona. */
  titolo: string;
  finita: boolean;
}

export function esitoElaborazione(
  status: string | null | undefined,
  falliti = 0,
): EsitoElaborazione {
  if (!status || !STATI_FINALI.has(status)) {
    return { esito: 'in-corso', titolo: 'Elaborazione in corso', finita: false };
  }
  if (status === 'failed') {
    return { esito: 'fallita', titolo: 'Elaborazione non riuscita', finita: true };
  }
  // `partial_failed` conta anche quando il contatore dei falliti è a zero: lo
  // stato lo sa, il contatore no.
  if (status === 'partial_failed' || falliti > 0) {
    return {
      esito: 'con-errori',
      titolo: 'Conclusa, con errori su alcuni prodotti',
      finita: true,
    };
  }
  return { esito: 'riuscita', titolo: 'Elaborazione conclusa', finita: true };
}
