import { describe, expect, it } from 'vitest';
import {
  ATTENDIBILITA_PER_ORIGINE,
  auditConAttendibilita,
  puoSostenereClaim,
  type FattoAttendibile,
} from '../attendibilita.js';
import type { OrigineFatto } from '../precedenza.js';
import type { ProductCopy } from '../types.js';

// ---------------------------------------------------------------------------
// I tre livelli di attendibilità.
//
// La prova che conta è una sola, ed è quella per cui il modulo esiste: lo
// stesso identico fatto deve sostenere un claim se lo dichiara il cliente e NON
// sostenerlo se viene da un marketplace. Se le due situazioni dessero lo stesso
// risultato, questo file non servirebbe a niente — e la scheda direbbe
// «biologico» sulla parola di una pagina che non ha firmato nessuno.
// ---------------------------------------------------------------------------

function scheda(testo: string): ProductCopy {
  return {
    title: 'Maglia',
    shortDescription: testo,
    longDescription: '',
    bullets: [],
    metaDescription: '',
    faq: [],
    altText: '',
    usedFactKeys: [],
    warnings: [],
  };
}

function fatto(
  fieldKey: string,
  value: string,
  attendibilita: FattoAttendibile['attendibilita'],
  urlFonte?: string,
): FattoAttendibile {
  return {
    fieldKey,
    value,
    status: 'provided',
    sourceType: 'csv',
    attendibilita,
    urlFonte: urlFonte ?? null,
  };
}

describe('la mappa dei livelli', () => {
  it('quello che dice il cliente è dichiarato', () => {
    for (const o of ['manuale', 'foglio', 'pdf'] as OrigineFatto[]) {
      expect(ATTENDIBILITA_PER_ORIGINE[o]).toBe('dichiarato');
    }
  });

  it('un marketplace è terza parte, e non fa prova', () => {
    expect(ATTENDIBILITA_PER_ORIGINE['ricerca-terza-parte']).toBe('terza-parte');
    expect(puoSostenereClaim('terza-parte')).toBe(false);
  });

  it('dichiarato e ufficiale fanno prova', () => {
    expect(puoSostenereClaim('dichiarato')).toBe(true);
    expect(puoSostenereClaim('ufficiale')).toBe(true);
  });

  it('un URL incollato dall’utente vale come ufficiale, non come dichiarato', () => {
    // L'utente ha scelto la pagina, ma la pagina resta di qualcun altro: non è
    // una dichiarazione del cliente, e nel rapporto la fonte va nominata.
    expect(ATTENDIBILITA_PER_ORIGINE['url-utente']).toBe('ufficiale');
  });
});

describe('auditConAttendibilita', () => {
  const CONTENUTO = scheda('Maglia in cotone biologico, morbida.');

  it('un fatto dichiarato dal cliente sostiene il claim', () => {
    const r = auditConAttendibilita([fatto('certificazione', 'cotone biologico', 'dichiarato')], CONTENUTO);
    expect(r.unsupportedClaims).toHaveLength(0);
    expect(r.severity).toBe('none');
    expect(r.passed).toBe(true);
  });

  it('LO STESSO fatto, preso da una terza parte, NON lo sostiene', () => {
    // È la prova per cui questo modulo esiste. Stesso valore, stessa chiave,
    // stesso testo: cambia solo chi lo dice, e deve bastare.
    const r = auditConAttendibilita([fatto('certificazione', 'cotone biologico', 'terza-parte')], CONTENUTO);
    expect(r.unsupportedClaims).toContain('biologico');
    expect(r.severity).toBe('high');
    expect(r.passed).toBe(false);
  });

  it('dice quali claim poggiavano solo su una terza parte', () => {
    // Serve distinguerli da quelli che non aveva proprio nessuno: sono due
    // messaggi diversi per chi deve correggere la scheda.
    const r = auditConAttendibilita([fatto('certificazione', 'cotone biologico', 'terza-parte')], CONTENUTO);
    expect(r.claimSoloDaTerzaParte).toContain('biologico');
  });

  it('un claim che non ha nessun fatto dietro non è «solo da terza parte»', () => {
    const r = auditConAttendibilita([fatto('materiale', 'cotone', 'dichiarato')], CONTENUTO);
    expect(r.unsupportedClaims).toContain('biologico');
    expect(r.claimSoloDaTerzaParte).not.toContain('biologico');
  });

  it('una fonte ufficiale sostiene il claim, e viene nominata', () => {
    const r = auditConAttendibilita(
      [fatto('certificazione', 'cotone biologico', 'ufficiale', 'https://ferrini.it/p/1')],
      CONTENUTO,
    );
    expect(r.unsupportedClaims).toHaveLength(0);
    // Chi firma la scheda deve sapere su cosa poggia: la pagina va nel rapporto.
    expect(r.fontiCitate).toEqual(['https://ferrini.it/p/1']);
  });

  it('basta una fonte ammessa: la terza parte in più non toglie niente', () => {
    const r = auditConAttendibilita(
      [
        fatto('certificazione', 'cotone biologico', 'dichiarato'),
        fatto('nota', 'cotone biologico', 'terza-parte'),
      ],
      CONTENUTO,
    );
    expect(r.unsupportedClaims).toHaveLength(0);
    expect(r.claimSoloDaTerzaParte).toHaveLength(0);
  });

  it('un testo senza claim sensibili passa comunque', () => {
    const r = auditConAttendibilita(
      [fatto('materiale', 'cotone', 'terza-parte')],
      scheda('Maglia comoda, taglio classico.'),
    );
    expect(r.severity).toBe('none');
    expect(r.passed).toBe(true);
  });

  it('senza nessun fatto, un claim resta non sostenuto', () => {
    const r = auditConAttendibilita([], CONTENUTO);
    expect(r.unsupportedClaims).toContain('biologico');
  });

  it('i claim aggiuntivi di settore valgono con le stesse regole', () => {
    const detox = scheda('Tisana detox, depurativa.');
    const dichiarato = auditConAttendibilita([fatto('claim', 'detox', 'dichiarato')], detox, ['detox']);
    const terza = auditConAttendibilita([fatto('claim', 'detox', 'terza-parte')], detox, ['detox']);
    expect(dichiarato.unsupportedClaims).not.toContain('detox');
    expect(terza.unsupportedClaims).toContain('detox');
  });
});
