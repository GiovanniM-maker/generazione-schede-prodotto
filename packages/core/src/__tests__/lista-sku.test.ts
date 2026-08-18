import { describe, expect, it } from 'vitest';
import {
  MAX_RIGHE_LISTA,
  analizzaListaIncollata,
  livelloDelDominio,
  righeDaTabella,
  suggerisciColonneListaSku,
} from '../lista-sku.js';

// ---------------------------------------------------------------------------
// La lista incollata, e la fiducia nei domini.
//
// La seconda metà di questo file è la più delicata di tutta la funzione: il
// livello di un dominio decide se un fatto trovato lì può autorizzare la parola
// «certificato» in una scheda. Per questo non esiste nessun elenco di «siti
// buoni» scritto da noi — sarebbe una nostra opinione presentata come un fatto.
// Il livello viene solo da cose che il cliente ha dichiarato.
// ---------------------------------------------------------------------------

describe('analizzaListaIncollata', () => {
  it('legge un codice per riga', () => {
    const r = analizzaListaIncollata('AB-1\nAB-2\n\n  AB-3  ');
    expect(r.map((x) => x.sku)).toEqual(['AB-1', 'AB-2', 'AB-3']);
  });

  it('accetta «codice; marca», che è come si incolla da un foglio', () => {
    const r = analizzaListaIncollata('AB-1; Ferrini\nAB-2,Bertoli');
    expect(r[0]).toMatchObject({ sku: 'AB-1', marca: 'Ferrini' });
    expect(r[1]).toMatchObject({ sku: 'AB-2', marca: 'Bertoli' });
  });

  it('lo stesso codice due volte è una riga sola', () => {
    // Due volte vuol dire due ricerche pagate e due prodotti con lo stesso SKU.
    const r = analizzaListaIncollata('AB-1\nab-1\nAB-1');
    expect(r).toHaveLength(1);
  });

  it('una riga senza codice non diventa un prodotto', () => {
    expect(analizzaListaIncollata('\n ; Ferrini \n\n')).toEqual([]);
  });

  it('si ferma al tetto invece di accettare un file intero', () => {
    const molte = Array.from({ length: MAX_RIGHE_LISTA + 50 }, (_, i) => `AB-${i}`).join('\n');
    expect(analizzaListaIncollata(molte)).toHaveLength(MAX_RIGHE_LISTA);
  });

  it('un testo vuoto non esplode', () => {
    expect(analizzaListaIncollata('')).toEqual([]);
    expect(analizzaListaIncollata('   ')).toEqual([]);
  });
});

describe('livelloDelDominio', () => {
  it('il sito che porta il nome della marca dichiarata è il produttore', () => {
    expect(livelloDelDominio('ferrini.it', 'Ferrini')).toBe('produttore');
    expect(livelloDelDominio('www.ferrini.com', 'Ferrini S.r.l.')).toBe('produttore');
    expect(livelloDelDominio('shop.ferrini.it', 'Ferrini')).toBe('produttore');
  });

  it('un dominio indicato dal cliente come ambito è un fornitore', () => {
    // Si fida lui, ce ne fidiamo noi: è una dichiarazione, non una nostra idea.
    expect(livelloDelDominio('grossista.it', null, ['grossista.it'])).toBe('fornitore');
    expect(livelloDelDominio('catalogo.grossista.it', null, ['grossista.it'])).toBe('fornitore');
  });

  it('tutto il resto è terza parte', () => {
    expect(livelloDelDominio('marketplace.com', 'Ferrini', ['grossista.it'])).toBe('terza-parte');
  });

  it('senza marca e senza ambito, tutto è terza parte', () => {
    // È il punto: un livello che non si può verificare non concede fiducia. Se
    // qui uscisse «sconosciuto» trattato come buono, la concessione la starebbe
    // facendo il caso.
    expect(livelloDelDominio('qualsiasi.it', null, [])).toBe('terza-parte');
  });

  it('una marca troppo corta non promuove mezza internet a produttore', () => {
    // «Bo» combacerebbe con `bo-shop.it`, `bologna.it`, `bose.com`… e
    // «produttore» è il livello che autorizza i claim sensibili.
    expect(livelloDelDominio('bo-qualcosa.it', 'Bo')).toBe('terza-parte');
  });

  it('un rivenditore che porta il nome della marca non è il produttore', () => {
    // Tre casi che si assomigliano e vogliono dire cose diverse. Il confronto
    // approssimativo — «il nome della marca compare nel dominio» — prometterebbe
    // gli ultimi due come siti ufficiali, ed è il livello che autorizza
    // «certificato»: vorrebbe dire far firmare al cliente una dichiarazione
    // sulla parola di un rivenditore.
    expect(livelloDelDominio('mercatoferrini.com', 'Ferrini')).toBe('terza-parte');
    expect(livelloDelDominio('ferrini.marketplace.com', 'Ferrini')).toBe('terza-parte');
    expect(livelloDelDominio('ferrini-outlet.com', 'Ferrini')).toBe('terza-parte');
  });

  it('il produttore batte l’ambito dichiarato', () => {
    expect(livelloDelDominio('ferrini.it', 'Ferrini', ['ferrini.it'])).toBe('produttore');
  });

  it('un dominio vuoto o storto è terza parte, non produttore', () => {
    expect(livelloDelDominio('', 'Ferrini')).toBe('terza-parte');
    expect(livelloDelDominio('   ', 'Ferrini')).toBe('terza-parte');
  });
});

