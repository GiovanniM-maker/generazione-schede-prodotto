import { describe, expect, it } from 'vitest';
import {
  SOGLIA_LONTANO_MS,
  SOGLIA_VICINO_MS,
  giudicaDistanza,
  riassumiMisure,
} from '../latenza.js';

// ---------------------------------------------------------------------------
// La sonda che misura quanto è lontano il database.
//
// Il numero che esce da qui decide se spostare un servizio in produzione. Le
// due cose che possono andare storte in silenzio:
//
//   - contare il primo giro, che paga l'apertura della connessione e vale
//     decine di millisecondi in più: farebbe concludere «siamo lontani» a chi
//     è vicinissimo, e spostare una regione che stava benissimo dov'era;
//   - fare la media invece del minimo: un solo giro rallentato da un vicino di
//     casa sposta la media e non sposta il minimo.
// ---------------------------------------------------------------------------

describe('il riassunto delle misure', () => {
  it('scarta il primo giro, che paga l’apertura della connessione', () => {
    // Caso vero: prima chiamata 95 ms (DNS + TLS + pooler), poi 2 ms.
    // Chi include il primo conclude «oceano» stando nello stesso armadio.
    const r = riassumiMisure([95, 2, 3, 2]);
    expect(r.minimo).toBe(2);
    expect(r.primo).toBe(95);
    expect(giudicaDistanza(r.minimo).distanza).toBe('vicino');
  });

  it('riporta il minimo, non la media', () => {
    // Un giro rallentato non deve spostare il verdetto: i ritardi casuali si
    // sommano solo verso l'alto, quindi il giro più veloce è quello onesto.
    const r = riassumiMisure([90, 3, 47, 3]);
    expect(r.minimo).toBe(3);
    expect(r.minimo).toBeLessThan((3 + 47 + 3) / 3);
  });

  it('con un giro solo non ha niente da scartare', () => {
    const r = riassumiMisure([84]);
    expect(r.minimo).toBe(84);
    expect(r.primo).toBe(84);
  });

  it('la mediana si calcola su quel che resta, non su tutto', () => {
    const r = riassumiMisure([100, 10, 20, 30]);
    expect(r.mediana).toBe(20);
  });

  it('senza misure non inventa un numero', () => {
    expect(riassumiMisure([]).minimo).toBe(0);
    expect(riassumiMisure([Number.NaN, -5]).giri).toEqual([]);
  });
});

describe('il giudizio sulla distanza', () => {
  it('sotto i dieci millisecondi il database è nello stesso posto', () => {
    const g = giudicaDistanza(3);
    expect(g.distanza).toBe('vicino');
    // E lo dice: spostare la regione non serve, il problema è altrove.
    expect(g.spiegazione).toMatch(/altrove/i);
  });

  it('sopra i quaranta c’è di mezzo un oceano', () => {
    const g = giudicaDistanza(84);
    expect(g.distanza).toBe('lontano');
    expect(g.spiegazione).toMatch(/regione/i);
  });

  it('in mezzo, due città europee', () => {
    expect(giudicaDistanza(22).distanza).toBe('stesso-continente');
  });

  it('le soglie sono confini, non zone d’ombra', () => {
    // Senza questa, spostare una soglia di un millisecondo non farebbe
    // diventare rossa nessuna prova.
    expect(giudicaDistanza(SOGLIA_VICINO_MS - 1).distanza).toBe('vicino');
    expect(giudicaDistanza(SOGLIA_VICINO_MS).distanza).toBe('stesso-continente');
    expect(giudicaDistanza(SOGLIA_LONTANO_MS - 1).distanza).toBe('stesso-continente');
    expect(giudicaDistanza(SOGLIA_LONTANO_MS).distanza).toBe('lontano');
  });
});
