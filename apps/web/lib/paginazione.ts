// ---------------------------------------------------------------------------
// Quale fetta di elenco si sta guardando.
//
// L'aritmetica è banale finché l'elenco non cambia sotto i piedi — e qui cambia
// di continuo, perché sopra c'è un filtro e una ricerca. Restare a «pagina 4»
// di un elenco che nel frattempo ne ha due vuol dire mostrare il vuoto e far
// credere che non ci sia niente.
// ---------------------------------------------------------------------------

export interface Fetta {
  /** Pagina effettivamente mostrata, già riportata dentro i limiti. */
  pagina: number;
  pagine: number;
  da: number;
  a: number;
  /** Numero della prima scheda mostrata, contando da 1 (per il testo). */
  primo: number;
  /** Numero dell'ultima scheda mostrata, contando da 1. */
  ultimo: number;
}

export function fettaDiPagina(totale: number, perPagina: number, pagina: number): Fetta {
  // Una pagina c'è sempre, anche quando l'elenco è vuoto: «0 di 0» non si legge.
  const pagine = Math.max(1, Math.ceil(totale / perPagina));
  const p = Math.min(Math.max(0, pagina), pagine - 1);
  const da = p * perPagina;
  const a = Math.min(da + perPagina, totale);
  return {
    pagina: p,
    pagine,
    da,
    a,
    primo: totale === 0 ? 0 : da + 1,
    ultimo: a,
  };
}
