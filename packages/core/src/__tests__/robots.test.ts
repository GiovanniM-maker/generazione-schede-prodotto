import { describe, expect, it } from 'vitest';
import { analizzaRobots, attesaRichiesta, consentito, gruppoPerAgente } from '../robots.js';

// ---------------------------------------------------------------------------
// robots.txt.
//
// Le prove che contano non sono quelle in cui il file dice «vietato» e noi
// diciamo «vietato». Sono quelle in cui una lettura frettolosa direbbe
// «permesso»: il gruppo scritto per noi che deve battere quello generico, la
// regola più lunga che deve battere la più corta, `$` che chiude il percorso.
// Sbagliando lì si legge una pagina che il sito ci aveva chiesto di lasciare
// stare, e nessuno se ne accorge — a parte il sito.
// ---------------------------------------------------------------------------

const UA = 'VerificatoBot/1.0';

describe('analizzaRobots', () => {
  it('legge gruppi, regole e attesa', () => {
    const r = analizzaRobots(`
      User-agent: *
      Disallow: /admin
      Allow: /admin/pubblico
      Crawl-delay: 2
    `);
    expect(r.gruppi).toHaveLength(1);
    expect(r.gruppi[0]!.agenti).toEqual(['*']);
    expect(r.gruppi[0]!.regole).toEqual([
      { tipo: 'disallow', percorso: '/admin' },
      { tipo: 'allow', percorso: '/admin/pubblico' },
    ]);
    expect(r.gruppi[0]!.attesa).toBe(2);
  });

  it('più user-agent di fila condividono le stesse regole', () => {
    // È la forma normale nei file veri. Trattandoli come gruppi separati, il
    // secondo agente resterebbe senza regole e passerebbe ovunque.
    const r = analizzaRobots(`
      User-agent: googlebot
      User-agent: verificatobot
      Disallow: /privato
    `);
    expect(r.gruppi).toHaveLength(1);
    expect(r.gruppi[0]!.agenti).toEqual(['googlebot', 'verificatobot']);
    expect(consentito(r, '/privato', UA)).toBe(false);
  });

  it('un nuovo user-agent dopo una direttiva apre un gruppo nuovo', () => {
    const r = analizzaRobots(`
      User-agent: googlebot
      Disallow: /a
      User-agent: verificatobot
      Disallow: /b
    `);
    expect(r.gruppi).toHaveLength(2);
    expect(consentito(r, '/a', UA)).toBe(true);
    expect(consentito(r, '/b', UA)).toBe(false);
  });

  it('butta via i commenti e le righe senza due punti', () => {
    const r = analizzaRobots(`
      # commento
      User-agent: *   # anche qui
      Disallow: /x
      questa riga non significa niente
    `);
    expect(r.gruppi[0]!.regole).toEqual([{ tipo: 'disallow', percorso: '/x' }]);
  });

  it('un file vuoto o illeggibile non lancia', () => {
    for (const t of ['', '   ', 'robaccia']) {
      expect(() => analizzaRobots(t)).not.toThrow();
      expect(consentito(analizzaRobots(t), '/qualsiasi', UA)).toBe(true);
    }
  });

  it('«Disallow:» senza percorso non vieta niente', () => {
    const r = analizzaRobots('User-agent: *\nDisallow:');
    expect(consentito(r, '/qualsiasi', UA)).toBe(true);
  });
});

