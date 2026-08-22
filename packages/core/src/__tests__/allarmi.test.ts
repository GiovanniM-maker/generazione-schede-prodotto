import { describe, expect, it } from 'vitest';
import {
  decidiAvviso,
  firmaErrore,
  inizioFinestra,
  oggettoAvviso,
  raggruppaGuasti,
  EVENTI_DI_GUASTO,
  FINESTRA_MASSIMA_MS,
  SILENZIO_MS,
  type EventoRegistrato,
} from '../allarmi.js';

// ---------------------------------------------------------------------------
// Le prove di un sistema di allarmi non riguardano gli allarmi che manda:
// riguardano quelli che NON manda. Un allarme in più è rumore, e il rumore
// finisce in una regola di posta che li cancella tutti — compreso quello vero.
// ---------------------------------------------------------------------------

function evento(dettagli: Record<string, unknown>, quando = '2026-08-22T10:00:00Z'): EventoRegistrato {
  return { eventName: 'write_failed', createdAt: quando, dettagli };
}

describe('la firma di un guasto', () => {
  it('è la stessa quando cambia solo un identificativo', () => {
    // Il caso che rende inutile un raccoglitore di errori: cento batch
    // colpiti dallo stesso difetto arrivano come cento problemi diversi.
    const a = firmaErrore(
      evento({ operazione: 'products.insert', errore: 'batch 3f2b9c10-1a2b-4c3d-9e8f-0a1b2c3d4e5f mancante' }),
    );
    const b = firmaErrore(
      evento({ operazione: 'products.insert', errore: 'batch 99887766-aabb-ccdd-eeff-001122334455 mancante' }),
    );
    expect(a).toBe(b);
  });

  it('tiene distinti due codici di errore diversi', () => {
    // `\d{3,}` toglie gli identificativi lunghi ma non i codici: «errore 500»
    // e «errore 404» sono due guasti diversi, e confonderli farebbe cercare
    // nel posto sbagliato.
    const cinquecento = firmaErrore(evento({ messaggio: 'la pagina ha risposto 500' }));
    const quattrocentoquattro = firmaErrore(evento({ messaggio: 'la pagina ha risposto 404' }));
    expect(cinquecento).not.toBe(quattrocentoquattro);
  });

  it('toglie gli indirizzi, che cambiano a ogni prodotto', () => {
    const a = firmaErrore(evento({ messaggio: 'lettura fallita da https://esempio.invalid/p/1' }));
    const b = firmaErrore(evento({ messaggio: 'lettura fallita da https://esempio.invalid/p/2' }));
    expect(a).toBe(b);
  });

  it('ripiega sul nome dell’evento quando non c’è testo', () => {
    expect(firmaErrore({ eventName: 'unhandled_error', createdAt: 'x', dettagli: null })).toBe(
      'unhandled_error',
    );
  });
});

describe('il raggruppamento', () => {
  it('conta le occorrenze invece di elencarle', () => {
    const eventi = [
      evento({ operazione: 'products.insert', errore: 'colonna «foo» inesistente' }, '2026-08-22T10:00:00Z'),
      evento({ operazione: 'products.insert', errore: 'colonna «foo» inesistente' }, '2026-08-22T10:05:00Z'),
      evento({ operazione: 'batches.update', errore: 'permesso negato' }, '2026-08-22T10:02:00Z'),
    ];
    const gruppi = raggruppaGuasti(eventi);
    expect(gruppi).toHaveLength(2);
    expect(gruppi[0]?.quante).toBe(2);
    // Il più frequente per primo: chi legge deve trovare in cima il problema
    // che sta capitando di più, non quello capitato per ultimo.
    expect(gruppi[0]?.esempio).toContain('products.insert');
    expect(gruppi[0]?.ultimo).toBe('2026-08-22T10:05:00Z');
  });

  it('non inventa gruppi quando non c’è niente', () => {
    expect(raggruppaGuasti([])).toEqual([]);
  });
});

