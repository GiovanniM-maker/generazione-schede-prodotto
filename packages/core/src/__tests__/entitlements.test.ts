import { describe, expect, it } from 'vitest';
import {
  creditiInScadenza,
  pianoAttuale,
  riepilogoAssistente,
  verificaBatch,
  verificaCrediti,
  type Diritti,
  type Pacchetto,
} from '../entitlements.js';

// ---------------------------------------------------------------------------
// Le frasi che dicono a qualcuno che non può fare una cosa.
//
// Sono le più difficili da scrivere e le più facili da sbagliare, perché il
// modo comodo è nasconderle: pulsante grigio, nessuna spiegazione, e l'utente
// che clicca tre volte prima di capire. Qui si pretende il contrario — il
// numero esatto che manca, e cosa comprare per coprirlo.
//
// E si pretende che nessuna frase nomini qualcosa che non esiste: se il listino
// è vuoto, non si dice quale pacchetto prendere.
// ---------------------------------------------------------------------------

const ADESSO = '2026-08-14T12:00:00.000Z';

const PACCHETTI: Pacchetto[] = [
  { chiave: 'pack_50', nome: 'Pacchetto 50', crediti: 50, prezzoCent: 2900, valuta: 'EUR' },
  { chiave: 'pack_200', nome: 'Pacchetto 200', crediti: 200, prezzoCent: 9900, valuta: 'EUR' },
  { chiave: 'pack_500', nome: 'Pacchetto 500', crediti: 500, prezzoCent: 19900, valuta: 'EUR' },
];

function diritti(p: Partial<Diritti> = {}): Diritti {
  return {
    saldo: 0,
    lotti: [],
    abbonamento: null,
    omaggioFinoAl: null,
    assistente: null,
    pacchetti: PACCHETTI,
    offertaAbbonamento: null,
    adesso: ADESSO,
    ...p,
  };
}

describe('bastano i crediti?', () => {
  it('quando bastano, dice quanti ne restano', () => {
    const e = verificaCrediti(diritti({ saldo: 500 }), 320);
    expect(e.ok).toBe(true);
    expect(e.mancano).toBe(0);
    expect(e.frase).toBe('320 crediti su 500 crediti disponibili: te ne restano 180.');
  });

  it('quando bastano esatti, non promette un resto che non c’è', () => {
    const e = verificaCrediti(diritti({ saldo: 320 }), 320);
    expect(e.ok).toBe(true);
    expect(e.frase).toContain('li usi tutti');
    expect(e.frase).not.toContain('restano');
  });

  it('quando non bastano, dice quanti ne mancano e quale pacchetto li copre', () => {
    // Il caso delle cinquecento righe: è quello che oggi si scopre dal server,
    // dopo aver premuto, con un 402.
    const e = verificaCrediti(diritti({ saldo: 320 }), 500);
    expect(e.ok).toBe(false);
    expect(e.mancano).toBe(180);
    expect(e.pacchetto?.chiave).toBe('pack_200');
    expect(e.quantiPacchetti).toBe(1);
    expect(e.frase).toBe('Servono 500 crediti e ne hai 320: ne mancano 180. Il pacchetto da 200 li copre.');
  });

  it('sceglie il pacchetto più piccolo che basta, non il più caro', () => {
    // Un ammanco di 40 si copre col pacchetto da 50. Suggerire quello da 500
    // sarebbe vendere, non aiutare.
    const e = verificaCrediti(diritti({ saldo: 10 }), 50);
    expect(e.mancano).toBe(40);
    expect(e.pacchetto?.chiave).toBe('pack_50');
  });

  it('se nemmeno il più grande basta, dice quanti ne servono', () => {
    const e = verificaCrediti(diritti({ saldo: 0 }), 1200);
    expect(e.pacchetto?.chiave).toBe('pack_500');
    expect(e.quantiPacchetti).toBe(3);
    expect(e.frase).toContain('Il pacchetto più grande è da 500: ne servono 3.');
  });

  it('senza listino non nomina nessun pacchetto', () => {
    // Un consiglio d'acquisto che rimanda a uno scaffale vuoto è peggio di
    // nessun consiglio: manda l'utente a cercare una cosa che non c'è.
    const e = verificaCrediti(diritti({ saldo: 0, pacchetti: [] }), 100);
    expect(e.pacchetto).toBeNull();
    expect(e.frase).toContain('Aggiungi crediti dalla pagina Fatturazione');
    expect(e.frase).not.toMatch(/pacchetto da/i);
  });

  it('zero prodotti idonei non è «crediti insufficienti»', () => {
    // Sono due problemi diversi con due rimedi diversi, e confonderli manda a
    // comprare crediti chi ha invece un file da sistemare.
    const e = verificaCrediti(diritti({ saldo: 500 }), 0);
    expect(e.ok).toBe(false);
    expect(e.frase).toContain('Nessun prodotto idoneo');
    expect(e.frase).not.toMatch(/mancan|pacchetto/i);
  });

  it('non suggerisce mai un abbonamento a chi voleva finire un batch', () => {
    // L'abbonamento sta in un campo suo apposta. Se un giorno qualcuno lo
    // rimettesse fra i pacchetti, davanti a un ammanco di 180 crediti il
    // prodotto proporrebbe un canone mensile — cioè venderebbe una cosa per
    // un'altra, nel momento in cui la persona ha fretta e legge poco.
    const e = verificaCrediti(
      diritti({
        saldo: 320,
        offertaAbbonamento: {
          chiave: 'subscription',
          nome: 'Abbonamento mensile',
          crediti: 150,
          prezzoCent: 9900,
          valuta: 'EUR',
        },
      }),
      440,
    );
    // Ne mancano 120. L'abbonamento da 150 li coprirebbe ed è più piccolo del
    // pacchetto da 200: se finisse nell'elenco, verrebbe scelto lui.
    expect(e.mancano).toBe(120);
    expect(e.pacchetto?.chiave).toBe('pack_200');
    expect(e.frase).not.toMatch(/abbonament/i);
  });

  it('un credito solo si dice al singolare', () => {
    expect(verificaCrediti(diritti({ saldo: 10 }), 1).frase).toContain('1 credito su');
  });
});

