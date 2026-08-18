import { describe, expect, it } from 'vitest';
import {
  ordinaPerLaScelta,
  urlAmmesso,
  valutaConferma,
  type CandidatoSalvato,
} from '../conferma-identita.js';

// ---------------------------------------------------------------------------
// La conferma dell'identità.
//
// La prova più importante di questo file non riguarda l'usabilità: riguarda il
// fatto che la conferma arriva dal browser. Senza il controllo che l'indirizzo
// sia uno di quelli proposti, chi manda la richiesta sceglierebbe cosa far
// scaricare al nostro server — un indirizzo interno, un file enorme — con le
// nostre credenziali di rete e a spese nostre.
// ---------------------------------------------------------------------------

function cand(url: string, over: Partial<CandidatoSalvato> = {}): CandidatoSalvato {
  return {
    url,
    titolo: 'Sedia Aurora',
    marca: 'Ferrini',
    dominio: 'ferrini.it',
    livello: 'produttore',
    prezzo: '189,00',
    immagine: null,
    punteggio: 0.9,
    ...over,
  };
}

const CANDIDATI = [
  cand('https://ferrini.it/p/sed-aur-01'),
  cand('https://bertoli.it/p/1', { dominio: 'bertoli.it', marca: 'Bertoli', livello: 'terza-parte', punteggio: 0.6 }),
];

describe('urlAmmesso', () => {
  it('accetta un indirizzo che era fra i candidati', () => {
    expect(urlAmmesso(CANDIDATI, 'https://ferrini.it/p/sed-aur-01')).toBe(true);
  });

  it('rifiuta un indirizzo che non c’era', () => {
    expect(urlAmmesso(CANDIDATI, 'https://altro.com/qualsiasi')).toBe(false);
  });

  it('rifiuta gli indirizzi interni e gli schemi non web', () => {
    // Il caso per cui il controllo esiste: senza, questo diventa un modo per
    // far leggere al nostro server quello che vuole chi manda la richiesta.
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/api/interno',
      'file:///etc/passwd',
      'ftp://ferrini.it/p/sed-aur-01',
    ]) {
      expect(urlAmmesso(CANDIDATI, url)).toBe(false);
    }
  });

  it('non si fa fermare da differenze che non cambiano la pagina', () => {
    // Il browser normalizza gli indirizzi: una conferma legittima non deve
    // fallire per una barra finale o per un «www».
    for (const url of [
      'https://www.ferrini.it/p/sed-aur-01',
      'https://ferrini.it/p/sed-aur-01/',
      'https://FERRINI.it/p/sed-aur-01',
    ]) {
      expect(urlAmmesso(CANDIDATI, url)).toBe(true);
    }
  });

  it('due query diverse sono due pagine diverse', () => {
    const conQuery = [cand('https://negozio.it/p?id=12')];
    expect(urlAmmesso(conQuery, 'https://negozio.it/p?id=12')).toBe(true);
    expect(urlAmmesso(conQuery, 'https://negozio.it/p?id=13')).toBe(false);
  });

  it('su un indirizzo storto o vuoto risponde no, non esplode', () => {
    expect(urlAmmesso(CANDIDATI, 'non un url')).toBe(false);
    expect(urlAmmesso(CANDIDATI, '')).toBe(false);
  });
});

describe('valutaConferma', () => {
  it('una scelta valida vale quanto una certezza', () => {
    // Una persona che ha guardato i candidati affiancati e ne ha indicato uno è
    // la prova migliore che possiamo avere. Lasciare il punteggio basso vorrebbe
    // dire mandare fra i dubbi campi appena verificati: chiedere due volte.
    const e = valutaConferma(CANDIDATI, { url: 'https://ferrini.it/p/sed-aur-01' });
    expect(e).toEqual({
      azione: 'accetta',
      url: 'https://ferrini.it/p/sed-aur-01',
      punteggioIdentita: 1,
    });
  });

  it('scartare tutto è una risposta, e va accettata', () => {
    expect(valutaConferma(CANDIDATI, { scarta: true })).toEqual({ azione: 'scarta' });
  });

  it('lo scarto vince anche se arriva insieme a un URL', () => {
    // Se l'interfaccia manda tutti e due, l'intenzione esplicita è lo scarto:
    // scaricare comunque una pagina sarebbe fare il contrario di quel che si
    // chiede.
    expect(valutaConferma(CANDIDATI, { scarta: true, url: 'https://ferrini.it/p/sed-aur-01' })).toEqual({
      azione: 'scarta',
    });
  });

  it('un URL non proposto viene rifiutato, con il motivo', () => {
    const e = valutaConferma(CANDIDATI, { url: 'https://altro.com/x' });
    expect(e.azione).toBe('rifiuta');
    if (e.azione !== 'rifiuta') return;
    expect(e.motivo).toMatch(/non è fra quelle proposte/i);
  });

  it('senza scelta non si fa niente', () => {
    expect(valutaConferma(CANDIDATI, {}).azione).toBe('rifiuta');
    expect(valutaConferma(CANDIDATI, { url: '   ' }).azione).toBe('rifiuta');
  });

  it('una riga senza candidati non si può confermare', () => {
    const e = valutaConferma([], { url: 'https://ferrini.it/p/sed-aur-01' });
    expect(e.azione).toBe('rifiuta');
  });
});

describe('ordinaPerLaScelta', () => {
  it('prima i più forti', () => {
    const o = ordinaPerLaScelta([
      cand('https://a.it/1', { punteggio: 0.5 }),
      cand('https://b.it/1', { punteggio: 0.9 }),
    ]);
    expect(o[0]!.url).toBe('https://b.it/1');
  });

  it('a parità di punteggio viene prima la fonte ufficiale', () => {
    // Chi scorre in fretta guarda le prime due: mettere davanti un marketplace
    // quando c'è il sito del produttore vuol dire far scegliere la fonte
    // peggiore per stanchezza.
    //
    // Gli indirizzi sono scelti perché l'ordine alfabetico dica il CONTRARIO
    // («alfa» prima di «zeta»): con due domini qualsiasi la prova passava anche
    // togliendo il confronto sul livello, cioè non difendeva niente — la
    // risposta giusta usciva per caso dall'ultimo criterio.
    const o = ordinaPerLaScelta([
      cand('https://alfa-market.com/1', { livello: 'terza-parte', punteggio: 0.7 }),
      cand('https://zeta-produttore.it/1', { livello: 'produttore', punteggio: 0.7 }),
    ]);
    expect(o[0]!.livello).toBe('produttore');
    expect(o[0]!.url).toBe('https://zeta-produttore.it/1');
  });

  it('l’ordine è sempre lo stesso a parità di tutto', () => {
    // Due schermate diverse per gli stessi dati fanno dubitare di quello che si
    // sta guardando.
    const uno = [cand('https://b.it/1', { punteggio: 0.7 }), cand('https://a.it/1', { punteggio: 0.7 })];
    expect(ordinaPerLaScelta(uno).map((c) => c.url)).toEqual(
      ordinaPerLaScelta([...uno].reverse()).map((c) => c.url),
    );
  });

  it('non modifica l’elenco che riceve', () => {
    const originale = [cand('https://a.it/1', { punteggio: 0.5 }), cand('https://b.it/1', { punteggio: 0.9 })];
    const copia = [...originale];
    ordinaPerLaScelta(originale);
    expect(originale).toEqual(copia);
  });
});
