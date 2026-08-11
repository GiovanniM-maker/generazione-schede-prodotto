// ---------------------------------------------------------------------------
// Quando una fattura si può emettere.
//
// La regola sta qui, in un posto solo, perché la usano due lati diversi: il
// form che salva i dati e il checkout che decide se lasciar pagare. Scritte due
// volte, prima o poi divergono — e la versione più permissiva vince, incassando
// senza poter fatturare.
// ---------------------------------------------------------------------------

export interface AnagraficaFattura {
  billing_name?: string | null;
  vat_number?: string | null;
  tax_code?: string | null;
  sdi_code?: string | null;
  pec_email?: string | null;
  billing_address?: string | null;
  billing_zip?: string | null;
  billing_city?: string | null;
  billing_country?: string | null;
}

/** Abbastanza per emettere: chi sei, dove sei, e dove mandare il documento. */
export function datiFatturaCompleti(o: AnagraficaFattura | null | undefined): boolean {
  if (!o) return false;
  const italiano = (o.billing_country ?? 'IT').toUpperCase() === 'IT';
  const identificato = Boolean(o.vat_number || o.tax_code);
  // Fuori dall'Italia lo SDI non esiste: pretenderlo bloccherebbe una vendita
  // perfettamente legittima.
  const recapito = italiano ? Boolean(o.sdi_code || o.pec_email) : true;
  return Boolean(
    o.billing_name && identificato && recapito && o.billing_address && o.billing_zip && o.billing_city,
  );
}
