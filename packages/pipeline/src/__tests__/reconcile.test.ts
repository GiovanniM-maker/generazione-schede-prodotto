import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Il rilevatore di batch bloccati.
//
// Tutte le difese scritte finora coprono una causa alla volta. Questa guarda il
// sintomo: un batch fermo in uno stato di lavoro senza niente che stia
// lavorando. Deve fare due cose, e sono in tensione fra loro:
//
//   1. rimettere in moto quello che è davvero fermo;
//   2. NON toccare quello che sta lavorando.
//
// La seconda è la più importante: un presidio che interferisce col lavoro in
// corso fa più danni di quanti ne eviti. Per questo la maggior parte di questi
// test verifica che NON succeda niente.
//
// E deve poter girare ogni minuto: se la seconda esecuzione fa qualcosa in più
// della prima, restituisce crediti due volte.
// ---------------------------------------------------------------------------

const inviati: Array<{ jobItemId: string }> = [];
vi.mock('@app/database', () => ({
  queueSend: async (_c: unknown, msg: { jobItemId: string }) => {
    inviati.push(msg);
  },
}));

const { riconciliaBatchBloccati } = await import('../reconcile.js');

const ADESSO = Date.parse('2026-08-11T12:00:00.000Z');
const fa = (minuti: number) => new Date(ADESSO - minuti * 60_000).toISOString();

interface Riga {
  [k: string]: unknown;
}

/**
 * Finto database con quel che serve qui: filtri `in`/`lt`/`eq`, update
 * condizionati (come in Postgres: se la condizione non è più vera, la riga non
 * viene presa) e registro delle rpc.
 */
function fakeClient(batches: Riga[], jobs: Riga[]) {
  const rpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const eventi: Riga[] = [];

  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpc.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
    from(tabella: string) {
      const dati = tabella === 'batches' ? batches : tabella === 'job_items' ? jobs : eventi;
      const filtri: Array<(r: Riga) => boolean> = [];
      let patch: Riga | null = null;
      let inserting: Riga | null = null;

      const esegui = () => {
        if (inserting) {
          dati.push({ ...inserting });
          return { data: null, error: null };
        }
        const presi = dati.filter((r) => filtri.every((f) => f(r)));
        if (patch) {
          for (const r of presi) Object.assign(r, patch);
          return { data: presi.map((r) => ({ ...r })), error: null };
        }
        return { data: presi.map((r) => ({ ...r })), error: null };
      };

      const catena: Record<string, unknown> = {
        select: () => catena,
        insert: (r: Riga) => {
          inserting = r;
          return catena;
        },
        update: (p: Riga) => {
          patch = p;
          return catena;
        },
        eq: (col: string, val: unknown) => {
          filtri.push((r) => r[col] === val);
          return catena;
        },
        in: (col: string, vals: unknown[]) => {
          filtri.push((r) => vals.includes(r[col]));
          return catena;
        },
        lt: (col: string, val: string) => {
          filtri.push((r) => String(r[col]) < val);
          return catena;
        },
        order: () => catena,
        limit: () => catena,
        then: (r: (v: unknown) => unknown) => Promise.resolve(esegui()).then(r),
      };
      return catena;
    },
  };

  return { client: client as never, rpc, eventi, batches, jobs };
}

const BATCH_FERMO = {
  id: 'b1',
  organization_id: 'org-1',
  status: 'processing',
  credits_reserved: 5,
  updated_at: fa(30),
};

beforeEach(() => {
  inviati.length = 0;
});

// ---------------------------------------------------------------------------

