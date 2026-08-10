import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logWrite, mustWrite, writeOrThrow } from '../db-write.js';

// ---------------------------------------------------------------------------
// La rete di sicurezza deve reggere il peso: se questi helper sbagliano, tornano
// muti tutti i bug che dovrebbero impedire. Quindi vanno testati per primi.
// ---------------------------------------------------------------------------

const ok = () => Promise.resolve({ error: null });
const ko = (message: string) => Promise.resolve({ error: { message } });
const esplode = (message: string) => Promise.reject(new Error(message));

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});
afterEach(() => vi.restoreAllMocks());

describe('mustWrite', () => {
  it('scrittura riuscita: esito positivo e nessun rumore nei log', async () => {
    const res = await mustWrite('tabella.insert', ok());
    expect(res).toEqual({ ok: true, error: null });
    expect(logged).toEqual([]);
  });

  it('scrittura fallita: riporta l’errore E lo scrive nei log', async () => {
    const res = await mustWrite('batches.update', ko('invalid input value for enum'));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('invalid input value for enum');
    expect(logged.join('\n')).toContain('batches.update');
  });

  it('il messaggio di log dice QUALE operazione è fallita', async () => {
    await mustWrite('source_items.insert', ko('boom'));
    expect(logged.join('\n')).toMatch(/source_items\.insert/);
  });

  it('un’eccezione diventa un esito negativo, non si propaga', async () => {
    const res = await mustWrite('tabella.insert', esplode('rete caduta'));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('rete caduta');
    expect(logged.join('\n')).toContain('rete caduta');
  });

  it('non lancia mai: il chiamante ha un solo modo di gestire il fallimento', async () => {
    await expect(mustWrite('x.insert', esplode('boom'))).resolves.toBeDefined();
  });
});

describe('writeOrThrow', () => {
  it('scrittura riuscita: prosegue senza rumore', async () => {
    await expect(writeOrThrow('tabella.insert', ok())).resolves.toBeUndefined();
    expect(logged).toEqual([]);
  });

  it('scrittura fallita: interrompe il flusso', async () => {
    await expect(writeOrThrow('preset_categories.insert', ko('duplicate key'))).rejects.toThrow(
      /preset_categories\.insert/,
    );
  });

  it('l’eccezione porta con sé il motivo vero, non un messaggio generico', async () => {
    await expect(writeOrThrow('x.insert', ko('violates not-null constraint'))).rejects.toThrow(
      /violates not-null constraint/,
    );
  });
});

describe('logWrite', () => {
  it('scrittura fallita: NON interrompe, ma l’errore resta nei log', async () => {
    await expect(logWrite('app_events.insert', ko('boom'))).resolves.toBeUndefined();
    expect(logged.join('\n')).toContain('app_events.insert');
  });

  it('un’eccezione non fa saltare il flusso principale', async () => {
    await expect(logWrite('app_events.insert', esplode('rete caduta'))).resolves.toBeUndefined();
    expect(logged.join('\n')).toContain('rete caduta');
  });

  it('scrittura riuscita: nessun log', async () => {
    await logWrite('app_events.insert', ok());
    expect(logged).toEqual([]);
  });
});

describe('la forma della risposta Supabase', () => {
  it('error: null è successo, anche senza data', async () => {
    expect((await mustWrite('x.update', Promise.resolve({ error: null }))).ok).toBe(true);
  });

  it('un errore senza messaggio non fa esplodere l’helper', async () => {
    const res = await mustWrite('x.update', Promise.resolve({ error: { message: '' } }));
    expect(res.ok).toBe(false);
  });
});
