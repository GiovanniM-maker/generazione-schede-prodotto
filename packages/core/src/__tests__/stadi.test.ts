import { describe, expect, it } from 'vitest';
import {
  indiceStadio,
  leggiStadio,
  PASSI_DELLO_STADIO,
  passiVisibili,
  passoAttivo,
  primoPasso,
  prossimoStadio,
  stadioDelPasso,
  stadioDiRipresa,
  stadioPrecedente,
  STADI,
  SOTTOTITOLI,
  TITOLI,
} from '../stadi.js';

describe('i cinque stadi', () => {
  it('coprono tutti gli undici passi, una volta ciascuno', () => {
    // LA PROVA CHE CONTA sull'impianto: se un passo cadesse fuori, la sua
    // schermata smetterebbe di essere raggiungibile — e non se ne accorgerebbe
    // nessuno, perché il wizard continuerebbe a funzionare per tutti gli altri.
    const tutti = STADI.flatMap((s) => PASSI_DELLO_STADIO[s]);
    expect([...tutti].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(tutti).size).toBe(11);
  });

  it('hanno tutti un titolo e una riga che spiega cosa si fa', () => {
    // «Mappa» da solo non vuol dire niente a chi apre il wizard la prima
    // volta, e il titolo si legge PRIMA di sapere cosa conterrà.
    for (const s of STADI) {
      expect(TITOLI[s].length, s).toBeGreaterThan(3);
      expect(SOTTOTITOLI[s].length, s).toBeGreaterThan(20);
    }
  });
});

describe('dagli indirizzi già in giro', () => {
  it('ogni vecchio passo trova il suo stadio', () => {
    expect(stadioDelPasso(1)).toBe('prepara');
    expect(stadioDelPasso(2)).toBe('prepara');
    expect(stadioDelPasso(3)).toBe('carica');
    expect(stadioDelPasso(5)).toBe('carica');
    expect(stadioDelPasso(6)).toBe('mappa');
    expect(stadioDelPasso(8)).toBe('mappa');
    expect(stadioDelPasso(9)).toBe('ripara');
    expect(stadioDelPasso(10)).toBe('prova');
    expect(stadioDelPasso(11)).toBe('prova');
  });

  it('un numero fuori scala porta a un posto, non a un errore', () => {
    // Il wizard si scrive da solo `?passo=N` nella cronologia, quindi quel
    // numero finisce nei segnalibri e nei link che la gente si manda. Un
    // indirizzo storto non deve produrre una pagina rotta.
    expect(stadioDelPasso(0)).toBe('prepara');
    expect(stadioDelPasso(-4)).toBe('prepara');
    expect(stadioDelPasso(99)).toBe('prova');
    expect(stadioDelPasso(NaN)).toBe('prepara');
    expect(stadioDelPasso(7.4)).toBe('mappa');
  });

  it('il nome nuovo vince sul numero vecchio', () => {
    expect(leggiStadio('ripara', '3')).toBe('ripara');
    expect(leggiStadio('RIPARA', null)).toBe('ripara');
    expect(leggiStadio('  prova  ', null)).toBe('prova');
  });

  it('senza nome si legge il numero', () => {
    // È il caso vero: chi ha `?batch=…&passo=8` in un segnalibro deve
    // ritrovarsi dov'era, non all'inizio. Perdere quel punto vuol dire
    // rifare la strada — che è esattamente quello che quel link evitava.
    expect(leggiStadio(null, '8')).toBe('mappa');
    expect(leggiStadio('', '9')).toBe('ripara');
  });

  it('senza né l’uno né l’altro si comincia', () => {
    expect(leggiStadio(null, null)).toBe('prepara');
    expect(leggiStadio(undefined, undefined)).toBe('prepara');
    expect(leggiStadio('', '')).toBe('prepara');
    // Un nome sconosciuto non è un errore da mostrare: è un indirizzo scritto
    // male, e chi ci arriva vuole comunque usare il wizard.
    expect(leggiStadio('inventato', null)).toBe('prepara');
    expect(leggiStadio('inventato', 'zzz')).toBe('prepara');
  });
});

