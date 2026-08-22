import { describe, expect, it } from 'vitest';
import {
  aggiungiRiscontro,
  chiudeIlFoglio,
  descriviCampo,
  durataDi,
  prossimoFuoco,
  serveIntervenire,
  DURATE,
  DURATA_ANNULLABILE_MS,
  DURATA_RISCONTRO_MS,
  FRAZIONE_CHIUSURA,
  MAX_RISCONTRI,
  VELOCITA_CHIUSURA_PX_S,
  type Riscontro,
} from '../interfaccia.js';

// ---------------------------------------------------------------------------
// Queste prove esistono perché i difetti che coprono NON si vedono guardando
// una schermata: si vedono solo premendo Tab per la ventesima volta, o usando
// un lettore di schermo, o trascinando un foglio col pollice su una rete lenta.
// Sono esattamente i casi che nessuno riprova a mano prima di un rilascio.
// ---------------------------------------------------------------------------

describe('l’anello del fuoco', () => {
  it('avanza di uno nel mezzo', () => {
    expect(prossimoFuoco(5, 2, false)).toBe(3);
    expect(prossimoFuoco(5, 2, true)).toBe(1);
  });

  it('dall’ultimo torna al primo, e viceversa', () => {
    // È l’anello: senza, si esce dalla finestra e si finisce a navigare la
    // pagina coperta dal velo — che è il difetto di tre overlay su quattro.
    expect(prossimoFuoco(5, 4, false)).toBe(0);
    expect(prossimoFuoco(5, 0, true)).toBe(4);
  });

  it('rientra dal capo giusto se il fuoco è fuori', () => {
    // Succede all’apertura della finestra, ogni volta.
    expect(prossimoFuoco(5, -1, false)).toBe(0);
    expect(prossimoFuoco(5, -1, true)).toBe(4);
    // E succede se qualcuno clicca sulla pagina sotto: l’indice diventa
    // maggiore del massimo, e senza questo caso si andrebbe fuori dall’array.
    expect(prossimoFuoco(5, 99, false)).toBe(0);
  });

  it('con un elemento solo resta su quello', () => {
    expect(prossimoFuoco(1, 0, false)).toBe(0);
    expect(prossimoFuoco(1, 0, true)).toBe(0);
  });

  it('senza elementi non mette a fuoco niente', () => {
    // Una finestra senza nulla di raggiungibile esiste davvero: un messaggio
    // che sta caricando. Il fuoco non deve andare da nessuna parte, ma nemmeno
    // scappare nella pagina sotto.
    expect(prossimoFuoco(0, -1, false)).toBeNull();
    expect(prossimoFuoco(-3, 0, false)).toBeNull();
  });

  it('non toglie il lavoro al browser quando il browser lo fa già bene', () => {
    // Nel mezzo dell’anello, Tab fa da solo la cosa giusta. Intervenire lì
    // significa chiamare preventDefault su ogni battuta, e questo rompe le
    // scorciatoie di chi naviga con una tastiera braille.
    expect(serveIntervenire(5, 2, false)).toBe(false);
    expect(serveIntervenire(5, 2, true)).toBe(false);
    // Ai due capi invece serve, o si esce.
    expect(serveIntervenire(5, 4, false)).toBe(true);
    expect(serveIntervenire(5, 0, true)).toBe(true);
    // E serve sempre quando il fuoco è fuori o non c’è niente.
    expect(serveIntervenire(5, -1, false)).toBe(true);
    expect(serveIntervenire(0, 0, false)).toBe(true);
  });
});

