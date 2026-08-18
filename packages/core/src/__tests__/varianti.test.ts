import { describe, expect, it } from 'vitest';
import {
  contaProdottiEVarianti,
  prefissoComune,
  unisciVarianti,
  type RigaProdotto,
} from '../varianti.js';

// ---------------------------------------------------------------------------
// Da righe a prodotti con varianti.
//
// La prova che conta di più non è che il raggruppamento avvenga, ma COSA
// finisce sul prodotto: il prodotto tiene solo i fatti veri per tutte le sue
// varianti. Se un fatto di una sola variante salisse al prodotto, l'AI
// scriverebbe «rosso» in una scheda che copre anche il blu — e nessun controllo
// a valle se ne accorgerebbe, perché quel dato è stato letto benissimo.
// ---------------------------------------------------------------------------

function riga(
  sku: string,
  padre: string | null,
  nome: string,
  attributi: Record<string, string> = {},
  category: string | null = null,
): RigaProdotto {
  return {
    sku,
    externalId: sku,
    parentExternalId: padre,
    name: nome,
    category,
    canonicalAttributes: { sku, ...attributi },
  };
}

describe('unisciVarianti — il caso che vale otto crediti', () => {
  const righe = [
    riga('TS100-RED', 'TS100', 'T-shirt Aurora Rossa', { colore: 'Rosso', materiale: 'Cotone', peso: '180 g' }),
    riga('TS100-BLU', 'TS100', 'T-shirt Aurora Blu', { colore: 'Blu', materiale: 'Cotone', peso: '180 g' }),
    riga('TS100-NER', 'TS100', 'T-shirt Aurora Nera', { colore: 'Nero', materiale: 'Cotone', peso: '180 g' }),
  ];
  const [p] = unisciVarianti(righe);

  it('tre righe diventano un prodotto con tre varianti', () => {
    expect(unisciVarianti(righe)).toHaveLength(1);
    expect(p!.externalId).toBe('TS100');
    expect(p!.varianti).toHaveLength(3);
  });

  it('sul prodotto salgono solo i fatti veri per tutte', () => {
    expect(p!.canonicalAttributes).toEqual({ sku: 'TS100', materiale: 'Cotone', peso: '180 g' });
  });

  it('il colore resta alla variante, perché è ciò che le distingue', () => {
    // Nessuna regola dice «il colore è di variante»: lo dicono i dati, che su
    // quella chiave sono diversi. Se salisse al prodotto, la scheda direbbe
    // «rosso» anche del blu.
    expect(Object.keys(p!.canonicalAttributes)).not.toContain('colore');
    expect(p!.varianti.map((v) => v.attributiVariante)).toEqual([
      { colore: 'Rosso' },
      { colore: 'Blu' },
      { colore: 'Nero' },
    ]);
  });

  it('il nome è la parte comune ai nomi delle varianti, e lo dichiara', () => {
    expect(p!.name).toBe('T-shirt Aurora');
    expect(p!.nomeDerivato).toBe(true);
  });

  it('tiene traccia delle righe da cui è nato', () => {
    expect(p!.skuOriginali).toEqual(['TS100-RED', 'TS100-BLU', 'TS100-NER']);
  });
});