describe('cosa si vede dentro uno stadio', () => {
  it('senza foglio, l’accostamento delle colonne non c’è', () => {
    // Chi carica solo immagini non ha colonne da accostare.
    expect(passiVisibili('mappa', { haFoglio: false })).toEqual([6]);
    expect(passiVisibili('mappa', { haFoglio: true })).toEqual([6, 7, 8]);
  });

  it('gli altri stadi non cambiano con il foglio', () => {
    // È il punto per cui cinque è meglio di undici, al di là del conto: la
    // barra dell'avanzamento non cambia più lunghezza a metà strada. Prima
    // «5 di 11» diventava «5 di 9» mentre la si guardava.
    for (const s of STADI) {
      if (s === 'mappa') continue;
      expect(passiVisibili(s, { haFoglio: false }), s).toEqual(PASSI_DELLO_STADIO[s]);
      expect(passiVisibili(s, { haFoglio: true }), s).toEqual(PASSI_DELLO_STADIO[s]);
    }
  });

  it('nessuno stadio resta vuoto, con o senza foglio', () => {
    // Uno stadio senza niente dentro è un «Continua» che non chiede niente:
    // esattamente l'interruzione che si sta togliendo.
    for (const haFoglio of [true, false]) {
      for (const s of STADI) {
        expect(passiVisibili(s, { haFoglio }).length, `${s} · foglio=${haFoglio}`).toBeGreaterThan(0);
      }
    }
  });

  it('regge dati assenti', () => {
    expect(passiVisibili('mappa', undefined as never)).toEqual([6]);
  });
});

describe('andare avanti e indietro', () => {
  it('la catena è completa e finisce', () => {
    let s = STADI[0];
    const strada = [s];
    for (let i = 0; i < 20; i++) {
      const p = prossimoStadio(s);
      if (!p) break;
      s = p;
      strada.push(s);
    }
    expect(strada).toEqual([...STADI]);
    expect(prossimoStadio('prova')).toBeNull();
    expect(stadioPrecedente('prepara')).toBeNull();
  });

  it('avanti e indietro si annullano', () => {
    for (const s of STADI) {
      const p = prossimoStadio(s);
      if (p) expect(stadioPrecedente(p)).toBe(s);
    }
  });

  it('l’indice segue l’ordine dichiarato', () => {
    expect(indiceStadio('prepara')).toBe(0);
    expect(indiceStadio('prova')).toBe(STADI.length - 1);
  });

  it('il primo passo di uno stadio è quello che i caricamenti vanno a chiedere', () => {
    expect(primoPasso('mappa')).toBe(6);
    expect(primoPasso('prova')).toBe(10);
  });
});

describe('riprendere un lavoro lasciato a metà', () => {
  it('non si va oltre quello che i dati reggono', () => {
    // Il server risponde con un tetto: senza file caricato non si può saltare
    // alla prova, anche se l'indirizzo lo chiede. Prima questo controllo
    // c'era e il wizard «portava al 3 e poi tornava indietro»: qui il tetto è
    // applicato PRIMA di scegliere, non dopo.
    expect(stadioDiRipresa('prova', 3)).toBe('carica');
    expect(stadioDiRipresa('mappa', 4)).toBe('carica');
  });

  it('sotto il tetto si va dove chiede l’indirizzo', () => {
    expect(stadioDiRipresa('carica', 9)).toBe('carica');
    expect(stadioDiRipresa('ripara', 9)).toBe('ripara');
  });

  it('con i dati completi si arriva in fondo', () => {
    expect(stadioDiRipresa('prova', 11)).toBe('prova');
  });
});

describe('su cosa si sta lavorando dentro uno stadio', () => {
  it('sul primo pezzo ancora da fare', () => {
    // Accorpare non vuol dire impilare: dentro «Carica» la fonte si sceglie
    // PRIMA che ci sia qualcosa da caricare. Il comando in fondo deve essere
    // quello del pezzo che tocca adesso.
    expect(passoAttivo([3, 4, 5], { 3: false, 4: true, 5: false })).toBe(3);
    expect(passoAttivo([3, 4, 5], { 3: true, 4: true, 5: false })).toBe(5);
  });

  it('finito tutto, si va avanti dall’ultimo', () => {
    expect(passoAttivo([3, 4, 5], { 3: true, 4: true, 5: true })).toBe(5);
  });

  it('un pezzo di cui non si sa niente conta come da fare', () => {
    // `fatto` arriva da mezza dozzina di stati diversi: la voce mancante è il
    // caso normale, non un errore. Trattarla come «fatto» farebbe saltare il
    // comando di quel pezzo — cioè lo renderebbe irraggiungibile.
    expect(passoAttivo([1, 2], {})).toBe(1);
  });

  it('regge dati assenti', () => {
    expect(passoAttivo([], {})).toBeNull();
    expect(passoAttivo(undefined as never, undefined as never)).toBeNull();
  });
});
