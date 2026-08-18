import { describe, expect, it } from 'vitest';
import { MAX_RIGHE_LISTA, analizzaListaIncollata, livelloDelDominio } from '../lista-sku.js';

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
