import { describe, expect, it } from 'vitest';
import {
  FORZA_ORIGINE,
  piuForte,
  stessoValore,
  unisciFatto,
  unisciScheda,
  type Fatto,
  type OrigineFatto,
} from '../precedenza.js';

// ---------------------------------------------------------------------------
// Chi vince fra due fonti.
//
// Le due prove che questo file esiste per fare: che un dato preso da internet
// NON sostituisca mai un dato del cliente, e che quando lo contraddice non
// sparisca in silenzio. Sbagliando la prima si riscrive il gestionale di
// qualcuno con quello che dice un marketplace; sbagliando la seconda si butta
// via un'informazione senza dirlo, che è il modo educato di fare la stessa cosa.
// ---------------------------------------------------------------------------

function f(chiave: string, valore: string, origine: OrigineFatto, url?: string): Fatto {
  return { chiave, valore, origine, url: url ?? null };
}

describe('la scala delle fonti', () => {
  it('va dal cliente a internet, senza pareggi', () => {
    const ordine: OrigineFatto[] = [
      'manuale',
      'foglio',
      'pdf',
      'url-utente',
      'ricerca-ufficiale',
      'ricerca-terza-parte',
      'derivato',
    ];
    const forze = ordine.map((o) => FORZA_ORIGINE[o]);
    expect(forze).toEqual([...forze].sort((a, b) => a - b));
    expect(new Set(forze).size).toBe(ordine.length);
  });

  it('il dato inserito a mano non lo scavalca nessuno', () => {
    for (const o of Object.keys(FORZA_ORIGINE) as OrigineFatto[]) {
      if (o === 'manuale') continue;
      expect(piuForte(o, 'manuale')).toBe(false);
    }
  });

  it('a parità nessuna delle due vince', () => {
    expect(piuForte('foglio', 'foglio')).toBe(false);
  });
});

describe('stessoValore', () => {
  it('spazi e maiuscole non fanno un conflitto', () => {
    expect(stessoValore(' Cotone ', 'cotone')).toBe(true);
    expect(stessoValore('100%  cotone', '100% cotone')).toBe(true);
  });

  it('valori diversi restano diversi', () => {
    expect(stessoValore('Cotone', 'Lino')).toBe(false);
  });
});

describe('unisciFatto — quando si scrive', () => {
  it('su un campo vuoto scrive anche la fonte più debole', () => {
    // È tutto l'arricchimento: la ricerca serve a riempire i buchi.
    const e = unisciFatto(null, f('materiale', 'Cotone', 'ricerca-terza-parte'));
    expect(e.azione).toBe('scrivi');
  });

  it('un campo esistente ma vuoto conta come vuoto', () => {
    const e = unisciFatto(f('materiale', '   ', 'foglio'), f('materiale', 'Cotone', 'ricerca-terza-parte'));
    expect(e.azione).toBe('scrivi');
  });

  it('una fonte più forte sostituisce, e dice cosa ha sostituito', () => {
    const e = unisciFatto(
      f('materiale', 'Lino', 'ricerca-terza-parte'),
      f('materiale', 'Cotone', 'foglio'),
    );
    expect(e.azione).toBe('scrivi');
    if (e.azione !== 'scrivi') return;
    // Il valore vecchio non sparisce senza lasciare traccia: chi guarda deve
    // poter capire perché il campo è cambiato.
    expect(e.sostituito?.valore).toBe('Lino');
    expect(e.motivo).toMatch(/batte/i);
  });
});

describe('unisciFatto — quando NON si scrive', () => {
  it('una fonte più debole non sovrascrive: apre un conflitto', () => {
    // La regola non negoziabile. Il dato del foglio è del cliente; quello del
    // marketplace non è di nessuno.
    const e = unisciFatto(
      f('materiale', 'Cotone', 'foglio'),
      f('materiale', 'Poliestere', 'ricerca-terza-parte', 'https://market.com/x'),
    );
    expect(e.azione).toBe('dubbio-conflitto');
    if (e.azione !== 'dubbio-conflitto') return;
    expect(e.esistente.valore).toBe('Cotone');
    expect(e.entrante.valore).toBe('Poliestere');
    expect(e.entrante.url).toBe('https://market.com/x');
    expect(e.motivo).toMatch(/resta/i);
  });

  it('due fonti di pari peso che si contraddicono vanno entrambe in conflitto', () => {
    const e = unisciFatto(
      f('materiale', 'Cotone', 'ricerca-ufficiale'),
      f('materiale', 'Lino', 'ricerca-ufficiale'),
    );
    expect(e.azione).toBe('dubbio-conflitto');
    if (e.azione !== 'dubbio-conflitto') return;
    expect(e.motivo).toMatch(/pari peso/i);
  });

  it('lo stesso valore non è un conflitto, ed è una conferma silenziosa', () => {
    // Chiedere all'utente di dirimere fra «Cotone» e «cotone» è il modo più
    // rapido di far ignorare la coda dei dubbi.
    const e = unisciFatto(f('materiale', 'Cotone', 'foglio'), f('materiale', ' cotone ', 'ricerca-terza-parte'));
    expect(e.azione).toBe('ignora');
  });

  it('un valore vuoto in arrivo non cancella quello che c’è', () => {
    const e = unisciFatto(f('materiale', 'Cotone', 'foglio'), f('materiale', '  ', 'ricerca-ufficiale'));
    expect(e.azione).toBe('ignora');
  });
});