describe('gruppoPerAgente', () => {
  it('il gruppo scritto per noi batte quello generico', () => {
    // Il caso in cui conviene sbagliare, e per questo va provato: se vincesse
    // il generico leggeremmo /riservato, che a noi è vietato per nome.
    const r = analizzaRobots(`
      User-agent: *
      Disallow: /admin

      User-agent: verificatobot
      Disallow: /riservato
    `);
    expect(gruppoPerAgente(r, UA)!.regole[0]!.percorso).toBe('/riservato');
    expect(consentito(r, '/riservato', UA)).toBe(false);
    // E le regole del generico NON valgono più per noi: il gruppo è uno solo.
    expect(consentito(r, '/admin', UA)).toBe(true);
  });

  it('senza un gruppo per noi vale il generico', () => {
    const r = analizzaRobots('User-agent: *\nDisallow: /admin');
    expect(consentito(r, '/admin', UA)).toBe(false);
  });

  it('fra due nomi che ci somigliano vince il più specifico', () => {
    const r = analizzaRobots(`
      User-agent: bot
      Disallow: /uno

      User-agent: verificatobot
      Disallow: /due
    `);
    expect(consentito(r, '/uno', UA)).toBe(true);
    expect(consentito(r, '/due', UA)).toBe(false);
  });

  it('un gruppo per un altro agente non ci riguarda', () => {
    const r = analizzaRobots('User-agent: googlebot\nDisallow: /tutto');
    expect(consentito(r, '/tutto', UA)).toBe(true);
  });
});

describe('consentito — quale regola vince', () => {
  it('la regola più lunga batte la più corta', () => {
    const r = analizzaRobots(`
      User-agent: *
      Disallow: /prodotti
      Allow: /prodotti/pubblici
    `);
    expect(consentito(r, '/prodotti/interni', UA)).toBe(false);
    expect(consentito(r, '/prodotti/pubblici/x', UA)).toBe(true);
  });

  it('a parità di lunghezza vince Allow', () => {
    const r = analizzaRobots(`
      User-agent: *
      Disallow: /p
      Allow: /p
    `);
    expect(consentito(r, '/p/x', UA)).toBe(true);
  });

  it('«*» dentro il percorso vale come qualsiasi cosa', () => {
    const r = analizzaRobots('User-agent: *\nDisallow: /*/privato');
    expect(consentito(r, '/negozio/privato/x', UA)).toBe(false);
    expect(consentito(r, '/negozio/pubblico', UA)).toBe(true);
  });

  it('«$» chiude il percorso', () => {
    // Senza l'ancora, «/cerca$» vieterebbe anche «/cerca/prodotto», che il sito
    // non aveva vietato.
    const r = analizzaRobots('User-agent: *\nDisallow: /cerca$');
    expect(consentito(r, '/cerca', UA)).toBe(false);
    expect(consentito(r, '/cerca/prodotto', UA)).toBe(true);
  });

  it('i caratteri speciali di una regex nel percorso non sono speciali qui', () => {
    // «/p+r(o)» è un percorso, non un'espressione: preso alla lettera da una
    // regex vieterebbe tutt'altro, o esploderebbe.
    const r = analizzaRobots('User-agent: *\nDisallow: /p+r(o)');
    expect(() => consentito(r, '/p+r(o)/x', UA)).not.toThrow();
    expect(consentito(r, '/p+r(o)/x', UA)).toBe(false);
    expect(consentito(r, '/ppppr', UA)).toBe(true);
  });

  it('un percorso senza barra iniziale viene comunque confrontato', () => {
    const r = analizzaRobots('User-agent: *\nDisallow: /admin');
    expect(consentito(r, 'admin/x', UA)).toBe(false);
  });

  it('quello che non è vietato è permesso', () => {
    const r = analizzaRobots('User-agent: *\nDisallow: /admin');
    expect(consentito(r, '/prodotti/123', UA)).toBe(true);
  });
});

describe('attesaRichiesta', () => {
  it('riporta il ritardo dichiarato dal sito', () => {
    expect(attesaRichiesta(analizzaRobots('User-agent: *\nCrawl-delay: 5'), UA)).toBe(5);
  });

  it('senza dichiarazione non ne inventa uno', () => {
    expect(attesaRichiesta(analizzaRobots('User-agent: *\nDisallow: /x'), UA)).toBeNull();
  });

  it('un valore non numerico viene ignorato invece di diventare zero', () => {
    // Zero vorrebbe dire «vai pure a raffica»: il contrario di ciò che il sito
    // stava chiedendo scrivendo quella riga.
    expect(attesaRichiesta(analizzaRobots('User-agent: *\nCrawl-delay: presto'), UA)).toBeNull();
  });
});
