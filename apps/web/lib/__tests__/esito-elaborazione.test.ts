import { describe, expect, it } from 'vitest';
import { esitoElaborazione } from '../esito-elaborazione.js';

// ---------------------------------------------------------------------------
// Un lavoro fallito non deve MAI avere l'aspetto di un lavoro riuscito.
//
// Questo è il difetto che il test protegge: la pagina di avanzamento
// distingueva solo «in corso» da «concluso», e metteva la spunta verde su
// tutto ciò che era concluso. Uno stato `failed` cadeva quindi nel ramo del
// successo. Peggio: i contatori mostravano «0 Falliti», perché un batch
// fermato in blocco non arriva mai a marcare i singoli prodotti — quindi
// nemmeno il numero smentiva la spunta.
//
// Un difetto così non fa rumore: niente eccezioni, niente log, nessun test
// rosso. Semplicemente qualcuno esporta un catalogo che non è stato generato.
// ---------------------------------------------------------------------------

describe('esito dell’elaborazione', () => {
  it('uno stato «failed» non si legge mai come concluso e basta', () => {
    // Il caso esatto dell'audit: stato fallito, contatore dei falliti a zero.
    const e = esitoElaborazione('failed', 0);
    expect(e.esito).toBe('fallita');
    expect(e.titolo).not.toBe('Elaborazione conclusa');
    expect(e.titolo.toLowerCase()).toContain('non riuscita');
    expect(e.finita).toBe(true);
  });

  it('«partial_failed» dice che qualcosa è andato storto, anche col contatore a zero', () => {
    // Lo stato lo sa; il contatore no. Vince lo stato.
    expect(esitoElaborazione('partial_failed', 0).esito).toBe('con-errori');
  });

  it('un batch completato con prodotti falliti non si spaccia per pulito', () => {
    expect(esitoElaborazione('completed', 3).esito).toBe('con-errori');
  });

  it('il successo pieno resta successo pieno', () => {
    const e = esitoElaborazione('completed', 0);
    expect(e.esito).toBe('riuscita');
    expect(e.titolo).toBe('Elaborazione conclusa');
  });

  it('gli stati intermedi non sono conclusi', () => {
    for (const s of ['queued', 'processing', 'approved', undefined, null, '']) {
      const e = esitoElaborazione(s, 0);
      expect(e.finita, `«${s}» risulta concluso`).toBe(false);
      expect(e.esito).toBe('in-corso');
    }
  });

  it('nessun esito diverso da «riuscita» usa le parole del successo', () => {
    // La spunta verde segue `esito === 'riuscita'`: se un altro esito si
    // portasse dietro lo stesso titolo, il difetto tornerebbe dalla porta del
    // testo invece che da quella dell'icona.
    const casi: Array<[string, number]> = [
      ['failed', 0],
      ['failed', 5],
      ['partial_failed', 0],
      ['completed', 1],
    ];
    for (const [stato, falliti] of casi) {
      expect(esitoElaborazione(stato, falliti).titolo).not.toBe('Elaborazione conclusa');
    }
  });
});