describe('il foglio trascinato', () => {
  const alto = 600;

  it('si chiude se lo si porta giù oltre la metà', () => {
    expect(chiudeIlFoglio({ spostamentoPx: alto * 0.6, altezzaPx: alto, durataMs: 2000 })).toBe(true);
  });

  it('torna su se lo si è appena mosso', () => {
    expect(chiudeIlFoglio({ spostamentoPx: 40, altezzaPx: alto, durataMs: 2000 })).toBe(false);
  });

  it('si chiude comunque se il gesto è veloce', () => {
    // IL CASO CHE SI DIMENTICA. Il gesto naturale per chiudere un foglio è un
    // colpetto secco verso il basso, non un trascinamento di trecento pixel.
    // Con la sola soglia di distanza quel colpetto non farebbe niente, e si
    // finirebbe a trascinare mezzo schermo ogni volta.
    const veloce = chiudeIlFoglio({ spostamentoPx: 80, altezzaPx: alto, durataMs: 100 });
    expect(veloce).toBe(true);
    expect((80 / 100) * 1000).toBeGreaterThan(VELOCITA_CHIUSURA_PX_S);
  });

  it('un trascinamento verso l’alto non chiude niente', () => {
    expect(chiudeIlFoglio({ spostamentoPx: -120, altezzaPx: alto, durataMs: 200 })).toBe(false);
    expect(chiudeIlFoglio({ spostamentoPx: 0, altezzaPx: alto, durataMs: 200 })).toBe(false);
  });

  it('non divide per zero con un’altezza assurda', () => {
    expect(() => chiudeIlFoglio({ spostamentoPx: 10, altezzaPx: 0, durataMs: 0 })).not.toThrow();
  });

  it('la soglia di distanza è quella dichiarata', () => {
    const sotto = alto * FRAZIONE_CHIUSURA - 1;
    const sopra = alto * FRAZIONE_CHIUSURA + 1;
    // Durata lunga: così decide la distanza e non la velocità.
    expect(chiudeIlFoglio({ spostamentoPx: sotto, altezzaPx: alto, durataMs: 5000 })).toBe(false);
    expect(chiudeIlFoglio({ spostamentoPx: sopra, altezzaPx: alto, durataMs: 5000 })).toBe(true);
  });
});

