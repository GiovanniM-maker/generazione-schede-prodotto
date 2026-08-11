import { getServerEnv } from '@/lib/env.server';

// ---------------------------------------------------------------------------
// I dati del titolare nelle pagine legali.
//
// Erano segnaposto scritti nel testo — `[Ragione sociale]`, `[email di
// contatto]`, `[città]` — su pagine pubbliche che rispondono 200 e hanno tutta
// l'aria di documenti veri. Una privacy policy con le parentesi quadre dentro è
// peggio di una privacy policy assente: la seconda si nota, la prima no.
//
// Ora i dati vengono dalla configurazione. Finché mancano, le pagine lo
// **dichiarano in cima** e chiedono ai motori di ricerca di non indicizzarle.
// Non si può più spedire una bozza facendola passare per un documento.
// ---------------------------------------------------------------------------

export interface DatiTitolare {
  ragioneSociale: string | null;
  indirizzo: string | null;
  email: string | null;
  citta: string | null;
  /** Vero solo se ci sono TUTTI: mezzo documento non è un documento. */
  completo: boolean;
}

export function datiTitolare(): DatiTitolare {
  const env = getServerEnv();
  const ragioneSociale = env.LEGAL_ENTITY_NAME ?? null;
  const indirizzo = env.LEGAL_ADDRESS ?? null;
  const email = env.LEGAL_EMAIL ?? null;
  const citta = env.LEGAL_CITY ?? null;
  return {
    ragioneSociale,
    indirizzo,
    email,
    citta,
    completo: Boolean(ragioneSociale && indirizzo && email && citta),
  };
}

/**
 * Il valore, o una dicitura che si vede.
 *
 * Il ripiego non è un segnaposto travestito da testo: dice apertamente che il
 * dato non c'è, così nessuno lo scambia per il contenuto vero.
 */
export function oppureDaDefinire(valore: string | null, cosa: string): string {
  return valore ?? `— ${cosa} da indicare —`;
}
