import { describe, expect, it } from 'vitest';
import { formattaPrezzo, prezzoPerCredito, partitaIvaValida, codiceSdiValido } from '../prezzi.js';

// ---------------------------------------------------------------------------
// Il prezzo e i dati per fatturarlo.
//
// Il prodotto non aveva un prezzo da nessuna parte: né sulla landing (che
// elencava «50 / 200 / 500 crediti»), né nella pagina crediti, né nella tabella
// dei pacchetti. La cifra esisteva solo dentro Stripe e si scopriva dopo essere
// stati rimbalzati sul checkout. Per un SaaS è il difetto più grave possibile:
// non si compra una cosa di cui non si sa il costo.
//
// E senza partita IVA e codice destinatario nessun cliente B2B italiano può
// comprare: la fattura elettronica non è un optional, è come funziona la
// fatturazione in Italia.
// ---------------------------------------------------------------------------

/**
 * `Intl` separa la cifra dal simbolo con uno spazio non separabile (stretto o
 * normale a seconda della versione). È giusto che lo faccia — «29,00» e «€»
 * non devono finire su righe diverse — ma qui interessa il testo, non quale
 * spazio invisibile ha scelto la libreria.
 */
const spaziNormali = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('come si scrive un prezzo', () => {
  it('usa la virgola e mette l’euro dopo, come in Italia', () => {
    // `29.00 EUR` è la forma inglese: qui si legge «29,00 €».
    expect(spaziNormali(formattaPrezzo(2900))).toBe('29,00 €');
  });

  it('non perde i centesimi', () => {
    expect(spaziNormali(formattaPrezzo(2999))).toBe('29,99 €');
    expect(spaziNormali(formattaPrezzo(5))).toBe('0,05 €');
  });

  it('scrive sempre due decimali, anche quando sono zero', () => {
    // «199 €» accanto a «29,99 €» sembra un errore di battitura.
    expect(spaziNormali(formattaPrezzo(19900))).toBe('199,00 €');
  });

  it('gestisce lo zero senza inventare', () => {
    expect(spaziNormali(formattaPrezzo(0))).toBe('0,00 €');
  });
});

describe('quanto costa una scheda', () => {
  it('divide il pacchetto per i crediti', () => {
    // È il numero che si cerca davvero confrontando due pacchetti, e che
    // nessuna delle due cifre dà da sola.
    expect(spaziNormali(prezzoPerCredito(2900, 50)!)).toBe('0,58 €');
    expect(spaziNormali(prezzoPerCredito(19900, 500)!)).toBe('0,40 €');
  });

  it('non divide per zero', () => {
    expect(prezzoPerCredito(2900, 0)).toBeNull();
    expect(prezzoPerCredito(2900, -1)).toBeNull();
  });
});

describe('partita IVA', () => {
  it('accetta una partita IVA valida', () => {
    // Esempio con controllo corretto (Luhn dispari a 11 cifre).
    expect(partitaIvaValida('00743110157')).toBe(true);
  });

  it('accetta il prefisso IT e gli spazi, come li scrive la gente', () => {
    expect(partitaIvaValida('IT00743110157')).toBe(true);
    expect(partitaIvaValida(' 007 431 101 57 ')).toBe(true);
  });

  it('rifiuta undici cifre col controllo sbagliato', () => {
    // La lunghezza giusta non basta: senza il controllo passerebbe qualunque
    // numero e la fattura tornerebbe indietro dallo SDI.
    expect(partitaIvaValida('00743110158')).toBe(false);
  });

  it('rifiuta lunghezze e caratteri sbagliati', () => {
    expect(partitaIvaValida('123')).toBe(false);
    expect(partitaIvaValida('0074311015X')).toBe(false);
    expect(partitaIvaValida('')).toBe(false);
  });
});

describe('codice destinatario SDI', () => {
  it('accetta sette caratteri alfanumerici', () => {
    expect(codiceSdiValido('ABC1234')).toBe(true);
    expect(codiceSdiValido('m5uxcr1')).toBe(true);
  });

  it('accetta 0000000, che vuol dire «non ce l’ho»', () => {
    // È il valore convenzionale: in quel caso la fattura viaggia via PEC.
    expect(codiceSdiValido('0000000')).toBe(true);
  });

  it('rifiuta lunghezze diverse da sette', () => {
    expect(codiceSdiValido('ABC123')).toBe(false);
    expect(codiceSdiValido('ABC12345')).toBe(false);
  });
});