// ---------------------------------------------------------------------------
// Il caricamento da file.
//
// La mappatura la dichiara l'utente; qui si suggerisce soltanto. Sbagliare
// colonna vuol dire mandare a cercare online la parola «Rosso» invece del
// codice articolo — e la ricerca si paga.
// ---------------------------------------------------------------------------

describe('suggerisciColonneListaSku', () => {
  it('riconosce le intestazioni normali di un listino', () => {
    const m = suggerisciColonneListaSku(['SKU', 'Modello', 'Marca', 'Colore', 'Sito']);
    expect(m).toEqual({
      sku: 'SKU',
      codiceModello: 'Modello',
      marca: 'Marca',
      attributoVariante: 'Colore',
      ambito: 'Sito',
    });
  });

  it('non si fa fermare da maiuscole, accenti, punti e trattini', () => {
    const m = suggerisciColonneListaSku(['Cod. Articolo', 'BRAND']);
    expect(m.sku).toBe('Cod. Articolo');
    expect(m.marca).toBe('BRAND');
  });

  it('restituisce l’intestazione ORIGINALE, non quella normalizzata', () => {
    // È la chiave con cui si leggeranno le righe: normalizzandola non
    // troverebbe più niente.
    expect(suggerisciColonneListaSku(['Cod. Articolo']).sku).toBe('Cod. Articolo');
  });

  it('senza una colonna riconoscibile lo SKU resta vuoto', () => {
    // NON prende la prima colonna: una colonna a caso manderebbe a cercare
    // online i nomi dei colori, e ogni ricerca si paga.
    const m = suggerisciColonneListaSku(['Pippo', 'Pluto']);
    expect(m.sku).toBe('');
  });

  it('quello che non c’è resta nullo', () => {
    const m = suggerisciColonneListaSku(['SKU']);
    expect(m.marca).toBeNull();
    expect(m.codiceModello).toBeNull();
    expect(m.ambito).toBeNull();
  });

  it('un elenco vuoto non esplode', () => {
    expect(suggerisciColonneListaSku([]).sku).toBe('');
  });
});

describe('righeDaTabella', () => {
  const foglio = [
    { SKU: 'TS100-RED', Modello: 'TS100', Marca: 'Ferrini', Colore: 'Rosso', Sito: 'ferrini.it' },
    { SKU: 'TS100-BLU', Modello: 'TS100', Marca: 'Ferrini', Colore: 'Blu', Sito: 'ferrini.it, grossista.it' },
  ];
  const mappatura = {
    sku: 'SKU',
    codiceModello: 'Modello',
    marca: 'Marca',
    attributoVariante: 'Colore',
    ambito: 'Sito',
  };

  it('porta ogni colonna al suo posto', () => {
    const r = righeDaTabella(foglio, mappatura);
    expect(r[0]).toEqual({
      sku: 'TS100-RED',
      codiceModello: 'TS100',
      marca: 'Ferrini',
      attributoVariante: 'Rosso',
      domini: ['ferrini.it'],
    });
  });

  it('spezza l’ambito su virgole e spazi', () => {
    expect(righeDaTabella(foglio, mappatura)[1]!.domini).toEqual(['ferrini.it', 'grossista.it']);
  });

  it('le colonne non mappate restano nulle, non vuote a caso', () => {
    const r = righeDaTabella(foglio, { sku: 'SKU' });
    expect(r[0]).toMatchObject({ marca: null, codiceModello: null, attributoVariante: null, domini: [] });
  });

  it('una riga senza SKU viene saltata, non riempita', () => {
    // Un prodotto senza codice non si può cercare e non si può riagganciare al
    // gestionale del cliente: inventargli un codice è peggio che scartarlo.
    const r = righeDaTabella([{ SKU: '   ', Marca: 'Ferrini' }, { SKU: 'AB-1' }], { sku: 'SKU' });
    expect(r.map((x) => x.sku)).toEqual(['AB-1']);
  });

  it('lo stesso codice due volte è una riga sola', () => {
    const r = righeDaTabella([{ SKU: 'AB-1' }, { SKU: 'ab-1' }], { sku: 'SKU' });
    expect(r).toHaveLength(1);
  });

  it('senza colonna SKU non si importa niente', () => {
    expect(righeDaTabella(foglio, { sku: '' })).toEqual([]);
  });

  it('si ferma al tetto', () => {
    const molte = Array.from({ length: MAX_RIGHE_LISTA + 10 }, (_, i) => ({ SKU: `AB-${i}` }));
    expect(righeDaTabella(molte, { sku: 'SKU' })).toHaveLength(MAX_RIGHE_LISTA);
  });
});
