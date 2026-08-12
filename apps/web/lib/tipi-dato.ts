// ---------------------------------------------------------------------------
// Come si chiamano, in italiano, i tipi di dato di un attributo.
//
// Erano scritti in tre posti e in tre modi. Il pannello del copilota diceva
// «testo lungo», l'onboarding «Testo lungo» — maiuscola diversa, stessa cosa —
// e tutto il resto dell'interfaccia non traduceva affatto: nella colonna
// «Dato» degli attributi, nel dettaglio di un preset, in quello di una
// categoria e nella scheda di un attributo si leggeva `long_text`,
// `multi_enum`, `measurement`.
//
// Non è un dettaglio di stile: `multi_enum` non vuol dire niente per chi sta
// configurando un catalogo di conserve, e nel menu a tendina di creazione era
// **l'unica cosa scritta** — si sceglieva un tipo di dato leggendo un
// identificatore di database.
//
// Un posto solo, quindi. E l'elenco dei tipi si ricava da qui: prima la
// tendina aveva la sua lista, che poteva restare indietro rispetto alle
// etichette senza che nessuno se ne accorgesse.
// ---------------------------------------------------------------------------

export const ETICHETTE_TIPO_DATO: Record<string, string> = {
  text: 'Testo',
  long_text: 'Testo lungo',
  integer: 'Numero intero',
  decimal: 'Numero decimale',
  number: 'Numero',
  boolean: 'Sì / No',
  date: 'Data',
  enum: 'Elenco',
  multi_enum: 'Elenco multiplo',
  measurement: 'Misura',
  percentage: 'Percentuale',
  currency: 'Valuta',
  json: 'Dati strutturati',
};

/**
 * L'etichetta di un tipo, o il valore grezzo se è un tipo che non conosciamo.
 *
 * Il ripiego è voluto: se il database guadagna un tipo nuovo, meglio vedere
 * `qualcosa_di_nuovo` che una casella vuota — almeno si capisce cosa manca.
 */
export function etichettaTipoDato(tipo: string | null | undefined): string {
  if (!tipo) return '—';
  return ETICHETTE_TIPO_DATO[tipo] ?? tipo;
}

/** I tipi selezionabili, nell'ordine in cui ha senso leggerli. */
export const TIPI_DATO = Object.keys(ETICHETTE_TIPO_DATO).filter((t) => t !== 'number');
