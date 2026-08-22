import { describe, expect, it } from 'vitest';
import {
  collocaSuggerimento,
  ECO_MS,
  FRECCIA_PX,
  legaSuggerimento,
  MARGINE_PX,
  nomeAmmesso,
  RAGGIO_PX,
  ritardoApertura,
  RITARDO_APERTURA_MS,
  type Riquadro,
  type Vista,
} from '../suggerimento.js';

const VISTA: Vista = { larghezza: 1000, altezza: 800 };
const RIQUADRO = { larghezza: 200, altezza: 40 };
const ancora = (x: number, y: number, l = 32, a = 32): Riquadro => ({
  x,
  y,
  larghezza: l,
  altezza: a,
});

describe('dove va il riquadro', () => {
  it('sta dal lato preferito quando ci sta', () => {
    const c = collocaSuggerimento({
      ancora: ancora(500, 400),
      suggerimento: RIQUADRO,
      vista: VISTA,
      lato: 'sopra',
    });
    expect(c.lato).toBe('sopra');
    expect(c.y).toBe(400 - 8 - 40);
  });

  it('si ribalta quando dal lato preferito non ci sta', () => {
    // Il caso vero: l'icona in cima alla pagina. Senza ribaltamento il riquadro
    // finisce a y negativa, cioè fuori dalla vista — leggibile da nessuno.
    const c = collocaSuggerimento({
      ancora: ancora(500, 4),
      suggerimento: RIQUADRO,
      vista: VISTA,
      lato: 'sopra',
    });
    expect(c.lato).toBe('sotto');
    expect(c.y).toBeGreaterThan(4);
  });

  it('si ribalta sull’OPPOSTO anche quando di fianco ce n’è di più', () => {
    // IL CASO CHE DISTINGUE. Qui sopra il riquadro ci sta per QUATTRO pixel,
    // mentre a destra ne avanzano trecentocinquanta. Chi sceglie «il lato con
    // più spazio» mette il riquadro di fianco — e un suggerimento che doveva
    // comparire sotto e compare a destra si cerca con gli occhi dove non è.
    //
    // La prima versione di questa prova metteva l'ancora in fondo a una vista
    // alta: lì l'opposto era ANCHE il lato più largo, quindi restava verde pure
    // togliendo del tutto la regola. Verde per assenza di bersaglio.
    const c = collocaSuggerimento({
      ancora: ancora(400, 60),
      suggerimento: RIQUADRO,
      vista: { larghezza: 1000, altezza: 100 },
      lato: 'sotto',
    });
    expect(c.lato).toBe('sopra');
  });

  it('cambia asse solo quando nessuno dei due lati basta', () => {
    // Vista bassa e larga: né sopra né sotto ci sta. Restare sull'asse
    // verticale vorrebbe dire uscire comunque.
    const c = collocaSuggerimento({
      ancora: ancora(400, 20, 32, 40),
      suggerimento: RIQUADRO,
      vista: { larghezza: 1000, altezza: 90 },
      lato: 'sopra',
    });
    expect(c.lato === 'sinistra' || c.lato === 'destra').toBe(true);
  });

  it('non esce mai dal bordo laterale', () => {
    // L'ultima icona della barra, in fondo a destra: centrato sull'ancora il
    // riquadro sborderebbe di quasi cento pixel.
    const c = collocaSuggerimento({
      ancora: ancora(960, 400),
      suggerimento: RIQUADRO,
      vista: VISTA,
      lato: 'sopra',
    });
    expect(c.x + RIQUADRO.larghezza).toBeLessThanOrEqual(VISTA.larghezza - MARGINE_PX);
    expect(c.x).toBeGreaterThanOrEqual(MARGINE_PX);
  });

  it('quando il riquadro è più largo della vista resta ancorato al margine', () => {
    // Su un telefono da 320 px un suggerimento lungo non ci sta comunque: deve
    // partire dal margine sinistro, non da un numero negativo che ne nasconde
    // l'inizio — cioè proprio le prime parole.
    const c = collocaSuggerimento({
      ancora: ancora(100, 300),
      suggerimento: { larghezza: 400, altezza: 60 },
      vista: { larghezza: 320, altezza: 640 },
      lato: 'sopra',
    });
    expect(c.x).toBe(MARGINE_PX);
  });
});

describe('la punta', () => {
  it('sta sul centro dell’ancora, non su quello del riquadro', () => {
    // QUESTA È LA PROVA CHE CONTA. Quando il riquadro è stato spinto contro un
    // bordo i due centri non coincidono più, e una punta ferma a metà indica
    // un'icona diversa da quella che ha aperto il riquadro.
    const a = ancora(940, 400);
    const c = collocaSuggerimento({
      ancora: a,
      suggerimento: RIQUADRO,
      vista: VISTA,
      lato: 'sopra',
    });
    const centroAncora = a.x + a.larghezza / 2;
    expect(c.x + c.freccia).toBeCloseTo(centroAncora, 5);
    // E il riquadro è davvero stato spostato: senza questo la prova sopra
    // passerebbe anche con la punta fissa a metà.
    expect(c.freccia).not.toBeCloseTo(RIQUADRO.larghezza / 2, 5);
  });

  it('non entra negli angoli arrotondati', () => {
    const c = collocaSuggerimento({
      ancora: ancora(4, 400),
      suggerimento: RIQUADRO,
      vista: VISTA,
      lato: 'sopra',
    });
    expect(c.freccia).toBeGreaterThanOrEqual(RAGGIO_PX + FRECCIA_PX / 2);
    expect(c.freccia).toBeLessThanOrEqual(RIQUADRO.larghezza - RAGGIO_PX - FRECCIA_PX / 2);
  });

  it('su un riquadro minuscolo si mette in mezzo invece di impazzire', () => {
    const c = collocaSuggerimento({
      ancora: ancora(500, 400),
      suggerimento: { larghezza: 20, altezza: 20 },
      vista: VISTA,
      lato: 'sopra',
    });
    expect(c.freccia).toBe(10);
  });
});