describe('i tempi del movimento', () => {
  it('l’uscita è più corta dell’entrata', () => {
    // Chi apre sta scoprendo qualcosa; chi chiude ha già deciso. Un’uscita
    // lunga quanto l’entrata fa sembrare l’interfaccia appiccicosa.
    expect(DURATE.uscita).toBeLessThan(DURATE.entrata);
  });

  it('la pressione è la cosa più rapida di tutte', () => {
    expect(DURATE.pressione).toBeLessThan(DURATE.rapida);
  });

  it('nessuna durata supera la soglia in cui si comincia a sentire', () => {
    // Sopra i 300 ms un’interfaccia non sembra più animata: sembra lenta.
    for (const [nome, ms] of Object.entries(DURATE)) {
      expect(ms, nome).toBeLessThanOrEqual(300);
      expect(ms, nome).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('il cablaggio di un campo', () => {
  it('senza aiuto né errore non aggiunge niente', () => {
    const d = descriviCampo({ id: 'nome' });
    expect(d.controllo).toEqual({ id: 'nome' });
    expect(d.idAiuto).toBeNull();
    expect(d.idErrore).toBeNull();
  });

  it('collega l’aiuto', () => {
    const d = descriviCampo({ id: 'nome', aiuto: 'Serve a ritrovarlo dopo.' });
    expect(d.controllo['aria-describedby']).toBe('nome-aiuto');
    expect(d.controllo['aria-invalid']).toBeUndefined();
  });

  it('marca il campo come non valido e collega l’errore', () => {
    // `aria-invalid` non compare NEMMENO UNA VOLTA nel prodotto di oggi: chi
    // usa un lettore di schermo non sa quale campo ha sbagliato.
    const d = descriviCampo({ id: 'prezzo', errore: 'Ha due virgole.' });
    expect(d.controllo['aria-invalid']).toBe(true);
    expect(d.controllo['aria-describedby']).toBe('prezzo-errore');
  });

  it('con entrambi, l’errore viene letto per primo', () => {
    // L’ordine conta: il lettore di schermo li legge come sono scritti, e chi
    // ha appena sbagliato vuole sapere cosa è andato storto prima di
    // risentirsi spiegare come si compila il campo.
    const d = descriviCampo({ id: 'prezzo', aiuto: 'Usa la virgola.', errore: 'Ne hai messe due.' });
    expect(d.controllo['aria-describedby']).toBe('prezzo-errore prezzo-aiuto');
  });

  it('l’aiuto resta anche quando c’è l’errore', () => {
    // La tentazione è togliere l’aiuto per far spazio al messaggio. Ma è
    // proprio nel momento dell’errore che l’istruzione serve.
    const d = descriviCampo({ id: 'prezzo', aiuto: 'Usa la virgola.', errore: 'Ne hai messe due.' });
    expect(d.idAiuto).toBe('prezzo-aiuto');
    expect(d.idErrore).toBe('prezzo-errore');
  });

  it('dice quando è obbligatorio', () => {
    const d = descriviCampo({ id: 'nome', obbligatorio: true });
    expect(d.controllo['aria-required']).toBe(true);
  });

  it('gli identificativi derivano da quello del campo', () => {
    // Due campi nella stessa pagina non devono condividere l’id del messaggio,
    // o il lettore ne annuncerebbe uno solo per entrambi.
    const a = descriviCampo({ id: 'campo-a', errore: 'x' });
    const b = descriviCampo({ id: 'campo-b', errore: 'y' });
    expect(a.idErrore).not.toBe(b.idErrore);
  });
});

describe('la pila dei riscontri', () => {
  const r = (id: string, tono: Riscontro['tono'] = 'riuscito'): Riscontro => ({
    id,
    tono,
    titolo: id,
    durataMs: 5000,
  });

  it('tiene al massimo tre riscontri', () => {
    let pila: Riscontro[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) pila = aggiungiRiscontro(pila, r(id));
    expect(pila).toHaveLength(MAX_RISCONTRI);
  });

  it('butta i più vecchi, non i più nuovi', () => {
    // Il riscontro appena comparso è la risposta all’ultima cosa fatta: è
    // l’unico che si stava aspettando.
    let pila: Riscontro[] = [];
    for (const id of ['a', 'b', 'c', 'd']) pila = aggiungiRiscontro(pila, r(id));
    expect(pila.map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });

  it('non butta un errore per fare spazio a un successo', () => {
    // Tre errori a schermo sono brutti. Un errore cancellato da un «fatto!» è
    // peggio: sparisce l’unica traccia di una cosa che non è andata.
    let pila: Riscontro[] = [r('e1', 'errore'), r('e2', 'errore'), r('e3', 'errore')];
    pila = aggiungiRiscontro(pila, r('ok'));
    expect(pila.map((x) => x.id)).toEqual(['e1', 'e2', 'e3', 'ok']);
  });

  it('butta il vecchio riuscito e tiene l’errore', () => {
    let pila: Riscontro[] = [r('vecchio'), r('boom', 'errore'), r('altro')];
    pila = aggiungiRiscontro(pila, r('nuovo'));
    expect(pila.map((x) => x.id)).toEqual(['boom', 'altro', 'nuovo']);
  });

  it('regge una pila vuota o assente', () => {
    expect(aggiungiRiscontro([], r('a'))).toHaveLength(1);
    expect(aggiungiRiscontro(undefined as unknown as Riscontro[], r('a'))).toHaveLength(1);
  });
});

describe('quanto resta a schermo un riscontro', () => {
  it('un errore non scade mai', () => {
    // Un errore che sparisce da solo è un errore che qualcuno non ha letto — e
    // siccome era l’unico posto in cui era scritto, da quel momento non esiste.
    expect(durataDi({ tono: 'errore' })).toBeNull();
  });

  it('quello con «Annulla» resta il doppio', () => {
    // L’utilità di quel pulsante è tutta nel tempo in cui esiste. Cinque
    // secondi bastano a leggere «3 schede accettate»; non bastano ad
    // accorgersi che erano quelle sbagliate e trovare il pulsante.
    expect(durataDi({ tono: 'riuscito', annullabile: true })).toBe(DURATA_ANNULLABILE_MS);
    expect(durataDi({ tono: 'riuscito' })).toBe(DURATA_RISCONTRO_MS);
    expect(DURATA_ANNULLABILE_MS).toBeGreaterThan(DURATA_RISCONTRO_MS);
  });

  it('l’errore non scade nemmeno se annullabile', () => {
    expect(durataDi({ tono: 'errore', annullabile: true })).toBeNull();
  });
});