describe('il batch, prima di avviarlo', () => {
  it('blocca su quello che è certo', () => {
    const e = verificaBatch(diritti({ saldo: 320 }), { idonei: 500, soloImmagini: 0 });
    expect(e.verifica.ok).toBe(false);
    expect(e.avvisoSoloImmagini).toBeNull();
  });

  it('avvisa su quello che è possibile, senza bloccare', () => {
    // 300 idonei stanno dentro i 320 crediti; i 50 con le sole foto potrebbero
    // diventarlo dopo la lettura delle etichette, e allora servirebbero 350.
    const e = verificaBatch(diritti({ saldo: 320 }), { idonei: 300, soloImmagini: 50 });
    expect(e.verifica.ok).toBe(true);
    expect(e.avvisoSoloImmagini).toContain('fino a 350 crediti');
    expect(e.avvisoSoloImmagini).toContain('30 più di quanti ne hai');
  });

  it('se il saldo copre anche il caso peggiore, non avvisa', () => {
    // Un avviso che si accende quando non serve è un avviso che si impara a
    // ignorare quando serve.
    const e = verificaBatch(diritti({ saldo: 500 }), { idonei: 300, soloImmagini: 50 });
    expect(e.avvisoSoloImmagini).toBeNull();
  });

  it('zero idonei ma delle foto da leggere non è un blocco', () => {
    // È il caso di mezzo settore alimentare: un catalogo di sole fotografie di
    // etichette. Bloccare qui fermerebbe proprio il lavoro per cui la lettura
    // delle etichette esiste — e con un messaggio falso, per giunta, perché
    // «niente da generare» non è vero.
    const e = verificaBatch(diritti({ saldo: 40 }), { idonei: 0, soloImmagini: 30 });
    expect(e.verifica.ok).toBe(true);
    expect(e.verifica.frase).toContain('30 prodotti con le sole foto');
    expect(e.verifica.frase).not.toContain('Nessun prodotto idoneo');
    expect(e.avvisoSoloImmagini).toBeNull();
  });

  it('zero idonei e nessuna foto: si dice cosa manca, non «compra crediti»', () => {
    const e = verificaBatch(diritti({ saldo: 500 }), { idonei: 0, soloImmagini: 0 });
    expect(e.verifica.ok).toBe(false);
    expect(e.verifica.frase).toContain('uno SKU e almeno due attributi');
    expect(e.verifica.frase).not.toMatch(/pacchetto|mancan/i);
  });

  it('zero idonei, tante foto e pochi crediti: avvisa ma lascia partire', () => {
    const e = verificaBatch(diritti({ saldo: 10 }), { idonei: 0, soloImmagini: 30 });
    expect(e.verifica.ok).toBe(true);
    expect(e.avvisoSoloImmagini).toContain('servirebbero 30 crediti, 20 più di quanti ne hai');
  });

  it('senza prodotti solo-immagini non li nomina', () => {
    const e = verificaBatch(diritti({ saldo: 10 }), { idonei: 5, soloImmagini: 0 });
    expect(e.avvisoSoloImmagini).toBeNull();
  });
});