describe('quando si apre', () => {
  it('col puntatore si aspetta', () => {
    expect(ritardoApertura({ motivo: 'puntatore', msDallUltimaChiusura: null })).toBe(
      RITARDO_APERTURA_MS,
    );
  });

  it('col fuoco e col tocco no', () => {
    // Chi è arrivato lì con Tab ha già dichiarato l'intenzione: farlo aspettare
    // altri quattro decimi è tempo tolto a chi ne ha già speso di più.
    expect(ritardoApertura({ motivo: 'fuoco', msDallUltimaChiusura: null })).toBe(0);
    expect(ritardoApertura({ motivo: 'tocco', msDallUltimaChiusura: null })).toBe(0);
  });

  it('dentro l’eco il vicino si apre subito', () => {
    expect(ritardoApertura({ motivo: 'puntatore', msDallUltimaChiusura: 100 })).toBe(0);
  });

  it('finita l’eco si torna ad aspettare', () => {
    expect(ritardoApertura({ motivo: 'puntatore', msDallUltimaChiusura: ECO_MS })).toBe(
      RITARDO_APERTURA_MS,
    );
    expect(ritardoApertura({ motivo: 'puntatore', msDallUltimaChiusura: ECO_MS + 500 })).toBe(
      RITARDO_APERTURA_MS,
    );
  });
});

describe('il nome accessibile', () => {
  it('non può contraddire il testo che si legge', () => {
    // Su un pulsante che dice «Duplica», `aria-label="Duplica per
    // personalizzare"` va bene — lo allunga. `aria-label="Copia"` no: chi
    // comanda a voce dice «premi Duplica» e non succede niente.
    expect(nomeAmmesso('Duplica', 'Duplica per personalizzare')).toBe(true);
    expect(nomeAmmesso('Duplica', 'Copia il preset')).toBe(false);
  });

  it('su un comando muto qualsiasi nome va bene', () => {
    expect(nomeAmmesso('', 'Rimuovi attributo')).toBe(true);
  });

  it('non si fa fermare da maiuscole e spazi', () => {
    expect(nomeAmmesso('  Sposta  su ', 'sposta su di una posizione')).toBe(true);
  });
});

describe('come il testo si lega all’ancora', () => {
  it('su un’icona muta diventa il NOME e sta lì sempre', () => {
    // `aria-describedby` qui non basterebbe: un comando senza nome resta
    // «pulsante» anche con la descrizione più bella del mondo.
    const l = legaSuggerimento({ id: 's1', testo: 'Archivia', ancoraParlante: false });
    expect(l.ruolo).toBe('nome');
    expect(l.ancora['aria-label']).toBe('Archivia');
    expect(l.ancora['aria-describedby']).toBeUndefined();
    expect(l.copiaPerLettori).toBe(false);
  });

  it('su un’ancora che parla resta una DESCRIZIONE', () => {
    // Il caso di «Obbligatorio» con la spiegazione lunga: se la spiegazione
    // diventasse il nome, la casella si chiamerebbe «Se manca, la scheda
    // risulta parziale…» e nessuno la troverebbe più.
    const l = legaSuggerimento({
      id: 's2',
      testo: 'Se manca, la scheda risulta parziale.',
      ancoraParlante: true,
    });
    expect(l.ruolo).toBe('descrizione');
    expect(l.ancora['aria-label']).toBeUndefined();
    expect(l.ancora['aria-describedby']).toBe('s2');
  });

  it('la descrizione ha bisogno di una copia sempre presente', () => {
    // Un `aria-describedby` che punta a un elemento montato solo mentre il
    // riquadro è aperto punta al nulla: il lettore di schermo cerca quell'id
    // quando arriva sul comando, e col puntatore non ci passa mai.
    expect(legaSuggerimento({ id: 'x', testo: 't', ancoraParlante: true }).copiaPerLettori).toBe(
      true,
    );
  });

  it('la descrizione si apre anche al tocco, il nome no', () => {
    // Sull'icona il tocco fa già la sua azione: mostrare il nome di una cosa
    // appena successa non serve a nessuno.
    expect(legaSuggerimento({ id: 'x', testo: 't', ancoraParlante: true }).apreAlTocco).toBe(true);
    expect(legaSuggerimento({ id: 'x', testo: 't', ancoraParlante: false }).apreAlTocco).toBe(false);
  });

  it('il riquadro visibile non viene mai letto due volte', () => {
    for (const parlante of [true, false]) {
      expect(
        legaSuggerimento({ id: 'x', testo: 't', ancoraParlante: parlante })
          .riquadroNascostoAiLettori,
      ).toBe(true);
    }
  });
});
