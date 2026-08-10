import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Analisi foto in background: il claim atomico.
//
// Il cron può girare più volte in parallelo (invocazioni sovrapposte, retry).
// Senza un claim atomico due esecuzioni lavorano lo stesso batch e pagano due
// volte l'AI. E se un'invocazione muore a metà, il batch resta "in esecuzione"
// per sempre: serve il recupero dopo un tempo di stallo.
//
// Gli stati sono un ENUM su Postgres: il finto database li fa rispettare, così
// un valore sbagliato fallisce qui invece che in silenzio in produzione — che è
// esattamente il bug che abbiamo avuto tre volte.
// ---------------------------------------------------------------------------

const ORG = 'org-1';

let db: FakeDb;
let estrazioni: string[];
let esito: { ok: boolean; error?: string; productsSkipped?: number };
/** Se valorizzato, la prossima estrazione solleva un'eccezione. */
let esplodeCon: string | null;

vi.mock('@/lib/supabase/service', () => ({ getServiceClient: () => db }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: async () => ({ id: 'user-1' }),
  getUserOrg: async () => ({ organizationId: ORG }),
}));
vi.mock('@/lib/ownership', () => ({ assertBatchAccess: async () => ORG }));
vi.mock('@/lib/visual-core', () => ({
  runVisualExtractionCore: async (orgId: string, input: { batchId: string }) => {
    estrazioni.push(input.batchId);
    if (esplodeCon) {
      const msg = esplodeCon;
      esplodeCon = null;
      throw new Error(msg);
    }
    if (!esito.ok) return { ok: false as const, error: esito.error ?? 'errore' };
    return { ok: true as const, data: { productsSkipped: esito.productsSkipped ?? 0 } };
  },
}));

const { resumeVisualAnalysis } = await import('../visual-analysis-resume.js');
const { startVisualAnalysisAction, getVisualAnalysisProgressAction } = await import(
  '../actions/visual-background.js'
);

function nuovoDb() {
  // Gli stessi vincoli del database vero, definiti in un posto solo.
  return new FakeDb({ schema: SCHEMA_APP });
}

beforeEach(() => {
  db = nuovoDb();
  estrazioni = [];
  esito = { ok: true, productsSkipped: 0 };
  esplodeCon = null;
});

function seedBatch(over: Record<string, unknown> = {}) {
  db.seed('batches', [
    {
      id: 'b1',
      organization_id: ORG,
      created_at: '2026-01-01',
      visual_analysis_status: 'pending',
      visual_analysis_claimed_at: null,
      visual_analysis_error: null,
      ...over,
    },
  ]);
}

const traUnMinuto = () => Date.now() + 60_000;

