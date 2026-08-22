import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTO_AVVISO_MANDATO, SILENZIO_MS } from '@app/core';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Il giro che porta i guasti fuori dal database.
//
// La parte che decide sta in `@app/core/allarmi` ed è provata lì. Qui si prova
// il contorno impuro, che è dove stanno i modi di rompersi veri: leggere la
// finestra sbagliata, mandare due volte la stessa email, e — il peggiore —
// tacere perché non è configurato niente facendo credere che vada tutto bene.
// ---------------------------------------------------------------------------

let db: FakeDb;
/** Le email effettivamente partite: destinatario, oggetto, corpo. */
let spedite: { a: string; oggetto: string; html: string }[] = [];
let invioRiesce = true;

vi.mock('@/lib/notify', () => ({
  sendEmail: async (a: string, oggetto: string, html: string) => {
    if (!invioRiesce) return false;
    spedite.push({ a, oggetto, html });
    return true;
  },
}));
vi.mock('@/lib/indirizzo-app', () => ({ indirizzoApp: () => 'https://esempio.invalid' }));

const { controllaGuasti } = await import('../allarmi.js');

const ADESSO = Date.parse('2026-08-22T12:00:00Z');

let contatore = 0;
function guasto(quando: number, dettagli: Record<string, unknown>, nome = 'write_failed') {
  db.seed('app_events', [
    {
      id: `ev-${++contatore}`,
      event_name: nome,
      metadata_json: dettagli,
      created_at: new Date(quando).toISOString(),
    },
  ]);
}

function avvisoMandatoIl(quando: number) {
  db.seed('app_events', [
    {
      id: `avviso-${++contatore}`,
      event_name: EVENTO_AVVISO_MANDATO,
      metadata_json: {},
      created_at: new Date(quando).toISOString(),
    },
  ]);
}

beforeEach(() => {
  db = new FakeDb({ schema: SCHEMA_APP });
  spedite = [];
  invioRiesce = true;
  process.env.ADMIN_EMAILS = 'capo@example.invalid';
  process.env.RESEND_API_KEY = 'chiave-finta';
});

