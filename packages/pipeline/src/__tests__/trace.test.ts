import { describe, expect, it } from 'vitest';
import { writeOrTrace, EVENTO_SCRITTURA_FALLITA } from '../trace.js';
import type { TypedClient } from '@app/database';

// ---------------------------------------------------------------------------
// Scritture in background.
//
// `mustWrite` riporta l'esito a chi chiama. In 58 punti quell'esito veniva
// buttato via — cioè `mustWrite` col risultato scartato, che è `logWrite` con
// il nome sbagliato. Nel worker e nel cron non c'è nessuno a cui riportarlo, e
// `console.error` alle tre di notte non lo legge nessuno.
//
// Questi test verificano il minimo indispensabile: che il fallimento arrivi in
// una tabella che si può interrogare, con dentro abbastanza per capire cosa è
// successo e dove.
// ---------------------------------------------------------------------------

function fakeClient(opts: { errore?: string; eccezione?: string; erroreEvento?: string } = {}) {
  const scritture: Array<{ tabella: string; riga: Record<string, unknown> }> = [];
  let opEseguite = 0;

  const op = () => {
    opEseguite++;
    if (opts.eccezione) return Promise.reject(new Error(opts.eccezione));
    return Promise.resolve({ error: opts.errore ? { message: opts.errore } : null });
  };

  const client = {
    from(tabella: string) {
      return {
        insert(riga: Record<string, unknown>) {
          scritture.push({ tabella, riga });
          return Promise.resolve({
            error: opts.erroreEvento ? { message: opts.erroreEvento } : null,
          });
        },
      };
    },
  };

  return { client: client as unknown as TypedClient, scritture, op, eseguite: () => opEseguite };
}

const ctx = { organizationId: 'org-1', batchId: 'b1', refId: 'job-7' };

describe('writeOrTrace', () => {
  it('non lascia tracce quando la scrittura passa', async () => {
    const { client, scritture, op } = fakeClient();
    const ok = await writeOrTrace(client, 'batches.update(x)', op(), ctx);
    expect(ok).toBe(true);
    // Una riga per ogni scrittura riuscita renderebbe la tabella illeggibile
    // proprio quando serve.
    expect(scritture).toEqual([]);
  });

  it('riporta il fallimento a chi chiama', async () => {
    const { client, op } = fakeClient({ errore: 'colonna inesistente' });
    expect(await writeOrTrace(client, 'batches.update(x)', op(), ctx)).toBe(false);
  });

  it('scrive in app_events cosa è fallito, dove e perché', async () => {
    const { client, scritture, op } = fakeClient({ errore: 'valore non valido per enum' });
    await writeOrTrace(client, 'job_items.update(esito)', op(), ctx);

    expect(scritture).toHaveLength(1);
    const { tabella, riga } = scritture[0]!;
    expect(tabella).toBe('app_events');
    expect(riga.event_name).toBe(EVENTO_SCRITTURA_FALLITA);
    expect(riga.organization_id).toBe('org-1');
    expect(riga.batch_id).toBe('b1');
    const meta = riga.metadata_json as Record<string, unknown>;
    expect(meta.operazione).toBe('job_items.update(esito)');
    expect(meta.errore).toBe('valore non valido per enum');
    expect(meta.riferimento).toBe('job-7');
  });

  it('tratta un’eccezione come fallimento, senza propagarla', async () => {
    // Rete che cade: chi chiama deve avere un solo modo di gestire il guaio.
    const { client, scritture, op } = fakeClient({ eccezione: 'connessione persa' });
    expect(await writeOrTrace(client, 'batches.update(x)', op(), ctx)).toBe(false);
    expect((scritture[0]!.riga.metadata_json as Record<string, unknown>).errore).toBe('connessione persa');
  });

  it('se anche la traccia fallisce non solleva niente', async () => {
    // Il presidio non deve poter far cadere il flusso che sta proteggendo.
    const { client, op } = fakeClient({ errore: 'ko', erroreEvento: 'ko pure questo' });
    await expect(writeOrTrace(client, 'x.update', op(), ctx)).resolves.toBe(false);
  });

  it('traccia anche senza organizzazione', async () => {
    // Il caso "organizzazione mancante" nel cron dell'analisi foto è proprio
    // uno di quelli da registrare: escluderlo sarebbe perdere il più utile.
    const { client, scritture, op } = fakeClient({ errore: 'ko' });
    await writeOrTrace(client, 'batches.update(senza_org)', op(), { organizationId: null, batchId: 'b2' });
    expect(scritture).toHaveLength(1);
    expect(scritture[0]!.riga.organization_id).toBeNull();
    expect((scritture[0]!.riga.metadata_json as Record<string, unknown>).riferimento).toBeNull();
  });

  it('accetta un nome d’evento dedicato e dettagli in più', async () => {
    const { client, scritture, op } = fakeClient({ errore: 'ko' });
    await writeOrTrace(client, 'crediti.release_credits', op(), {
      ...ctx,
      evento: 'credit_ledger_failed',
      dettagli: { funzione: 'release_credits', argomenti: { amt: 3 } },
    });
    const { riga } = scritture[0]!;
    // I fallimenti sui soldi devono distinguersi a colpo d'occhio nell'elenco.
    expect(riga.event_name).toBe('credit_ledger_failed');
    const meta = riga.metadata_json as Record<string, unknown>;
    expect(meta.funzione).toBe('release_credits');
    expect(meta.argomenti).toEqual({ amt: 3 });
    expect(meta.operazione).toBe('crediti.release_credits');
  });

  it('esegue la scrittura una volta sola', async () => {
    const { client, op, eseguite } = fakeClient({ errore: 'ko' });
    await writeOrTrace(client, 'x.update', op(), ctx);
    // Un presidio che ritenta di nascosto duplicherebbe gli inserimenti.
    expect(eseguite()).toBe(1);
  });
});
