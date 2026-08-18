import { describe, expect, it } from 'vitest';
import {
  ATTESA_ERRORE_BASE_MS,
  ATTESA_ERRORE_MASSIMA_MS,
  INTERVALLO_MINIMO_MS,
  MAX_TENTATIVI,
  TTL_CACHE_MS,
  TTL_CACHE_NEGATIVA_MS,
  attesaPrimaDi,
  cacheUtilizzabile,
  daLavorare,
  dopoLaRisposta,
  esitoDeciso,
  type VoceCache,
} from '../coda.js';

// ---------------------------------------------------------------------------
// La coda a scaglioni.
//
// Le prove che contano davvero sono tre, e sono tutte su cose che senza prova
// sembrano dettagli:
//
//  - «errore» NON è una risposta e si riprova; «non trovato» è una risposta e
//    non si riprova. Confonderli vuol dire archiviare come inesistenti i
//    prodotti cercati durante un guasto del motore di ricerca.
//
//  - un «non trovato» ottenuto guardando un sito solo non vale per tutto il
//    web. Riusarlo vorrebbe dire rispondere «non c'è» a una domanda che non è
//    mai stata fatta.
//
//  - una pagina trovata fuori dai siti che il cliente ha indicato non è una
//    risposta più economica: è una risposta a un'altra domanda.
// ---------------------------------------------------------------------------

const ORA = Date.parse('2026-06-01T12:00:00Z');
const giorni = (n: number) => n * 24 * 60 * 60 * 1000;

function voce(p: Partial<VoceCache> = {}): VoceCache {
  return {
    esito: 'risolto',
    dominioScelto: 'ferrini.it',
    ambito: [],
    aggiornatoIl: new Date(ORA - giorni(1)).toISOString(),
    ...p,
  };
}

describe('cosa è già deciso', () => {
  it('«non trovato» è una risposta, «errore» no', () => {
    expect(esitoDeciso('non-trovato')).toBe(true);
    expect(esitoDeciso('errore')).toBe(false);
  });

  it('una riga in errore si riprova, fino a un limite', () => {
    expect(daLavorare({ esito: 'errore', tentativi: 0 })).toBe(true);
    expect(daLavorare({ esito: 'errore', tentativi: MAX_TENTATIVI - 1 })).toBe(true);
    // Oltre, si smette: riprovare all'infinito una riga che fallisce sempre
    // vuol dire una lavorazione che non finisce mai e non lo dice.
    expect(daLavorare({ esito: 'errore', tentativi: MAX_TENTATIVI })).toBe(false);
  });

  it('una riga già risolta non si rifà, per quanti tentativi abbia', () => {
    // Rifarla non costa solo: può dare una risposta diversa dalla prima, e il
    // cliente si ritroverebbe lo stesso codice su due pagine.
    expect(daLavorare({ esito: 'risolto', tentativi: 0 })).toBe(false);
    expect(daLavorare({ esito: 'coda-conferma', tentativi: 0 })).toBe(false);
    expect(daLavorare({ esito: 'non-trovato', tentativi: 0 })).toBe(false);
  });

  it('una riga in coda si lavora', () => {
    expect(daLavorare({ esito: 'in-coda', tentativi: 0 })).toBe(true);
  });
});

describe('il ritmo per dominio', () => {
  it('un dominio mai toccato non fa aspettare', () => {
    expect(attesaPrimaDi(undefined, ORA)).toBe(0);
  });

  it('due richieste di fila allo stesso sito sono distanziate', () => {
    expect(attesaPrimaDi({ ultima: ORA, errori: 0 }, ORA)).toBe(INTERVALLO_MINIMO_MS);
    // Se è già passato abbastanza tempo, non si aspetta altro.
    expect(attesaPrimaDi({ ultima: ORA, errori: 0 }, ORA + INTERVALLO_MINIMO_MS)).toBe(0);
    expect(attesaPrimaDi({ ultima: ORA, errori: 0 }, ORA + 10_000)).toBe(0);
  });

  it('dopo un errore l’attesa cresce, e non oltre un tetto', () => {
    expect(attesaPrimaDi({ ultima: ORA, errori: 1 }, ORA)).toBe(ATTESA_ERRORE_BASE_MS);
    expect(attesaPrimaDi({ ultima: ORA, errori: 2 }, ORA)).toBe(ATTESA_ERRORE_BASE_MS * 2);
    expect(attesaPrimaDi({ ultima: ORA, errori: 3 }, ORA)).toBe(ATTESA_ERRORE_BASE_MS * 4);
    // Un sito che non risponde non torna su perché lo aspettiamo un'ora.
    expect(attesaPrimaDi({ ultima: ORA, errori: 30 }, ORA)).toBe(ATTESA_ERRORE_MASSIMA_MS);
  });

  it('una risposta buona azzera il conto degli errori', () => {
    const dopoTreErrori = { ultima: ORA, errori: 3 };
    const risanato = dopoLaRisposta(dopoTreErrori, ORA + 5_000, true);
    expect(risanato.errori).toBe(0);
    expect(attesaPrimaDi(risanato, ORA + 5_000)).toBe(INTERVALLO_MINIMO_MS);
  });

  it('gli errori si accumulano finché non arriva una risposta buona', () => {
    let s = dopoLaRisposta(undefined, ORA, false);
    s = dopoLaRisposta(s, ORA + 1, false);
    expect(s.errori).toBe(2);
  });
});