describe('ripresa dell’analisi foto', () => {
  it('prende in carico un batch in attesa e lo porta a compimento', async () => {
    seedBatch();
    const res = await resumeVisualAnalysis(db as never, { deadline: traUnMinuto() });
    expect(res.batchesTouched).toBe(1);
    expect(estrazioni).toEqual(['b1']);
    expect(db.row('batches').visual_analysis_status).toBe('done');
    expect(db.row('batches').visual_analysis_claimed_at).toBeNull();
  });

  it('due esecuzioni in parallelo lavorano il batch UNA volta sola', async () => {
    seedBatch();
    await Promise.all([
      resumeVisualAnalysis(db as never, { deadline: traUnMinuto() }),
      resumeVisualAnalysis(db as never, { deadline: traUnMinuto() }),
    ]);
    expect(estrazioni).toEqual(['b1']);
  });

  it('non tocca un batch già preso in carico da poco', async () => {
    seedBatch({
      visual_analysis_status: 'running',
      visual_analysis_claimed_at: new Date().toISOString(),
    });
    const res = await resumeVisualAnalysis(db as never, { deadline: traUnMinuto() });
    expect(res.batchesTouched).toBe(0);
    expect(estrazioni).toEqual([]);
  });

  it('recupera un batch rimasto "in esecuzione" da troppo tempo', async () => {
    seedBatch({
      visual_analysis_status: 'running',
      visual_analysis_claimed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    await resumeVisualAnalysis(db as never, { deadline: traUnMinuto() });
    expect(estrazioni).toEqual(['b1']);
    expect(db.row('batches').visual_analysis_status).toBe('done');
  });

  it('se restano prodotti da analizzare lascia il lavoro in attesa, non lo chiude', async () => {
    seedBatch();
    esito = { ok: true, productsSkipped: 3 };
    await resumeVisualAnalysis(db as never, { deadline: Date.now() + 5 });
    expect(db.row('batches').visual_analysis_status).toBe('pending');
    expect(db.row('batches').visual_analysis_claimed_at).toBeNull();
  });

  it('un errore dell’estrazione finisce sul batch, visibile all’utente', async () => {
    seedBatch();
    esito = { ok: false, error: 'quota AI esaurita' };
    await resumeVisualAnalysis(db as never, { deadline: traUnMinuto() });
    expect(db.row('batches').visual_analysis_status).toBe('error');
    expect(db.row('batches').visual_analysis_error).toBe('quota AI esaurita');
  });

  it('un’eccezione non lascia il batch bloccato in "running"', async () => {
    seedBatch();
    esplodeCon = 'rete caduta';
    await resumeVisualAnalysis(db as never, { deadline: traUnMinuto() });
    expect(db.row('batches').visual_analysis_status).toBe('error');
    expect(db.row('batches').visual_analysis_error).toContain('rete caduta');
  });

  it('un batch senza organizzazione va in errore, non in crash', async () => {
    seedBatch({ organization_id: null });
    await resumeVisualAnalysis(db as never, { deadline: traUnMinuto() });
    expect(db.row('batches').visual_analysis_status).toBe('error');
    expect(estrazioni).toEqual([]);
  });

  it('niente da fare: esce subito senza scrivere', async () => {
    seedBatch({ visual_analysis_status: 'done' });
    const prima = db.calls.filter((c) => c.op === 'update').length;
    const res = await resumeVisualAnalysis(db as never, { deadline: traUnMinuto() });
    expect(res.batchesTouched).toBe(0);
    expect(db.calls.filter((c) => c.op === 'update').length).toBe(prima);
  });

  it('rispetta la scadenza: non parte se il tempo è già finito', async () => {
    seedBatch();
    const res = await resumeVisualAnalysis(db as never, { deadline: Date.now() - 1 });
    expect(res.batchesTouched).toBe(0);
    expect(estrazioni).toEqual([]);
  });
});

describe('avvio e progresso', () => {
  it('l’avvio mette il batch in attesa e azzera l’errore precedente', async () => {
    seedBatch({ visual_analysis_status: 'error', visual_analysis_error: 'vecchio errore' });
    const res = await startVisualAnalysisAction({ batchId: 'b1' });
    expect(res.ok).toBe(true);
    const b = db.row('batches');
    expect(b.visual_analysis_status).toBe('pending');
    expect(b.visual_analysis_error).toBeNull();
    expect(b.visual_analysis_claimed_at).toBeNull();
  });

  it('uno stato non valido per l’enum fa FALLIRE la scrittura, non passa in silenzio', async () => {
    seedBatch();
    const { error } = await db
      .from('batches')
      .update({ visual_analysis_status: 'in_corso' })
      .eq('id', 'b1');
    expect(error).not.toBeNull();
    expect(db.row('batches').visual_analysis_status).toBe('pending');
  });

  it('il progresso conta come analizzato chi ha una categoria o un fatto da foto', async () => {
    seedBatch({ visual_analysis_status: 'running' });
    db.seed('products', [
      { id: 'p1', batch_id: 'b1', category_id: 'c1', category: 'Olio' },
      { id: 'p2', batch_id: 'b1', category_id: null, category: null },
      { id: 'p3', batch_id: 'b1', category_id: null, category: null },
    ]);
    db.seed('product_attribute_values', [
      { id: 'v1', product_id: 'p2', source_type: 'image' },
      // Un fatto che viene dal file NON conta come "analizzato dalle foto".
      { id: 'v2', product_id: 'p3', source_type: 'spreadsheet' },
    ]);
    const res = await getVisualAnalysisProgressAction({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.total).toBe(3);
    expect(res.data.done).toBe(2);
    expect(res.data.status).toBe('running');
  });

  it('uno stato sconosciuto sul batch viene riportato come "idle", non propagato', async () => {
    seedBatch();
    db.row('batches').visual_analysis_status = null;
    const res = await getVisualAnalysisProgressAction({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.status).toBe('idle');
  });

  it('batch senza prodotti: nessuna divisione per zero, totale a zero', async () => {
    seedBatch();
    const res = await getVisualAnalysisProgressAction({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ total: 0, done: 0 });
  });
});
