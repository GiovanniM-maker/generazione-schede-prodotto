import { describe, expect, it } from 'vitest';
import {
  SOGLIA_AUTOMATICA,
  confidenzaCampo,
  decidiIdentita,
  formeDelCodice,
  punteggio,
  rilevaSegnali,
  valuta,
  type CandidatoPagina,
  type LivelloDominio,
} from '../sku-risoluzione.js';

// ---------------------------------------------------------------------------
// L'identità del prodotto agganciato.
//
// Qui le prove più importanti sono quelle che verificano che il sistema NON
// decida: la collisione fra produttori, i candidati deboli, i due candidati che
// si equivalgono. Un aggancio sbagliato produce una scheda in cui ogni campo è
// errato pur avendo confidenza alta, e nessun controllo a valle lo intercetta —
// ogni dato è stato letto benissimo, dalla pagina sbagliata.
// ---------------------------------------------------------------------------

function pagina(over: Partial<CandidatoPagina> = {}): CandidatoPagina {
  return {
    url: 'https://ferrini.it/p/sed-aur-01',
    dominio: 'ferrini.it',
    livelloDominio: 'produttore',
    titolo: 'Sedia Aurora',
    marcaPagina: 'Ferrini',
    testo: 'Sedia Ergonomica Aurora — codice SED-AUR-01 — faggio massello',
    prezzo: '189,00',
    immaginePrincipale: null,
    ...over,
  };
}

const CHIEDI = { codice: 'SED-AUR-01', marca: 'Ferrini' };

describe('formeDelCodice', () => {
  it('produce le scritture equivalenti dello stesso codice', () => {
    const f = formeDelCodice('AB-12-RED');
    expect(f).toContain('AB-12-RED');
    expect(f).toContain('AB12RED');
    expect(f).toContain('AB 12 RED');
    expect(f).toContain('AB_12_RED');
  });

  it('non produce forme troppo corte per cercarle', () => {
    // Cercare «AB» dentro il testo di una pagina trova qualsiasi cosa.
    expect(formeDelCodice('AB')).toEqual([]);
    expect(formeDelCodice('')).toEqual([]);
  });
});

describe('rilevaSegnali', () => {
  it('riconosce il codice scritto come l’ha scritto il cliente', () => {
    const s = rilevaSegnali(CHIEDI, pagina());
    expect(s.codiceEsatto).toBe(true);
    expect(s.codiceNormalizzato).toBe(false);
    expect(s.marcaCoincide).toBe(true);
  });

  it('riconosce il codice scritto con altri separatori', () => {
    // È il caso della specifica: il gestionale scrive «SED-AUR-01», il sito
    // «SEDAUR01». Senza le forme equivalenti, un prodotto che c'è risulta
    // «non trovato».
    const s = rilevaSegnali(CHIEDI, pagina({ testo: 'Sedia Aurora cod. SEDAUR01 in faggio' }));
    expect(s.codiceEsatto).toBe(false);
    expect(s.codiceNormalizzato).toBe(true);
  });

  it('non scambia per il codice una sua parte dentro un altro codice', () => {
    // «XSED-AUR-011» contiene «SED-AUR-01». Se contasse, si aggancerebbe il
    // prodotto sbagliato con il segnale più forte che esiste.
    const s = rilevaSegnali(CHIEDI, pagina({ testo: 'Ricambio XSED-AUR-011 per serie Aurora' }));
    expect(s.codiceEsatto).toBe(false);
    expect(s.codiceNormalizzato).toBe(false);
  });

  it('la marca coincide anche con la forma societaria diversa', () => {
    const s = rilevaSegnali(CHIEDI, pagina({ marcaPagina: 'Ferrini S.r.l.' }));
    expect(s.marcaCoincide).toBe(true);
  });

  it('marche diverse non coincidono', () => {
    const s = rilevaSegnali(CHIEDI, pagina({ marcaPagina: 'Bertoli' }));
    expect(s.marcaCoincide).toBe(false);
  });

  it('senza marca da una delle due parti il confronto non si può fare', () => {
    // `null` non è «no»: è «non lo so», e più avanti pesa in modo diverso.
    expect(rilevaSegnali({ codice: 'SED-AUR-01', marca: null }, pagina()).marcaCoincide).toBeNull();
    expect(rilevaSegnali(CHIEDI, pagina({ marcaPagina: null })).marcaCoincide).toBeNull();
  });
});