describe('la cache della risoluzione', () => {
  it('una risoluzione recente si riusa', () => {
    const r = cacheUtilizzabile(voce(), { adesso: ORA, domini: [] });
    expect(r.usa).toBe(true);
  });

  it('una risoluzione vecchia si rifà', () => {
    const vecchia = voce({ aggiornatoIl: new Date(ORA - TTL_CACHE_MS - 1).toISOString() });
    expect(cacheUtilizzabile(vecchia, { adesso: ORA, domini: [] }).usa).toBe(false);
  });

  it('un «non trovato» scade prima di un aggancio', () => {
    // Una pagina che esiste tende a restare; un prodotto che non si trovava il
    // mese scorso può essere stato pubblicato ieri.
    const eta = TTL_CACHE_NEGATIVA_MS + giorni(1);
    expect(eta).toBeLessThan(TTL_CACHE_MS);
    const quando = new Date(ORA - eta).toISOString();

    expect(cacheUtilizzabile(voce({ aggiornatoIl: quando }), { adesso: ORA, domini: [] }).usa).toBe(true);
    expect(
      cacheUtilizzabile(
        voce({ esito: 'non-trovato', dominioScelto: null, aggiornatoIl: quando }),
        { adesso: ORA, domini: [] },
      ).usa,
    ).toBe(false);
  });

  it('una riga ancora da confermare non è una risposta da riusare', () => {
    // Non è un risparmio: nessuno ha ancora deciso quale pagina fosse.
    const r = cacheUtilizzabile(voce({ esito: 'coda-conferma' }), { adesso: ORA, domini: [] });
    expect(r.usa).toBe(false);
  });

  it('un errore non si riusa', () => {
    expect(cacheUtilizzabile(voce({ esito: 'errore' }), { adesso: ORA, domini: [] }).usa).toBe(false);
  });

  it('una pagina fuori dai siti indicati non vale come risposta', () => {
    // Il cliente ha detto «cerca solo dal mio fornitore». Una pagina trovata su
    // un marketplace non è la stessa domanda con una risposta più economica.
    const r = cacheUtilizzabile(voce({ dominioScelto: 'marketplace.com' }), {
      adesso: ORA,
      domini: ['fornitorex.it'],
    });
    expect(r.usa).toBe(false);
    expect(r.motivo).toContain('fuori dai siti');
  });

  it('una pagina su un sottodominio del fornitore indicato vale', () => {
    const r = cacheUtilizzabile(voce({ dominioScelto: 'shop.fornitorex.it' }), {
      adesso: ORA,
      domini: ['https://www.fornitorex.it/catalogo'],
    });
    expect(r.usa).toBe(true);
  });

  it('un «non trovato» cercato su un sito solo non vale per tutto il web', () => {
    // È la differenza fra «ho guardato ovunque e non c'è» e «ho guardato in un
    // posto solo». Riusare il secondo come il primo vuol dire rispondere «non
    // c'è» a una domanda che non è stata fatta.
    const negativa = voce({ esito: 'non-trovato', dominioScelto: null, ambito: ['fornitorex.it'] });
    expect(cacheUtilizzabile(negativa, { adesso: ORA, domini: [] }).usa).toBe(false);
    // Ma vale ancora per la stessa ricerca ristretta.
    expect(cacheUtilizzabile(negativa, { adesso: ORA, domini: ['fornitorex.it'] }).usa).toBe(true);
    // E non vale se adesso si guarda anche altrove.
    expect(
      cacheUtilizzabile(negativa, { adesso: ORA, domini: ['fornitorex.it', 'altro.it'] }).usa,
    ).toBe(false);
  });

  it('un «non trovato» su tutto il web vale anche per una ricerca ristretta', () => {
    // Se non c'era da nessuna parte, non c'è nemmeno su fornitorex.it.
    const negativa = voce({ esito: 'non-trovato', dominioScelto: null, ambito: [] });
    expect(cacheUtilizzabile(negativa, { adesso: ORA, domini: ['fornitorex.it'] }).usa).toBe(true);
  });

  it('una data illeggibile o nel futuro fa rifare la ricerca', () => {
    expect(cacheUtilizzabile(voce({ aggiornatoIl: 'boh' }), { adesso: ORA, domini: [] }).usa).toBe(false);
    expect(
      cacheUtilizzabile(voce({ aggiornatoIl: new Date(ORA + giorni(2)).toISOString() }), {
        adesso: ORA,
        domini: [],
      }).usa,
    ).toBe(false);
  });
});
