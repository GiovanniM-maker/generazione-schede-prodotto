import { describe, it, expect } from 'vitest';

// Verifica il "claim" atomico anti doppio-enqueue: due richieste simultanee
// (doppio clic / retry di rete) devono riservare i crediti UNA SOLA VOLTA.
//
// Si simula il DB con un client minimale: l'update condizionato sullo stato è
// atomico, come in Postgres, quindi solo la prima chiamata ottiene la riga.

type Row = { id: string; status: string };

function makeFakeClient(initialStatus: string) {
  const batch: Row = { id: 'b1', status: initialStatus };
  const calls = { reserve: 0, release: 0, claims: 0 };

  const client = {
    from(table: string) {
      const api = {
        _filters: [] as Array<(r: Row) => boolean>,
        _update: null as null | Partial<Row>,
        select() {
          if (table === 'batches' && api._update) {
            // Esegue l'update condizionato in modo atomico.
            const ok = api._filters.every((f) => f(batch));
            if (!ok) return Promise.resolve({ data: [], error: null });
            Object.assign(batch, api._update);
            calls.claims++;
            return Promise.resolve({ data: [{ id: batch.id }], error: null });
          }
          if (table === 'products') {
            return Promise.resolve({ data: [{ id: 'p1' }, { id: 'p2' }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        update(patch: Partial<Row>) {
          api._update = patch;
          return api;
        },
        eq() {
          return api;
        },
        not(_col: string, _op: string, list: string) {
          const forbidden = list.replace(/[()]/g, '').split(',');
          api._filters.push((r) => !forbidden.includes(r.status));
          return api;
        },
        single() {
          return Promise.resolve({ data: { ...batch, organization_id: 'o1' }, error: null });
        },
      };
      return api;
    },
    rpc(fn: string) {
      if (fn === 'reserve_credits') {
        calls.reserve++;
        return Promise.resolve({ data: true, error: null });
      }
      if (fn === 'release_credits') calls.release++;
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client, calls, batch };
}

/** Riproduce la sequenza di claim di enqueueBatch (parte critica). */
async function claimBatch(c: ReturnType<typeof makeFakeClient>): Promise<boolean> {
  const NON_ENQUEUABLE = ['queued', 'processing', 'completed', 'partial_failed'];
  const { data } = await c.client
    .from('batches')
    .update({ status: 'queued' })
    .eq()
    .not('status', 'in', `(${NON_ENQUEUABLE.join(',')})`)
    .select();
  const claimed = Array.isArray(data) && data.length > 0;
  if (claimed) await c.client.rpc('reserve_credits');
  return claimed;
}

describe('anti doppio-enqueue (claim atomico)', () => {
  it('due richieste simultanee: solo una riserva i crediti', async () => {
    const c = makeFakeClient('approved');
    const [a, b] = await Promise.all([claimBatch(c), claimBatch(c)]);
    expect([a, b].filter(Boolean).length).toBe(1); // una sola vince
    expect(c.calls.reserve).toBe(1); // crediti riservati UNA volta
    expect(c.batch.status).toBe('queued');
  });

  it('un batch già in coda non viene ri-accodato', async () => {
    const c = makeFakeClient('queued');
    const ok = await claimBatch(c);
    expect(ok).toBe(false);
    expect(c.calls.reserve).toBe(0);
  });

  it('un batch già completato non viene ri-addebitato', async () => {
    const c = makeFakeClient('completed');
    const ok = await claimBatch(c);
    expect(ok).toBe(false);
    expect(c.calls.reserve).toBe(0);
  });
});