describe('unisciScheda', () => {
  it('riempie i buchi e conta quanti ne ha riempiti', () => {
    const r = unisciScheda(
      [f('materiale', 'Cotone', 'foglio')],
      [f('peso', '180 g', 'ricerca-ufficiale'), f('colore', 'Rosso', 'ricerca-ufficiale')],
    );
    expect(r.riempiti).toBe(2);
    expect(r.sostituiti).toBe(0);
    expect(r.conflitti).toHaveLength(0);
    expect(r.fatti.get('materiale')!.origine).toBe('foglio');
  });

  it('un conflitto non entra fra i fatti', () => {
    const r = unisciScheda(
      [f('materiale', 'Cotone', 'foglio')],
      [f('materiale', 'Lino', 'ricerca-terza-parte')],
    );
    expect(r.conflitti).toHaveLength(1);
    expect(r.fatti.get('materiale')!.valore).toBe('Cotone');
    expect(r.riempiti).toBe(0);
  });

  it('l’esito non dipende dall’ordine in cui arrivano i fatti', () => {
    // È la prova per cui i fatti in arrivo vengono ordinati per forza.
    //
    // Senza, arrivando prima la terza parte e poi il sito ufficiale, la prima
    // scriverebbe sul campo vuoto e la seconda la sostituirebbe: zero
    // conflitti. Nell'ordine opposto: un conflitto. Stesso valore finale, due
    // schermate diverse, decise da come il motore ha restituito le pagine.
    const ufficiale = f('materiale', 'Cotone', 'ricerca-ufficiale');
    const terza = f('materiale', 'Lino', 'ricerca-terza-parte');

    const a = unisciScheda([], [terza, ufficiale]);
    const b = unisciScheda([], [ufficiale, terza]);

    expect(a.fatti.get('materiale')!.valore).toBe(b.fatti.get('materiale')!.valore);
    expect(a.fatti.get('materiale')!.valore).toBe('Cotone');
    expect(a.conflitti.length).toBe(b.conflitti.length);
    expect(a.conflitti).toHaveLength(1);
    expect(a.riempiti).toBe(b.riempiti);
    expect(a.sostituiti).toBe(b.sostituiti);
    expect(a.sostituiti).toBe(0);
  });

  it('non conta come «riempito» un campo che era già pieno', () => {
    const r = unisciScheda(
      [f('materiale', 'Lino', 'ricerca-terza-parte')],
      [f('materiale', 'Cotone', 'foglio')],
    );
    expect(r.riempiti).toBe(0);
    expect(r.sostituiti).toBe(1);
    expect(r.fatti.get('materiale')!.valore).toBe('Cotone');
  });

  it('i fatti esistenti vuoti non bloccano l’arricchimento', () => {
    const r = unisciScheda([f('peso', '', 'foglio')], [f('peso', '180 g', 'ricerca-terza-parte')]);
    expect(r.riempiti).toBe(1);
    expect(r.fatti.get('peso')!.valore).toBe('180 g');
  });

  it('la provenienza e la data restano attaccate al fatto scritto', () => {
    // «Questo dato da dove esce» deve avere per risposta una pagina apribile,
    // non un'etichetta generica.
    const entrante: Fatto = {
      chiave: 'peso',
      valore: '180 g',
      origine: 'ricerca-ufficiale',
      url: 'https://ferrini.it/p/1',
      lettoIl: '2026-08-17T10:00:00Z',
    };
    const r = unisciScheda([], [entrante]);
    expect(r.fatti.get('peso')).toMatchObject({
      url: 'https://ferrini.it/p/1',
      lettoIl: '2026-08-17T10:00:00Z',
    });
  });
});