describe('punteggio', () => {
  const base = { codiceEsatto: true, codiceNormalizzato: false, marcaCoincide: true, livelloDominio: 'produttore' as LivelloDominio };

  it('senza il codice il punteggio è zero, qualunque altra cosa combaci', () => {
    // La regola che regge tutto. Marca giusta e sito del produttore valgono per
    // TUTTI i mille articoli di quel catalogo: non dicono niente su quale.
    expect(
      punteggio({ codiceEsatto: false, codiceNormalizzato: false, marcaCoincide: true, livelloDominio: 'produttore' }),
    ).toBe(0);
  });

  it('il codice esatto vale più di quello normalizzato', () => {
    expect(punteggio(base)).toBeGreaterThan(punteggio({ ...base, codiceEsatto: false, codiceNormalizzato: true }));
  });

  it('una marca che non coincide abbassa, non alza', () => {
    expect(punteggio({ ...base, marcaCoincide: false })).toBeLessThan(punteggio({ ...base, marcaCoincide: null }));
  });

  it('il dominio del produttore conta più di uno qualunque', () => {
    expect(punteggio(base)).toBeGreaterThan(punteggio({ ...base, livelloDominio: 'terza-parte' }));
    expect(punteggio({ ...base, livelloDominio: 'fornitore' })).toBeGreaterThan(
      punteggio({ ...base, livelloDominio: 'sconosciuto' }),
    );
  });

  it('nessuna combinazione di segnali arriva alla soglia automatica senza i tre requisiti', () => {
    // Prova esaustiva su tutto lo spazio dei segnali — sono 48 combinazioni.
    //
    // Serve perché in `decidiIdentita` la risoluzione automatica chiede
    // esplicitamente codice esatto, marca coerente e dominio affidabile, e con
    // i pesi di oggi quelle tre condizioni sono già implicate dalla soglia:
    // toglierle dal codice non fa diventare rossa nessuna prova. Cioè la
    // promessa è vera per aritmetica, non per costruzione, e basterebbe alzare
    // un peso perché smetta di esserlo in silenzio.
    //
    // Questa prova la pinza dove sta davvero: nei numeri.
    const livelli: LivelloDominio[] = ['produttore', 'fornitore', 'terza-parte', 'sconosciuto'];
    const marche: Array<boolean | null> = [true, false, null];
    let almenoUnaCiArriva = false;

    for (const codiceEsatto of [true, false]) {
      for (const codiceNormalizzato of [true, false]) {
        for (const marcaCoincide of marche) {
          for (const livelloDominio of livelli) {
            const s = { codiceEsatto, codiceNormalizzato, marcaCoincide, livelloDominio };
            if (punteggio(s) < SOGLIA_AUTOMATICA) continue;
            almenoUnaCiArriva = true;
            expect(s).toMatchObject({ codiceEsatto: true, marcaCoincide: true });
            expect(['produttore', 'fornitore']).toContain(livelloDominio);
          }
        }
      }
    }
    // Senza questa riga la prova passerebbe anche se NESSUNA combinazione
    // arrivasse alla soglia — cioè se la risoluzione automatica non scattasse
    // mai. Verde per assenza del bersaglio.
    expect(almenoUnaCiArriva).toBe(true);
  });

  it('resta fra zero e uno', () => {
    expect(punteggio(base)).toBeLessThanOrEqual(1);
    expect(punteggio({ ...base, marcaCoincide: false, livelloDominio: 'terza-parte' })).toBeGreaterThanOrEqual(0);
  });
});

describe('decidiIdentita — quando può decidere da solo', () => {
  it('codice esatto, marca coerente, sito del produttore: risolto', () => {
    const r = decidiIdentita(CHIEDI, [pagina()]);
    expect(r.esito).toBe('risolto');
    expect(r.scelto?.url).toBe('https://ferrini.it/p/sed-aur-01');
    expect(r.punteggioIdentita).toBeGreaterThanOrEqual(SOGLIA_AUTOMATICA);
  });

  it('sul sito di un fornitore riconosciuto vale lo stesso', () => {
    const r = decidiIdentita(CHIEDI, [pagina({ livelloDominio: 'fornitore', dominio: 'grossista.it' })]);
    expect(r.esito).toBe('risolto');
  });
});