describe('batch fantasma: riservato ma mai accodato', () => {
  it('lo riporta indietro e restituisce i crediti', async () => {
    const { client, rpc, batches } = fakeClient([{ ...BATCH_FERMO }], []);
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });

    expect(esito.fantasma).toBe(1);
    expect(esito.creditiRestituiti).toBe(5);
    // 'sample_ready' è il passo da cui si può ritentare la generazione.
    expect(batches[0]!.status).toBe('sample_ready');
    expect(rpc).toEqual([
      {
        fn: 'release_credits',
        args: { org: 'org-1', amt: 5, ref_type: 'batch_bloccato', ref_id: 'b1' },
      },
    ]);
  });

  it('azzera la riserva, così il giro dopo non restituisce di nuovo', async () => {
    const batch = { ...BATCH_FERMO };
    const { client, rpc } = fakeClient([batch], []);
    await riconciliaBatchBloccati(client, { adesso: ADESSO });
    // Seconda esecuzione: il cron gira ogni minuto.
    await riconciliaBatchBloccati(client, { adesso: ADESSO });

    // `release_credits` non ha nessun freno lato database: chiamarla due volte
    // regala crediti. L'idempotenza deve stare qui.
    expect(rpc).toHaveLength(1);
    expect(batch.credits_reserved).toBe(0);
  });

  it('non chiama il registro crediti se non c’era niente riservato', async () => {
    const { client, rpc, batches } = fakeClient([{ ...BATCH_FERMO, credits_reserved: 0 }], []);
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    expect(rpc).toEqual([]);
    expect(esito.fantasma).toBe(1);
    expect(batches[0]!.status).toBe('sample_ready');
  });
});

describe('lavoro finito, stato rimasto indietro', () => {
  it('chiude il batch quando tutti i job sono arrivati in fondo', async () => {
    const { client, batches } = fakeClient(
      [{ ...BATCH_FERMO }],
      [
        { id: 'j1', batch_id: 'b1', status: 'completed', updated_at: fa(25) },
        { id: 'j2', batch_id: 'b1', status: 'needs_review', updated_at: fa(24) },
      ],
    );
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });

    expect(esito.chiusi).toBe(1);
    expect(batches[0]!.status).toBe('completed');
    expect(batches[0]!.processed_products).toBe(2);
    expect(batches[0]!.completed_at).toBeTruthy();
  });

  it('con qualche fallito lo dice: parzialmente fallito', async () => {
    const { client, batches } = fakeClient(
      [{ ...BATCH_FERMO }],
      [
        { id: 'j1', batch_id: 'b1', status: 'completed', updated_at: fa(25) },
        { id: 'j2', batch_id: 'b1', status: 'failed', updated_at: fa(25) },
      ],
    );
    await riconciliaBatchBloccati(client, { adesso: ADESSO });
    expect(batches[0]!.status).toBe('partial_failed');
    expect(batches[0]!.failed_products).toBe(1);
  });

  it('se non ne è riuscito nemmeno uno, il batch è fallito', async () => {
    const { client, batches } = fakeClient(
      [{ ...BATCH_FERMO }],
      [{ id: 'j1', batch_id: 'b1', status: 'failed', updated_at: fa(25) }],
    );
    await riconciliaBatchBloccati(client, { adesso: ADESSO });
    expect(batches[0]!.status).toBe('failed');
  });

  it('non restituisce crediti: li ha già sciolti la generazione, job per job', async () => {
    const { client, rpc } = fakeClient(
      [{ ...BATCH_FERMO }],
      [{ id: 'j1', batch_id: 'b1', status: 'completed', updated_at: fa(25) }],
    );
    await riconciliaBatchBloccati(client, { adesso: ADESSO });
    // Un secondo rimborso qui sarebbe un doppio accredito.
    expect(rpc).toEqual([]);
  });
});

describe('job fermo a metà', () => {
  it('lo rimette in coda', async () => {
    const jobs = [{ id: 'j1', batch_id: 'b1', status: 'processing', updated_at: fa(30) }];
    const { client } = fakeClient([{ ...BATCH_FERMO }], jobs);
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });

    expect(esito.jobRipresi).toBe(1);
    expect(jobs[0]!.status).toBe('queued');
    expect(inviati).toEqual([{ jobItemId: 'j1' }]);
  });

  it('non chiude il batch nello stesso giro in cui riprende un job', async () => {
    const { client, batches } = fakeClient(
      [{ ...BATCH_FERMO }],
      [
        { id: 'j1', batch_id: 'b1', status: 'processing', updated_at: fa(30) },
        { id: 'j2', batch_id: 'b1', status: 'completed', updated_at: fa(30) },
      ],
    );
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    // Dichiararlo finito mentre un job è appena ripartito sarebbe una bugia.
    expect(esito.chiusi).toBe(0);
    expect(batches[0]!.status).toBe('processing');
  });
});

