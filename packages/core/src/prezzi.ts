// ---------------------------------------------------------------------------
// Il prezzo, scritto come lo si legge.
//
// I centesimi stanno nel database (gli euro in virgola mobile prima o poi fanno
// sparire un centesimo) e diventano testo solo qui: un posto solo, così
// «29,00 €» non diventa «29.00 EUR» in una pagina e «€29» in un'altra.
// ---------------------------------------------------------------------------

/** Formatta un importo in centesimi come lo scriverebbe un italiano. */
export function formattaPrezzo(centesimi: number, valuta = 'EUR'): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: valuta,
    minimumFractionDigits: 2,
  }).format(centesimi / 100);
}

/**
 * Quanto costa una singola scheda, per far capire il valore del pacchetto.
 *
 * È il numero che l'utente cerca davvero quando confronta due pacchetti, e che
 * nessuna delle due cifre gli dà da sola.
 */
export function prezzoPerCredito(centesimi: number, crediti: number, valuta = 'EUR'): string | null {
  if (crediti <= 0) return null;
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: valuta,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centesimi / 100 / crediti);
}

/** Partita IVA italiana: 11 cifre, con il controllo finale di Luhn dispari. */
export function partitaIvaValida(valore: string): boolean {
  const v = valore.replace(/\s/g, '').replace(/^IT/i, '');
  if (!/^\d{11}$/.test(v)) return false;
  let somma = 0;
  for (let i = 0; i < 11; i++) {
    let n = Number(v[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somma += n;
  }
  return somma % 10 === 0;
}

/**
 * Codice destinatario SDI: 7 caratteri alfanumerici.
 *
 * `0000000` è il valore convenzionale per «non ce l'ho»: in quel caso la
 * fattura viaggia via PEC, quindi la PEC diventa obbligatoria.
 */
export function codiceSdiValido(valore: string): boolean {
  return /^[A-Z0-9]{7}$/i.test(valore.trim());
}