describe('decidiIdentita — quando procede ma non si fida', () => {
  it('senza marca verificabile resta con riserva', () => {
    const r = decidiIdentita({ codice: 'SED-AUR-01', marca: null }, [pagina()]);
    expect(r.esito).toBe('risolto-con-riserva');
    expect(r.motivo).toMatch(/marca non è dichiarata|non è verificabile/i);
    expect(r.punteggioIdentita).toBeLessThan(SOGLIA_AUTOMATICA);
  });

  it('su un dominio di terza parte resta con riserva anche col codice esatto', () => {
    const r = decidiIdentita(CHIEDI, [
      pagina({ livelloDominio: 'terza-parte', dominio: 'marketplace.com', url: 'https://marketplace.com/x' }),
    ]);
    expect(r.esito).toBe('risolto-con-riserva');
    expect(r.scelto?.dominio).toBe('marketplace.com');
  });

  it('la riserva si propaga sulla confidenza dei campi', () => {
    // È il senso della riserva: un campo letto perfettamente da una pagina
    // agganciata a metà non può presentarsi al 100%.
    const r = decidiIdentita({ codice: 'SED-AUR-01', marca: null }, [pagina()]);
    expect(confidenzaCampo(1, r.punteggioIdentita)).toBeLessThan(1);
    expect(confidenzaCampo(1, r.punteggioIdentita)).toBe(r.punteggioIdentita);
  });
});

describe('decidiIdentita — quando NON deve decidere', () => {
  it('lo stesso codice presso due produttori diversi va in coda', () => {
    // La collisione: entrambe le pagine portano il codice esatto, ma di due
    // marche diverse. Sceglierne una vuol dire consegnare una scheda in cui
    // ogni campo è sbagliato pur essendo stato letto bene.
    const r = decidiIdentita(
      { codice: 'SED-AUR-01', marca: null },
      [
        pagina(),
        pagina({ url: 'https://bertoli.it/p/1', dominio: 'bertoli.it', marcaPagina: 'Bertoli' }),
      ],
    );
    expect(r.esito).toBe('coda-conferma');
    expect(r.scelto).toBeNull();
    expect(r.motivo).toMatch(/due produttori diversi|2 produttori/i);
    // I candidati restano, perché è quello che la schermata deve mostrare.
    expect(r.valutati).toHaveLength(2);
  });

  it('nessun candidato porta il codice: non trovato, non «il migliore»', () => {
    const r = decidiIdentita(CHIEDI, [
      pagina({ testo: 'Catalogo sedie Ferrini' }),
      pagina({ url: 'https://ferrini.it/b', testo: 'Novità primavera' }),
    ]);
    expect(r.esito).toBe('non-trovato');
    expect(r.scelto).toBeNull();
    expect(r.motivo).toMatch(/indovinare/i);
  });

  it('nessun candidato affatto', () => {
    const r = decidiIdentita(CHIEDI, []);
    expect(r.esito).toBe('non-trovato');
    expect(r.punteggioIdentita).toBe(0);
  });

  it('due candidati che si equivalgono vanno in coda invece che a sorte', () => {
    const uno = pagina({
      url: 'https://a.com/x',
      dominio: 'a.com',
      livelloDominio: 'terza-parte',
      marcaPagina: null,
    });
    const due = pagina({
      url: 'https://b.com/x',
      dominio: 'b.com',
      livelloDominio: 'terza-parte',
      marcaPagina: null,
    });
    const r = decidiIdentita({ codice: 'SED-AUR-01', marca: null }, [uno, due]);
    expect(r.esito).toBe('coda-conferma');
    expect(r.motivo).toMatch(/si equivalgono/i);
  });

  it('una marca che contraddice quella dichiarata non basta a risolvere', () => {
    const r = decidiIdentita(CHIEDI, [pagina({ marcaPagina: 'Bertoli', livelloDominio: 'terza-parte' })]);
    expect(r.esito).not.toBe('risolto');
    expect(r.scelto).toBeNull();
  });
});

describe('valuta', () => {
  it('ordina i candidati dal più forte al più debole', () => {
    const forte = pagina();
    const debole = pagina({
      url: 'https://x.com/1',
      dominio: 'x.com',
      livelloDominio: 'terza-parte',
      marcaPagina: null,
    });
    const ordinati = valuta(CHIEDI, [debole, forte]);
    expect(ordinati[0]!.candidato.url).toBe(forte.url);
    expect(ordinati[0]!.punteggio).toBeGreaterThan(ordinati[1]!.punteggio);
  });
});

describe('confidenzaCampo', () => {
  it('un aggancio certo lascia la confidenza com’era', () => {
    expect(confidenzaCampo(0.9, 1)).toBe(0.9);
  });

  it('un aggancio a metà dimezza la confidenza', () => {
    expect(confidenzaCampo(0.9, 0.5)).toBe(0.45);
  });

  it('regge valori fuori scala senza restituire assurdità', () => {
    expect(confidenzaCampo(2, 1)).toBe(1);
    expect(confidenzaCampo(-1, 1)).toBe(0);
  });
});