describe('la decisione di avvisare', () => {
  const adesso = Date.parse('2026-08-22T12:00:00Z');

  it('non manda niente se non si è rotto niente', () => {
    const d = decidiAvviso([], { adesso, ultimoAvviso: null });
    expect(d.avvisa).toBe(false);
    expect(d.totale).toBe(0);
  });

  it('manda quando c’è un guasto e non è stato mandato niente di recente', () => {
    const d = decidiAvviso([evento({ errore: 'boom' })], { adesso, ultimoAvviso: null });
    expect(d.avvisa).toBe(true);
    expect(d.totale).toBe(1);
    expect(d.motivo).toContain('1 guasto');
  });

  it('tace se ha appena mandato un avviso', () => {
    // È la prova che protegge la casella di posta: senza il silenzio, un
    // guasto che si ripete manda un'email al minuto finché non lo si spegne —
    // e da quel momento non arriva più niente, mai più.
    const d = decidiAvviso([evento({ errore: 'boom' })], {
      adesso,
      ultimoAvviso: adesso - 60_000,
    });
    expect(d.avvisa).toBe(false);
    expect(d.motivo).toContain('minuti');
    // I guasti restano nella decisione: non sono persi, aspettano il giro buono.
    expect(d.totale).toBe(1);
  });

  it('ricomincia a mandare quando il silenzio è finito', () => {
    const d = decidiAvviso([evento({ errore: 'boom' })], {
      adesso,
      ultimoAvviso: adesso - SILENZIO_MS - 1,
    });
    expect(d.avvisa).toBe(true);
  });

  it('resta zitta anche dentro il silenzio se non c’è niente da dire', () => {
    const d = decidiAvviso([], { adesso, ultimoAvviso: adesso - 60_000 });
    expect(d.avvisa).toBe(false);
    expect(d.gruppi).toEqual([]);
  });
});

describe('l’oggetto dell’email', () => {
  it('dice quanti e quale, per farsi leggere dal telefono', () => {
    const d = decidiAvviso([evento({ operazione: 'products.insert', errore: 'colonna assente' })], {
      adesso: 0,
      ultimoAvviso: null,
    });
    const oggetto = oggettoAvviso(d);
    expect(oggetto).toContain('1 guasto');
    expect(oggetto).toContain('products.insert');
  });

  it('non si rompe quando non c’è nessun gruppo', () => {
    expect(oggettoAvviso({ avvisa: false, motivo: '', gruppi: [], totale: 0 })).toContain('Verificato');
  });
});

describe('la finestra da leggere', () => {
  const adesso = Date.parse('2026-08-22T12:00:00Z');

  it('riparte dall’ultimo avviso, non dall’ultimo giro', () => {
    // Il cron gira ogni minuto ma avvisa ogni mezz'ora: leggendo solo l'ultimo
    // minuto, ventinove guasti su trenta non finirebbero in nessuna email.
    const ultimo = adesso - 45 * 60 * 1000;
    expect(inizioFinestra({ adesso, ultimoAvviso: ultimo })).toBe(ultimo);
  });

  it('non guarda più indietro del tetto', () => {
    const vecchissimo = adesso - 30 * 24 * 60 * 60 * 1000;
    expect(inizioFinestra({ adesso, ultimoAvviso: vecchissimo })).toBe(adesso - FINESTRA_MASSIMA_MS);
  });

  it('al primo avviso in assoluto parte dal tetto', () => {
    expect(inizioFinestra({ adesso, ultimoAvviso: null })).toBe(adesso - FINESTRA_MASSIMA_MS);
  });
});

describe('i nomi degli eventi', () => {
  it('sono quelli che il codice scrive davvero', () => {
    // Un nome inventato non darebbe errore: darebbe zero guasti per sempre.
    // Questi quattro sono grep-abili nel codice — `write_failed` in
    // `trace.ts`, `credit_ledger_failed` in `credits.ts`, `unhandled_error` in
    // `servizio.ts`, `errore_server` in `instrumentation.ts`.
    expect([...EVENTI_DI_GUASTO]).toEqual([
      'unhandled_error',
      'errore_server',
      'write_failed',
      'credit_ledger_failed',
    ]);
  });
});