describe('unisciVarianti — la riga padre dichiarata', () => {
  it('quando esiste, i suoi dati vincono e non è una variante', () => {
    const righe = [
      riga('TS100', 'TS100', 'T-shirt Aurora', { materiale: 'Cotone' }, 'Magliette'),
      riga('TS100-RED', 'TS100', 'T-shirt Aurora Rossa', { colore: 'Rosso' }),
      riga('TS100-BLU', 'TS100', 'T-shirt Aurora Blu', { colore: 'Blu' }),
    ];
    const [p] = unisciVarianti(righe);
    expect(p!.name).toBe('T-shirt Aurora');
    expect(p!.nomeDerivato).toBe(false);
    expect(p!.sku).toBe('TS100');
    expect(p!.category).toBe('Magliette');
    expect(p!.varianti.map((v) => v.sku)).toEqual(['TS100-RED', 'TS100-BLU']);
  });

  it('i fatti scritti sulla riga padre restano al prodotto', () => {
    // «materiale: cotone» sta sulla riga del modello e su nessuna variante: è
    // il cliente che l'ha dichiarato a livello di prodotto. Tenendo solo i
    // fatti comuni alle varianti, spariva — e la scheda perdeva un dato vero
    // senza che nessuno lo segnalasse.
    const righe = [
      riga('TS100', 'TS100', 'T-shirt Aurora', { materiale: 'Cotone', peso: '180 g' }),
      riga('TS100-RED', 'TS100', 'A rossa', { colore: 'Rosso' }),
      riga('TS100-BLU', 'TS100', 'A blu', { colore: 'Blu' }),
    ];
    const [p] = unisciVarianti(righe);
    expect(p!.canonicalAttributes).toEqual({ sku: 'TS100', materiale: 'Cotone', peso: '180 g' });
  });

  it('la riga padre non produce un secondo prodotto con lo stesso codice', () => {
    // Il difetto vero trovato da queste prove, e il peggiore: la riga «TS100»
    // dichiara sé stessa come padre, e a guardarla da sola sembra un prodotto
    // indipendente. Smistando in un giro solo finiva fuori dal suo gruppo e
    // usciva DUE volte — due schede, due crediti, e un export con due padri
    // identici che l'e-commerce rifiuta.
    const righe = [
      riga('TS100', 'TS100', 'T-shirt Aurora'),
      riga('TS100-RED', 'TS100', 'T-shirt Aurora Rossa', { colore: 'Rosso' }),
      riga('TS100-BLU', 'TS100', 'T-shirt Aurora Blu', { colore: 'Blu' }),
    ];
    const prodotti = unisciVarianti(righe);
    expect(prodotti).toHaveLength(1);
    expect(prodotti.filter((p) => p.externalId === 'TS100')).toHaveLength(1);
    expect(prodotti[0]!.skuOriginali).toHaveLength(3);
  });

  it('la riga padre può arrivare dopo i suoi figli', () => {
    const righe = [
      riga('TS100-RED', 'TS100', 'A rossa', { colore: 'Rosso' }),
      riga('TS100-BLU', 'TS100', 'A blu', { colore: 'Blu' }),
      riga('TS100', 'TS100', 'T-shirt Aurora', { materiale: 'Cotone' }),
    ];
    const prodotti = unisciVarianti(righe);
    expect(prodotti).toHaveLength(1);
    expect(prodotti[0]!.name).toBe('T-shirt Aurora');
    expect(prodotti[0]!.varianti).toHaveLength(2);
  });

  it('un padre dichiarato senza figli resta un prodotto normale', () => {
    const righe = [riga('TS100', 'TS100', 'T-shirt Aurora', { materiale: 'Cotone' })];
    const [p] = unisciVarianti(righe);
    expect(p!.varianti).toHaveLength(0);
    expect(p!.canonicalAttributes).toEqual({ sku: 'TS100', materiale: 'Cotone' });
  });
});

describe('unisciVarianti — quando NON si raggruppa', () => {
  it('senza codice padre ogni riga è un prodotto', () => {
    const righe = [riga('A1', null, 'Uno', { x: '1' }), riga('B2', null, 'Due', { x: '2' })];
    const prodotti = unisciVarianti(righe);
    expect(prodotti).toHaveLength(2);
    expect(prodotti.every((p) => p.varianti.length === 0)).toBe(true);
  });

  it('un codice padre che nessun altro condivide non crea una variante sola', () => {
    // Un prodotto con una variante e basta è una complicazione senza
    // contropartita: nell'export diventerebbe un padre con un figlio identico.
    const righe = [riga('TS100-RED', 'TS100', 'T-shirt Rossa', { colore: 'Rosso' })];
    const [p] = unisciVarianti(righe);
    expect(p!.varianti).toHaveLength(0);
    expect(p!.externalId).toBe('TS100-RED');
    // I fatti restano tutti sul prodotto: non c'è nessuno da cui distinguerlo.
    expect(p!.canonicalAttributes).toEqual({ sku: 'TS100-RED', colore: 'Rosso' });
  });

  it('due gruppi diversi restano due prodotti', () => {
    const righe = [
      riga('TS100-RED', 'TS100', 'A rossa', { colore: 'Rosso' }),
      riga('PL200-RED', 'PL200', 'B rossa', { colore: 'Rosso' }),
      riga('TS100-BLU', 'TS100', 'A blu', { colore: 'Blu' }),
      riga('PL200-BLU', 'PL200', 'B blu', { colore: 'Blu' }),
    ];
    const prodotti = unisciVarianti(righe);
    expect(prodotti.map((p) => p.externalId)).toEqual(['TS100', 'PL200']);
    expect(prodotti.every((p) => p.varianti.length === 2)).toBe(true);
  });

  it('l’ordine del file è conservato', () => {
    // Chi rilegge il catalogo importato deve ritrovare le sue righe dov'erano.
    const righe = [
      riga('Z1', null, 'Zeta'),
      riga('TS100-RED', 'TS100', 'A rossa'),
      riga('M1', null, 'Emme'),
      riga('TS100-BLU', 'TS100', 'A blu'),
    ];
    expect(unisciVarianti(righe).map((p) => p.externalId)).toEqual(['Z1', 'TS100', 'M1']);
  });

  it('una riga che dichiara sé stessa come padre non è una variante di sé', () => {
    const righe = [riga('A1', 'A1', 'Uno', { x: '1' })];
    const [p] = unisciVarianti(righe);
    expect(p!.varianti).toHaveLength(0);
    expect(p!.externalId).toBe('A1');
  });
});