describe('quando gli avvisi non sono configurati', () => {
  it('lo dice invece di tacere, se manca l’elenco dei destinatari', async () => {
    // È IL CASO PIÙ IMPORTANTE DI TUTTI. Un sistema di allarmi spento e uno
    // che non ha niente da dire fanno esattamente la stessa cosa: niente. Se
    // la differenza non arriva fuori, si compra tranquillità senza copertura.
    process.env.ADMIN_EMAILS = '';
    guasto(ADESSO - 60_000, { errore: 'boom' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(false);
    expect(esito.motivo).toContain('ADMIN_EMAILS');
    expect(spedite).toHaveLength(0);
  });

  it('lo dice anche se manca la chiave per mandare la posta', async () => {
    delete process.env.RESEND_API_KEY;
    guasto(ADESSO - 60_000, { errore: 'boom' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(false);
    expect(esito.motivo).toContain('RESEND_API_KEY');
  });
});

describe('il giro normale', () => {
  it('non manda niente quando non si è rotto niente', async () => {
    const esito = await controllaGuasti(db as never, { adesso: ADESSO });
    expect(esito.mandato).toBe(false);
    expect(esito.guasti).toBe(0);
    expect(spedite).toHaveLength(0);
  });

  it('manda un’email quando trova dei guasti', async () => {
    guasto(ADESSO - 60_000, { operazione: 'products.insert', errore: 'colonna assente' });
    guasto(ADESSO - 30_000, { operazione: 'products.insert', errore: 'colonna assente' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(true);
    expect(esito.guasti).toBe(2);
    expect(spedite).toHaveLength(1);
    expect(spedite[0]?.a).toBe('capo@example.invalid');
    // Due occorrenze dello stesso problema: una riga sola, con il conto.
    expect(spedite[0]?.html).toContain('2×');
    expect(spedite[0]?.oggetto).toContain('2 guasti');
  });

  it('scrive a tutti gli indirizzi configurati', async () => {
    process.env.ADMIN_EMAILS = 'capo@example.invalid, socia@example.invalid';
    guasto(ADESSO - 60_000, { errore: 'boom' });

    await controllaGuasti(db as never, { adesso: ADESSO });

    expect(spedite.map((e) => e.a)).toEqual(['capo@example.invalid', 'socia@example.invalid']);
  });

  it('ignora gli eventi che non sono guasti', async () => {
    guasto(ADESSO - 60_000, { presets: 3 }, 'batch_created');
    guasto(ADESSO - 60_000, { n: 1 }, 'export_created');

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(false);
    expect(spedite).toHaveLength(0);
  });

  it('raccoglie anche gli errori del server presi dalla strumentazione', async () => {
    // `errore_server` è il nome nuovo: se non fosse nell'elenco, la categoria
    // di guasti più grossa resterebbe raccolta e mai spedita.
    guasto(ADESSO - 60_000, { messaggio: 'undefined non è una funzione' }, 'errore_server');

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(true);
    expect(esito.guasti).toBe(1);
  });
});

describe('il silenzio fra un avviso e l’altro', () => {
  it('non riscrive se ha appena scritto', async () => {
    // Il cron gira ogni minuto: senza questa, un guasto che si ripete manderebbe
    // sessanta email all'ora finché qualcuno non spegne le notifiche — e da quel
    // momento non arriverebbe più niente, mai più.
    avvisoMandatoIl(ADESSO - 60_000);
    guasto(ADESSO - 30_000, { errore: 'boom' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(false);
    expect(spedite).toHaveLength(0);
    // I guasti non sono persi: sono contati e aspettano il giro buono.
    expect(esito.guasti).toBe(1);
  });

  it('ricomincia quando il silenzio è passato', async () => {
    avvisoMandatoIl(ADESSO - SILENZIO_MS - 60_000);
    guasto(ADESSO - 30_000, { errore: 'boom' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(true);
  });

  it('riprende dall’ultimo avviso, non dall’ultimo minuto', async () => {
    // Il guasto è capitato durante il silenzio. Se la finestra partisse
    // dall'ultimo giro del cron, questo non finirebbe in nessuna email: sarebbe
    // registrato, contato nel pannello, e mai segnalato a nessuno.
    const ultimoAvviso = ADESSO - 45 * 60 * 1000;
    avvisoMandatoIl(ultimoAvviso);
    guasto(ultimoAvviso + 60_000, { errore: 'capitato durante il silenzio' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(true);
    expect(esito.guasti).toBe(1);
  });

  it('non racconta guasti più vecchi del tetto della finestra', async () => {
    // Sette ore fa: fuori dalle sei del tetto. Senza il tetto, il primo avviso
    // in assoluto conterrebbe tutta la storia del prodotto.
    guasto(ADESSO - 7 * 60 * 60 * 1000, { errore: 'roba di stanotte' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(false);
    expect(esito.guasti).toBe(0);
  });

  it('lascia il segnaposto anche se la posta non parte', async () => {
    // Il segnaposto si scrive prima dell'invio, di proposito: due giri del cron
    // che si accavallano devono mandare una email sola, non due.
    invioRiesce = false;
    guasto(ADESSO - 60_000, { errore: 'boom' });

    const esito = await controllaGuasti(db as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(false);
    expect(esito.motivo).toContain('non riuscito');
    expect(db.rows('app_events').filter((r) => r.event_name === EVENTO_AVVISO_MANDATO)).toHaveLength(1);
  });
});

describe('quando il database non risponde', () => {
  it('non lancia: un allarme rotto non deve fermare il cron', async () => {
    // `controllaGuasti` gira dentro il giro che genera le schede. Se sollevasse,
    // il guasto che voleva segnalare diventerebbe due — e il secondo fermerebbe
    // la produzione dei clienti.
    const rotto = {
      from() {
        throw new Error('connessione caduta');
      },
    };

    const esito = await controllaGuasti(rotto as never, { adesso: ADESSO });

    expect(esito.mandato).toBe(false);
    expect(esito.motivo).toContain('connessione caduta');
  });
});