describe('quello che non deve toccare', () => {
  it('lascia stare un batch che si è mosso da poco', async () => {
    const batch = { ...BATCH_FERMO, updated_at: fa(2) };
    const { client, rpc } = fakeClient([batch], []);
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    // Due minuti sono lavoro in corso, non un blocco.
    expect(esito).toEqual({ fantasma: 0, chiusi: 0, jobRipresi: 0, creditiRestituiti: 0 });
    expect(batch.status).toBe('processing');
    expect(rpc).toEqual([]);
  });

  it('lascia stare un job in corso da poco', async () => {
    const jobs = [{ id: 'j1', batch_id: 'b1', status: 'processing', updated_at: fa(1) }];
    const { client } = fakeClient([{ ...BATCH_FERMO }], jobs);
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    expect(esito.jobRipresi).toBe(0);
    expect(jobs[0]!.status).toBe('processing');
    expect(inviati).toEqual([]);
  });

  it('non tocca i job ancora in coda: aspettano il loro turno', async () => {
    const jobs = [{ id: 'j1', batch_id: 'b1', status: 'queued', updated_at: fa(30) }];
    const { client } = fakeClient([{ ...BATCH_FERMO }], jobs);
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    expect(esito).toMatchObject({ jobRipresi: 0, chiusi: 0, fantasma: 0 });
    expect(jobs[0]!.status).toBe('queued');
  });

  it('ignora i batch che non sono in lavorazione', async () => {
    const { client, rpc } = fakeClient(
      [
        { id: 'b2', organization_id: 'org-1', status: 'draft', credits_reserved: 0, updated_at: fa(999) },
        { id: 'b3', organization_id: 'org-1', status: 'completed', credits_reserved: 3, updated_at: fa(999) },
        { id: 'b4', organization_id: 'org-1', status: 'input_review', credits_reserved: 0, updated_at: fa(999) },
      ],
      [],
    );
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    // Un batch in bozza da un mese non è bloccato: è una bozza.
    expect(esito.fantasma).toBe(0);
    expect(rpc).toEqual([]);
  });

  it('salta un batch senza organizzazione invece di sbagliare rimborso', async () => {
    const { client, rpc } = fakeClient(
      [{ ...BATCH_FERMO, organization_id: null }],
      [],
    );
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    expect(esito.fantasma).toBe(0);
    expect(rpc).toEqual([]);
  });
});

describe('esecuzioni ripetute', () => {
  it('la seconda volta non fa niente di nuovo', async () => {
    const batch = { ...BATCH_FERMO };
    const jobs = [
      { id: 'j1', batch_id: 'b1', status: 'completed', updated_at: fa(25) },
      { id: 'j2', batch_id: 'b1', status: 'completed', updated_at: fa(25) },
    ];
    const { client, rpc } = fakeClient([batch], jobs);

    const primo = await riconciliaBatchBloccati(client, { adesso: ADESSO });
    const secondo = await riconciliaBatchBloccati(client, { adesso: ADESSO });

    expect(primo.chiusi).toBe(1);
    // Il batch non è più in lavorazione: al secondo giro non è più candidato.
    expect(secondo).toEqual({ fantasma: 0, chiusi: 0, jobRipresi: 0, creditiRestituiti: 0 });
    expect(rpc).toEqual([]);
  });

  it('smette quando il tempo del cron è finito', async () => {
    const { client, rpc } = fakeClient([{ ...BATCH_FERMO }], []);
    const esito = await riconciliaBatchBloccati(client, { adesso: ADESSO, deadline: Date.now() - 1 });
    // Il cron ha altro da fare: il giro dopo riprende da dov'era.
    expect(esito.fantasma).toBe(0);
    expect(rpc).toEqual([]);
  });
});
