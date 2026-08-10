import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Accodamento di un batch: qui ci sono crediti veri in gioco.
//
// Tre modi di sbagliare, tutti costosi:
//   - accodare due volte lo stesso batch → crediti riservati due volte;
//   - lasciare un batch "in coda" senza job → bloccato per sempre, crediti fermi;
//   - riservare crediti e non rilasciare quelli non usati.
//
// Il claim sullo stato è un update CONDIZIONATO: come in Postgres, se la
// condizione non è più vera la riga non viene presa.
// ---------------------------------------------------------------------------

const inviati: Array<{ jobItemId: string }> = [];
vi.mock('@app/database', () => ({
  queueSend: async (_c: unknown, msg: { jobItemId: string }) => {
    inviati.push(msg);
  },
}));
vi.mock('../generate.js', () => ({ updateBatchProgress: async () => {} }));

const { enqueueBatch } = await import('../enqueue.js');

interface Scenario {
  status: string;
  prodottiEleggibili: number;
  creditiDisponibili: boolean;
  /** Quanti insert di job_item devono fallire (simula doppioni). */
  jobFalliti?: number;
  erroreRiserva?: string;
}

function fakeClient(s: Scenario) {
  const batch = { id: 'b1', organization_id: 'org-1', status: s.status } as Record<string, unknown>;
  const rpc: Array<{ name: string; amt: number }> = [];
  let jobSeq = 0;
  let falliti = s.jobFalliti ?? 0;

  const client = {
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let patch: Record<string, unknown> | null = null;
      let inserting = false;

      /** Esegue l'operazione accumulata. Chiamata solo alla fine della catena. */
      const run = (): { data: unknown; error: { message: string } | null } => {
        if (patch) {
          // Update condizionato: atomico, o passa o non passa.
          if (!filters.every((f) => f(batch))) return { data: [], error: null };
          Object.assign(batch, patch);
          return { data: [{ id: batch.id }], error: null };
        }
        if (inserting && table === 'job_items') {
          if (falliti > 0) {
            falliti--;
            return { data: null, error: { message: 'duplicate key violates unique constraint' } };
          }
          return { data: { id: `job-${++jobSeq}` }, error: null };
        }
        if (table === 'batches') return { data: { ...batch }, error: null };
        if (table === 'products') {
          return {
            data: Array.from({ length: s.prodottiEleggibili }, (_, i) => ({ id: `p${i}` })),
            error: null,
          };
        }
        return { data: [], error: null };
      };

      const q = {
        select: () => q,
        insert: () => {
          inserting = true;
          return q;
        },
        update: (p: Record<string, unknown>) => {
          patch = p;
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return q;
        },
        not: (col: string, op: string, vals: string) => {
          if (op === 'in') {
            const list = vals.replace(/^\(|\)$/g, '').split(',');
            filters.push((r) => !list.includes(String(r[col])));
          }
          return q;
        },
        single: async () => run(),
        maybeSingle: async () => run(),
        then: (onOk: (v: unknown) => unknown) => Promise.resolve(run()).then(onOk),
      };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpc.push({ name, amt: Number(args.amt ?? 0) });
      if (name === 'reserve_credits') {
        if (s.erroreRiserva) return { data: null, error: { message: s.erroreRiserva } };
        return { data: s.creditiDisponibili, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { client, batch, rpc };
}

const ENV = {} as never;

beforeEach(() => {
  inviati.length = 0;
});

describe('accodamento del batch', () => {
  it('accoda i prodotti eleggibili e manda un messaggio per ciascuno', async () => {
    const { client, batch } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 3,
      creditiDisponibili: true,
    });
    const res = await enqueueBatch(client as never, ENV, 'b1');
    expect(res).toEqual({ enqueued: 3, reserved: 3, skipped: 0 });
    expect(inviati).toHaveLength(3);
    expect(batch.status).toBe('processing');
  });

  it('riserva esattamente un credito per prodotto eleggibile', async () => {
    const { client, rpc } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 5,
      creditiDisponibili: true,
    });
    await enqueueBatch(client as never, ENV, 'b1');
    expect(rpc.find((r) => r.name === 'reserve_credits')?.amt).toBe(5);
  });

  it('un batch già in coda non viene accodato di nuovo', async () => {
    for (const stato of ['queued', 'processing', 'completed', 'partial_failed']) {
      const { client, rpc } = fakeClient({
        status: stato,
        prodottiEleggibili: 3,
        creditiDisponibili: true,
      });
      const res = await enqueueBatch(client as never, ENV, 'b1');
      expect(res.enqueued, `stato ${stato}`).toBe(0);
      expect(rpc.filter((r) => r.name === 'reserve_credits'), `stato ${stato}`).toHaveLength(0);
    }
  });

  it('nessun prodotto eleggibile: ripristina lo stato invece di lasciarlo in coda', async () => {
    const { client, batch, rpc } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 0,
      creditiDisponibili: true,
    });
    const res = await enqueueBatch(client as never, ENV, 'b1');
    expect(res.enqueued).toBe(0);
    expect(batch.status).toBe('input_review');
    expect(rpc.filter((r) => r.name === 'reserve_credits')).toHaveLength(0);
  });

  it('crediti insufficienti: errore chiaro E stato ripristinato', async () => {
    const { client, batch } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 2,
      creditiDisponibili: false,
    });
    await expect(enqueueBatch(client as never, ENV, 'b1')).rejects.toThrow(/INSUFFICIENT_CREDITS/);
    expect(batch.status).toBe('input_review');
  });

  it('errore del database sulla riserva: stato ripristinato, niente batch fantasma', async () => {
    const { client, batch } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 2,
      creditiDisponibili: true,
      erroreRiserva: 'connessione persa',
    });
    await expect(enqueueBatch(client as never, ENV, 'b1')).rejects.toThrow(/DATABASE_ERROR/);
    expect(batch.status).toBe('input_review');
  });

  it('job saltati: i crediti non usati vengono RILASCIATI', async () => {
    const { client, rpc } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 4,
      creditiDisponibili: true,
      jobFalliti: 2,
    });
    const res = await enqueueBatch(client as never, ENV, 'b1');
    expect(res).toMatchObject({ enqueued: 2, reserved: 4, skipped: 2 });
    expect(rpc.find((r) => r.name === 'release_credits')?.amt).toBe(2);
  });

  it('nessun job saltato: nessun rilascio inutile', async () => {
    const { client, rpc } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 2,
      creditiDisponibili: true,
    });
    await enqueueBatch(client as never, ENV, 'b1');
    expect(rpc.filter((r) => r.name === 'release_credits')).toHaveLength(0);
  });

  it('in coda finisce SOLO l’id del job, mai dati di prodotto', async () => {
    const { client } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 2,
      creditiDisponibili: true,
    });
    await enqueueBatch(client as never, ENV, 'b1');
    for (const msg of inviati) {
      expect(Object.keys(msg)).toEqual(['jobItemId']);
    }
  });

  it('il contatore finale dei crediti riflette i job davvero accodati', async () => {
    const { client, batch } = fakeClient({
      status: 'input_review',
      prodottiEleggibili: 4,
      creditiDisponibili: true,
      jobFalliti: 1,
    });
    await enqueueBatch(client as never, ENV, 'b1');
    expect(batch.credits_reserved).toBe(3);
  });

  it('batch inesistente: errore parlante invece di un crash oscuro', async () => {
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'no rows' } }) }) }),
      }),
      rpc: async () => ({ data: null, error: null }),
    };
    await expect(enqueueBatch(client as never, ENV, 'b1')).rejects.toThrow(/batch non trovato/);
  });
});
