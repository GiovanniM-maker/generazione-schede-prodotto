import { describe, expect, it } from 'vitest';
import {
  LIMITE_RISULTATI_MASSIMO,
  MAX_DOMINI_PER_QUERY,
  RicercaFinta,
  costruisciQuery,
  dominioDi,
  leggiRisultatiBrave,
} from '../ricerca.js';

// ---------------------------------------------------------------------------
// La query e la lettura della risposta.
//
// Sono le due parti in cui un errore non assomiglia a un errore: una query mal
// costruita non trova il prodotto e lo fa dichiarare inesistente; una risposta
// letta male costruisce candidati con campi vuoti, che più avanti il punteggio
// legge come «segnale assente» invece che come «non lo so».
// ---------------------------------------------------------------------------

const BASE = { codice: 'SED-AUR-01', marca: null, domini: [], limite: 10 };

describe('costruisciQuery', () => {
  it('mette il codice fra virgolette', () => {
    // Senza, i motori spezzano «SED-AUR-01» sui trattini e restituiscono
    // qualunque pagina che contenga una delle parti: mezzo catalogo.
    // Le forme sono due perché il codice ha dei separatori: chi lo pubblica sul
    // web spesso lo scrive attaccato.
    expect(costruisciQuery(BASE)).toBe('("SED-AUR-01" OR "SEDAUR01")');
  });

  it('aggiunge la marca, ma senza virgolette', () => {
    // La marca è un nome commerciale scritto in dieci modi: vincolarla alla
    // lettera fa perdere pagine buone.
    expect(costruisciQuery({ ...BASE, marca: 'Ferrini' })).toBe('("SED-AUR-01" OR "SEDAUR01") Ferrini');
  });

  it('limita a un dominio con site:', () => {
    expect(costruisciQuery({ ...BASE, domini: ['ferrini.it'] })).toBe('("SED-AUR-01" OR "SEDAUR01") site:ferrini.it');
  });

  it('con più domini li mette in alternativa', () => {
    expect(costruisciQuery({ ...BASE, domini: ['ferrini.it', 'grossista.it'] })).toBe(
      '("SED-AUR-01" OR "SEDAUR01") (site:ferrini.it OR site:grossista.it)',
    );
  });

  it('ripulisce i domini scritti come li scrive una persona', () => {
    expect(costruisciQuery({ ...BASE, domini: ['https://www.Ferrini.it/prodotti'] })).toBe(
      '("SED-AUR-01" OR "SEDAUR01") site:ferrini.it',
    );
  });

  it('non ripete lo stesso dominio scritto in due modi', () => {
    expect(costruisciQuery({ ...BASE, domini: ['ferrini.it', 'www.ferrini.it', 'https://ferrini.it'] })).toBe(
      '("SED-AUR-01" OR "SEDAUR01") site:ferrini.it',
    );
  });

  it('oltre un certo numero di domini smette di aggiungerne', () => {
    const molti = Array.from({ length: 12 }, (_, i) => `sito${i}.it`);
    const q = costruisciQuery({ ...BASE, domini: molti });
    expect(q.match(/site:/g)).toHaveLength(MAX_DOMINI_PER_QUERY);
  });

  it('le virgolette dentro il codice non spezzano la query', () => {
    expect(costruisciQuery({ ...BASE, codice: 'AB"12' })).toBe('"AB12"');
  });

  it('senza codice non c’è query da fare', () => {
    // Cercare la sola marca restituirebbe il catalogo del produttore, e ogni
    // sua pagina somiglierebbe a un candidato.
    expect(costruisciQuery({ ...BASE, codice: '   ', marca: 'Ferrini' })).toBe('');
  });
});

describe('dominioDi', () => {
  it('toglie il www e abbassa le maiuscole', () => {
    expect(dominioDi('https://WWW.Ferrini.it/p/1')).toBe('ferrini.it');
  });

  it('su qualcosa che non è un URL non lancia', () => {
    expect(dominioDi('non un url')).toBe('');
    expect(dominioDi('')).toBe('');
  });
});