describe('unisciVarianti — i fatti che non tornano', () => {
  it('un fatto presente in una sola variante NON sale al prodotto', () => {
    // È il caso pericoloso: «certificato GOTS» dichiarato per una sola
    // colorazione. Sul prodotto autorizzerebbe un claim su tutte.
    const righe = [
      riga('TS100-RED', 'TS100', 'A rossa', { colore: 'Rosso', certificazione: 'GOTS' }),
      riga('TS100-BLU', 'TS100', 'A blu', { colore: 'Blu' }),
    ];
    const [p] = unisciVarianti(righe);
    expect(p!.canonicalAttributes).toEqual({ sku: 'TS100' });
    expect(p!.varianti[0]!.attributiVariante).toEqual({ colore: 'Rosso', certificazione: 'GOTS' });
    expect(p!.varianti[1]!.attributiVariante).toEqual({ colore: 'Blu' });
  });

  it('un valore vuoto non finisce fra gli attributi di variante', () => {
    const righe = [
      riga('TS100-RED', 'TS100', 'A rossa', { colore: 'Rosso', nota: '' }),
      riga('TS100-BLU', 'TS100', 'A blu', { colore: 'Blu', nota: 'x' }),
    ];
    const [p] = unisciVarianti(righe);
    expect(p!.varianti[0]!.attributiVariante).toEqual({ colore: 'Rosso' });
    expect(p!.varianti[1]!.attributiVariante).toEqual({ colore: 'Blu', nota: 'x' });
  });

  it('lo SKU non viene mai confrontato come se fosse un fatto', () => {
    // È diverso per costruzione in ogni variante: trattarlo come un fatto lo
    // farebbe risultare «distintivo» e finirebbe fra gli attributi di variante,
    // duplicato accanto al campo che già lo porta.
    const righe = [
      riga('TS100-RED', 'TS100', 'A rossa', { colore: 'Rosso' }),
      riga('TS100-BLU', 'TS100', 'A blu', { colore: 'Blu' }),
    ];
    const [p] = unisciVarianti(righe);
    for (const v of p!.varianti) expect(Object.keys(v.attributiVariante)).not.toContain('sku');
    expect(p!.canonicalAttributes.sku).toBe('TS100');
  });

  it('la categoria del prodotto è quella prevalente fra le varianti', () => {
    const righe = [
      riga('TS100-RED', 'TS100', 'A rossa', {}, 'Magliette'),
      riga('TS100-BLU', 'TS100', 'A blu', {}, 'Magliette'),
      riga('TS100-NER', 'TS100', 'A nera', {}, 'Top'),
    ];
    expect(unisciVarianti(righe)[0]!.category).toBe('Magliette');
  });
});

describe('prefissoComune', () => {
  it('taglia sull’ultima parola intera', () => {
    expect(prefissoComune(['T-shirt Aurora Rossa', 'T-shirt Aurora Blu'])).toBe('T-shirt Aurora');
  });

  it('non consegna una parola tronca', () => {
    // «Aurora» e «Aureo» hanno in comune «Aur»: non è il nome di niente.
    expect(prefissoComune(['Sedia Aurora', 'Sedia Aureo'])).toBe('Sedia');
  });

  it('quando i nomi sono identici li restituisce interi', () => {
    expect(prefissoComune(['Sedia Aurora', 'Sedia Aurora'])).toBe('Sedia Aurora');
  });

  it('senza niente in comune non inventa un nome', () => {
    expect(prefissoComune(['Sedia', 'Tavolo'])).toBeNull();
  });

  it('un prefisso troppo corto non è un nome', () => {
    expect(prefissoComune(['AB rossa', 'AB blu'])).toBeNull();
  });

  it('serve più di un nome', () => {
    expect(prefissoComune(['Solo uno'])).toBeNull();
    expect(prefissoComune([])).toBeNull();
  });

  it('quando la parte comune non basta il prodotto tiene il nome della prima variante', () => {
    const righe = [
      riga('TS100-RED', 'TS100', 'Sedia', { colore: 'Rosso' }),
      riga('TS100-BLU', 'TS100', 'Tavolo', { colore: 'Blu' }),
    ];
    const [p] = unisciVarianti(righe);
    expect(p!.name).toBe('Sedia');
    expect(p!.nomeDerivato).toBe(false);
  });
});

describe('contaProdottiEVarianti', () => {
  it('dice quanti prodotti si pagano e quante righe erano', () => {
    const righe = [
      riga('TS100-RED', 'TS100', 'A rossa'),
      riga('TS100-BLU', 'TS100', 'A blu'),
      riga('TS100-NER', 'TS100', 'A nera'),
      riga('SINGOLO', null, 'Uno'),
    ];
    const conti = contaProdottiEVarianti(unisciVarianti(righe));
    expect(conti).toEqual({ prodotti: 2, varianti: 3, righe: 4 });
  });
});