describe('il piano', () => {
  it('abbonato: dice quanti crediti al mese e quando si rinnova', () => {
    const p = pianoAttuale(
      diritti({
        abbonamento: {
          stato: 'active',
          creditiMensili: 150,
          rinnovaIl: '2026-09-13T00:00:00.000Z',
          disdettoAFineCiclo: false,
        },
      }),
    );
    expect(p.chiave).toBe('abbonamento');
    expect(p.dettaglio).toBe('150 crediti al mese. Si rinnova il 13 settembre 2026.');
  });

  it('abbonamento disdetto: dice fino a quando dura, non «si rinnova»', () => {
    // È la differenza fra una promessa e una scadenza, e a schermo si vede
    // solo se qualcuno la scrive.
    const p = pianoAttuale(
      diritti({
        abbonamento: {
          stato: 'active',
          creditiMensili: 150,
          rinnovaIl: '2026-09-13T00:00:00.000Z',
          disdettoAFineCiclo: true,
        },
      }),
    );
    expect(p.dettaglio).toContain('resta attivo fino al 13 settembre 2026');
    expect(p.dettaglio).not.toContain('Si rinnova');
  });

  it('un pagamento fallito non spegne il servizio', () => {
    // `past_due` vuol dire che Stripe ci sta riprovando. Togliere i diritti al
    // primo tentativo andato male vuol dire spegnere il prodotto a un cliente
    // che paga, per una carta scaduta.
    const p = pianoAttuale(
      diritti({
        abbonamento: { stato: 'past_due', creditiMensili: 150, rinnovaIl: null, disdettoAFineCiclo: false },
      }),
    );
    expect(p.chiave).toBe('abbonamento');
  });

  it('un abbonamento disdetto e finito non conta più', () => {
    const p = pianoAttuale(
      diritti({
        abbonamento: { stato: 'canceled', creditiMensili: 150, rinnovaIl: null, disdettoAFineCiclo: false },
      }),
    );
    expect(p.chiave).toBe('consumo');
  });

  it('omaggio: si dice che è in omaggio e fino a quando', () => {
    const p = pianoAttuale(diritti({ omaggioFinoAl: '2026-11-14T12:00:00.000Z' }));
    expect(p.chiave).toBe('omaggio');
    expect(p.dettaglio).toContain('fino al 14 novembre 2026');
  });

  it('un omaggio scaduto è scaduto', () => {
    const p = pianoAttuale(diritti({ omaggioFinoAl: '2026-08-13T12:00:00.000Z' }));
    expect(p.chiave).toBe('consumo');
  });

  it('l’abbonamento batte l’omaggio: chi paga non legge «in omaggio»', () => {
    const p = pianoAttuale(
      diritti({
        omaggioFinoAl: '2026-11-14T12:00:00.000Z',
        abbonamento: {
          stato: 'active',
          creditiMensili: 150,
          rinnovaIl: '2026-09-13T00:00:00.000Z',
          disdettoAFineCiclo: false,
        },
      }),
    );
    expect(p.chiave).toBe('abbonamento');
  });
});

