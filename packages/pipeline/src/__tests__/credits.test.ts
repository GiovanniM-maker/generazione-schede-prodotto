import { describe, expect, it } from 'vitest';
import { creditOp } from '../credits.js';
import type { TypedClient } from '@app/database';

// ---------------------------------------------------------------------------
// Il registro dei crediti.
//
// Sette chiamate `rpc` buttavano via l'errore. `rpc` non passava dalla regola
// di lint sulle scritture perché non si chiama insert/update/delete — ed erano
// proprio le funzioni dove passano i soldi: accredito dopo il pagamento,
// rimborso di un job fallito, consumo del credito riservato.
//
// Qui si verifica che un fallimento non sparisca: chi chiama lo sa, e resta una
// riga interrogabile in `app_events`. Nel worker nessuno legge i log del
// server: se la traccia sta solo lì, non esiste.
// ---------------------------------------------------------------------------

interface Registrazione {
  tabella: string;
  riga: Record<string, unknown>;
}

function fakeClient(opts: {
  erroreRpc?: string;
  eccezioneRpc?: string;
  erroreEvento?: string;
}) {
  const chiamate: Array<{ fn: string; args: unknown }> = [];
  const scritture: Registrazione[] = [];

  const client = {
    rpc(fn: string, args: unknown) {
      chiamate.push({ fn, args });
      if (opts.eccezioneRpc) return Promise.reject(new Error(opts.eccezioneRpc));
      return Promise.resolve({
        data: null,
        error: opts.erroreRpc ? { message: opts.erroreRpc } : null,
      });
    },
    from(tabella: string) {
      return {
        insert(riga: Record<string, unknown>) {
          scritture.push({ tabella, riga });
          return Promise.resolve({
            data: null,
            error: opts.erroreEvento ? { message: opts.erroreEvento } : null,
          });
        },
      };
    },
  };

  return { client: client as unknown as TypedClient, chiamate, scritture };
}

const contesto = { organizationId: 'org-1', batchId: 'b1', refId: 'job-1' };

describe('creditOp', () => {
  it('esegue la funzione richiesta con gli argomenti dati', async () => {
    const { client, chiamate } = fakeClient({});
    const ok = await creditOp(
      client,
      'release_credits',
      { org: 'org-1', amt: 3, ref_type: 'job_failed', ref_id: 'job-1' },
      contesto,
    );
    expect(ok).toBe(true);
    expect(chiamate).toEqual([
      {
        fn: 'release_credits',
        args: { org: 'org-1', amt: 3, ref_type: 'job_failed', ref_id: 'job-1' },
      },
    ]);
  });

  it('quando va a buon fine non sporca app_events', async () => {
    const { client, scritture } = fakeClient({});
    await creditOp(client, 'consume_reserved_credit', { org: 'org-1', ref_type: 'job_item', ref_id: 'j' }, contesto);
    // Un evento per ogni credito consumato riempirebbe la tabella di rumore:
    // si registra solo cio' che e' andato storto.
    expect(scritture).toEqual([]);
  });

  it('riporta il fallimento al chiamante', async () => {
    const { client } = fakeClient({ erroreRpc: 'saldo insufficiente' });
    const ok = await creditOp(client, 'release_credits', { org: 'org-1', amt: 1, ref_type: 'x', ref_id: 'y' }, contesto);
    expect(ok).toBe(false);
  });

  it('lascia in app_events una traccia interrogabile', async () => {
    const { client, scritture } = fakeClient({ erroreRpc: 'funzione inesistente' });
    await creditOp(
      client,
      'apply_credit_purchase',
      { org: 'org-1', amt: 50, stripe_event: 'ev-1', price_key: 'pack_50' },
      contesto,
    );

    expect(scritture).toHaveLength(1);
    const { tabella, riga } = scritture[0]!;
    expect(tabella).toBe('app_events');
    expect(riga.event_name).toBe('credit_ledger_failed');
    expect(riga.organization_id).toBe('org-1');
    expect(riga.batch_id).toBe('b1');
    const meta = riga.metadata_json as Record<string, unknown>;
    // Chi legge deve poter dire quale funzione, con che argomenti, e perché.
    expect(meta.funzione).toBe('apply_credit_purchase');
    expect(meta.errore).toBe('funzione inesistente');
    expect(meta.riferimento).toBe('job-1');
    expect(meta.argomenti).toEqual({ org: 'org-1', amt: 50, stripe_event: 'ev-1', price_key: 'pack_50' });
  });

  it('tratta un’eccezione come un fallimento, senza propagarla', async () => {
    // Rete che cade a metà: il chiamante ha un solo modo di gestire il guaio.
    const { client, scritture } = fakeClient({ eccezioneRpc: 'connessione persa' });
    const ok = await creditOp(client, 'release_credits', { org: 'org-1', amt: 1, ref_type: 'x', ref_id: 'y' }, contesto);
    expect(ok).toBe(false);
    expect(scritture).toHaveLength(1);
    expect((scritture[0]!.riga.metadata_json as Record<string, unknown>).errore).toBe('connessione persa');
  });

  it('se anche la segnalazione fallisce non solleva niente', async () => {
    // Il presidio non deve poter far cadere il flusso che sta proteggendo.
    const { client } = fakeClient({ erroreRpc: 'ko', erroreEvento: 'ko pure questo' });
    await expect(
      creditOp(client, 'release_credits', { org: 'org-1', amt: 1, ref_type: 'x', ref_id: 'y' }, contesto),
    ).resolves.toBe(false);
  });

  it('senza batch né riferimento scrive comunque l’evento', async () => {
    const { client, scritture } = fakeClient({ erroreRpc: 'ko' });
    await creditOp(
      client,
      'release_credits',
      { org: 'org-2', amt: 1, ref_type: 'enqueue_skip', ref_id: 'b9' },
      { organizationId: 'org-2' },
    );
    expect(scritture).toHaveLength(1);
    expect(scritture[0]!.riga.batch_id).toBeNull();
    expect((scritture[0]!.riga.metadata_json as Record<string, unknown>).riferimento).toBeNull();
  });
});