describe('leggiRisultatiBrave', () => {
  const risposta = {
    web: {
      results: [
        {
          url: 'https://ferrini.it/p/sed-aur-01',
          title: 'Sedia <strong>Aurora</strong>',
          description: 'Codice <strong>SED-AUR-01</strong> &amp; faggio',
        },
        { url: 'https://marketplace.com/x', title: 'Sedia Aurora', description: 'Offerta' },
      ],
    },
  };

  it('legge url, titolo, descrizione e dominio', () => {
    const r = leggiRisultatiBrave(risposta);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      url: 'https://ferrini.it/p/sed-aur-01',
      titolo: 'Sedia Aurora',
      descrizione: 'Codice SED-AUR-01 & faggio',
      dominio: 'ferrini.it',
    });
  });

  it('toglie il grassetto che il motore mette sui termini trovati', () => {
    // Restando, i tag finirebbero nel testo su cui si cerca il codice: un
    // «SED-<strong>AUR</strong>-01» non combacia con niente.
    expect(leggiRisultatiBrave(risposta)[0]!.titolo).not.toMatch(/</);
  });

  it('scarta lo stesso URL che torna due volte', () => {
    // Due copie dello stesso risultato sembrerebbero due candidati
    // indipendenti, e due candidati che si equivalgono mandano in coda di
    // conferma un prodotto che era risolto.
    const doppia = { web: { results: [risposta.web.results[0], risposta.web.results[0]] } };
    expect(leggiRisultatiBrave(doppia)).toHaveLength(1);
  });

  it('scarta le voci senza URL utilizzabile invece di far fallire tutto', () => {
    const sporca = {
      web: {
        results: [
          { title: 'senza url' },
          { url: 42 },
          { url: 'non-un-url' },
          risposta.web.results[0],
        ],
      },
    };
    const r = leggiRisultatiBrave(sporca);
    expect(r).toHaveLength(1);
    expect(r[0]!.dominio).toBe('ferrini.it');
  });

  it('su una risposta di forma inattesa risponde vuoto, non con un’eccezione', () => {
    // Il servizio è esterno e può cambiare forma senza avvisare. Il modo in cui
    // ce ne accorgiamo non deve essere un errore in faccia a un cliente durante
    // il suo import.
    for (const r of [null, undefined, {}, { web: {} }, { web: { results: 'niente' } }, 'testo', 42]) {
      expect(() => leggiRisultatiBrave(r)).not.toThrow();
      expect(leggiRisultatiBrave(r)).toEqual([]);
    }
  });

  it('rispetta il limite chiesto', () => {
    const molti = {
      web: { results: Array.from({ length: 30 }, (_, i) => ({ url: `https://x.com/${i}`, title: `t${i}` })) },
    };
    expect(leggiRisultatiBrave(molti, 3)).toHaveLength(3);
  });

  it('non supera il tetto massimo nemmeno se glielo si chiede', () => {
    // Ogni risultato in più è testo da scaricare e da valutare: il tetto esiste
    // per non far pagare a un cliente una ricerca che non gli serve.
    const molti = {
      web: { results: Array.from({ length: 100 }, (_, i) => ({ url: `https://x.com/${i}`, title: `t${i}` })) },
    };
    expect(leggiRisultatiBrave(molti, 999)).toHaveLength(LIMITE_RISULTATI_MASSIMO);
  });
});

describe('RicercaFinta', () => {
  it('restituisce solo quello che le è stato dato', async () => {
    // Un finto che inventa risultati fa passare per funzionante un percorso che
    // non lo è: è il modo più efficace di scoprire un difetto in produzione.
    const finta = new RicercaFinta({
      'SED-AUR-01': [{ url: 'https://ferrini.it/p', titolo: 'Sedia', descrizione: '', dominio: 'ferrini.it' }],
    });
    expect(await finta.cerca({ ...BASE })).toHaveLength(1);
    expect(await finta.cerca({ ...BASE, codice: 'ALTRO' })).toEqual([]);
  });

  it('tiene traccia di essere stata chiamata, e con cosa', () => {
    const finta = new RicercaFinta();
    void finta.cerca({ ...BASE, marca: 'Ferrini' });
    expect(finta.chiamate).toHaveLength(1);
    expect(finta.chiamate[0]!.marca).toBe('Ferrini');
  });
});

describe('il codice scritto in più modi', () => {
  // Caso vero, costato un import a vuoto: «E1 M50 120101» è il codice
  // produttore di una borsa Coccinelle, scritto con gli spazi nell'anagrafica
  // del cliente. Cercato così com'è, fra virgolette, il motore restituisce un
  // televisore Vizio M50-E1. La stessa borsa cercata come «E1M50120101» esce
  // dal sito del produttore. Due spazi, e un catalogo intero dichiarato
  // inesistente.
  it('un codice con separatori si chiede anche senza', () => {
    const q = costruisciQuery({ codice: 'E1 M50 120101', marca: null, domini: [], limite: 10 });
    expect(q).toContain('"E1M50120101"');
    expect(q).toContain('"E1 M50 120101"');
    expect(q).toContain(' OR ');
  });

  it('le alternative stanno insieme, e la marca resta fuori', () => {
    // Senza parentesi, «OR» si mangerebbe anche la marca: il motore leggerebbe
    // «questa forma OPPURE quest'altra OPPURE Coccinelle», e basterebbe una
    // pagina che nomina la marca per entrare fra i candidati.
    const q = costruisciQuery({ codice: 'E1 M50 120101', marca: 'Coccinelle', domini: [], limite: 10 });
    expect(q).toBe('("E1 M50 120101" OR "E1-M50-120101" OR "E1M50120101") Coccinelle');
  });

  it('un codice senza separatori resta una domanda sola', () => {
    // Chiedere costa: se non c'è niente da riscrivere, la query non si allarga.
    expect(costruisciQuery({ codice: '107148', marca: null, domini: [], limite: 10 })).toBe('"107148"');
  });

  it('la stessa forma scritta in due modi non si chiede due volte', () => {
    // Il motore ignora maiuscole e minuscole.
    const q = costruisciQuery({ codice: 'sed-aur-01', marca: null, domini: [], limite: 10 });
    expect(q).toBe('("sed-aur-01" OR "SEDAUR01")');
  });

  it('l’ambito continua a valere su tutte le forme', () => {
    const q = costruisciQuery({
      codice: 'E1 M50 120101',
      marca: null,
      domini: ['coccinelle.com'],
      limite: 10,
    });
    expect(q.endsWith('site:coccinelle.com')).toBe(true);
    expect(q.startsWith('(')).toBe(true);
  });
});