describe('le scadenze', () => {
  const lotti = [
    { id: 'a', fonte: 'trial' as const, rimanenti: 4, scadeIl: '2026-08-20T12:00:00.000Z' },
    { id: 'b', fonte: 'subscription' as const, rimanenti: 30, scadeIl: '2026-09-01T00:00:00.000Z' },
    { id: 'c', fonte: 'pack' as const, rimanenti: 50, scadeIl: '2027-06-01T00:00:00.000Z' },
    { id: 'd', fonte: 'manual' as const, rimanenti: 7, scadeIl: null },
  ];

  it('somma quello che se ne va entro il termine, e dice quando comincia', () => {
    const s = creditiInScadenza(diritti({ lotti }), 30);
    expect(s?.crediti).toBe(34);
    expect(s?.laPrimaIl).toBe('2026-08-20T12:00:00.000Z');
    expect(s?.giorniAllaPrima).toBe(6);
    expect(s?.frase).toBe(
      '34 crediti scadono entro 30 giorni. I primi il 20 agosto 2026, fra 6 giorni. ' +
        'Vengono consumati per primi, quindi ti basta generare per non perderli.',
    );
  });

  it('con un lotto solo non ripete la data che sta già nell’elenco', () => {
    // La riga del lotto dice «scade il 20 agosto 2026 · fra 6 giorni». Se
    // l'avviso la ridice, la stessa schermata dice due volte la stessa cosa —
    // ed è così che si impara a saltare gli avvisi.
    const s = creditiInScadenza(diritti({ lotti: [lotti[0]!] }), 30);
    expect(s?.lotti).toBe(1);
    expect(s?.frase).toBe(
      '4 crediti scadono entro 30 giorni. Vengono consumati per primi, quindi ti basta generare per non perderli.',
    );
  });

  it('un credito solo si dice al singolare, e col verbo giusto', () => {
    const s = creditiInScadenza(
      diritti({ lotti: [{ id: 'x', fonte: 'trial', rimanenti: 1, scadeIl: '2026-08-20T12:00:00.000Z' }] }),
      30,
    );
    expect(s?.frase).toMatch(/^1 credito scade entro/);
  });

  it('i lotti senza scadenza non entrano nel conto', () => {
    const s = creditiInScadenza(diritti({ lotti }), 3650);
    expect(s?.crediti).toBe(84);
  });

  it('niente da dire, nessun riquadro', () => {
    // «0 crediti in scadenza» è rumore, e il rumore insegna a non leggere.
    expect(creditiInScadenza(diritti({ lotti: [lotti[3]!] }), 30)).toBeNull();
    expect(creditiInScadenza(diritti({ lotti: [] }), 30)).toBeNull();
  });
});

describe('l’assistente', () => {
  function stato(p: Partial<Parameters<typeof riepilogoAssistente>[0] & object> = {}) {
    return {
      dotazione: 100,
      richieste: 0,
      dotazioneUsata: 0,
      oltreLaDotazione: 0,
      creditiAddebitati: 0,
      cicloIniziaIl: '2026-08-01T00:00:00.000Z',
      cicloFinisceIl: '2026-09-01T00:00:00.000Z',
      ...p,
    };
  }

  it('dentro la dotazione: dice che è compreso, e quanto resta', () => {
    const r = riepilogoAssistente(stato({ dotazioneUsata: 7 }));
    expect(r?.aPagamento).toBe(false);
    expect(r?.restanti).toBe(93);
    expect(r?.frase).toBe('Ti restano 93 richieste comprese su 100, in questo ciclo.');
  });

  it('a ciclo appena aperto non dice «ti restano 100 su 100»', () => {
    // Il numero si dice una volta sola: dirlo due volte nella stessa riga fa
    // sembrare che siano due numeri diversi.
    const r = riepilogoAssistente(stato());
    expect(r?.frase).toBe('100 richieste comprese in questo ciclo, ancora tutte da usare.');
  });

  it('oltre la dotazione: dice quando scatta il prossimo credito', () => {
    const r = riepilogoAssistente(stato({ dotazioneUsata: 100, oltreLaDotazione: 7 }));
    expect(r?.aPagamento).toBe(true);
    // Sette oltre: la quinta ha già addebitato, il prossimo scatta alla decima.
    expect(r?.frase).toContain('il prossimo credito scatta fra 3');
  });

  it('la dotazione cresciuta si vede', () => {
    const r = riepilogoAssistente(stato({ dotazione: 750, dotazioneUsata: 200 }));
    expect(r?.restanti).toBe(550);
    expect(r?.frase).toContain('550 richieste comprese su 750');
  });

  it('senza contatore non si inventa uno stato', () => {
    expect(riepilogoAssistente(null)).toBeNull();
  });
});
