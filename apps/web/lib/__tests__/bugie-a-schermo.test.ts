import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Le frasi che il prodotto diceva e che non erano vere.
//
// Sono i difetti più insidiosi: nessuno schianta, nessun log si accende, i test
// sono verdi. Semplicemente, quello che c'è scritto a schermo non corrisponde a
// quello che il prodotto sta facendo.
//
//   - «l'acquisto è simulato, i crediti sono accreditati senza addebito reale»
//     scritto fisso, cioè anche quando l'addebito è reale;
//   - un file senza righe accolto con la spunta verde, seguito da tre passi che
//     dicono «ok» prima che l'import confessi «nessun prodotto importato»;
//   - una privacy policy pubblica con «[Ragione sociale]» dentro.
//
// Qui si coprono i casi che passano dal codice; il banner e le pagine legali
// sono verificati dai test di interfaccia (e2e/interfaccia.spec.ts).
// ---------------------------------------------------------------------------

const ORG = 'org-1';
const BATCH = 'b1';

let db: FakeDb;

vi.mock('@/lib/supabase/service', () => ({ getServiceClient: () => db }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: async () => ({ id: 'user-1' }),
  getUserOrg: async () => ({ organizationId: ORG }),
}));
vi.mock('@/lib/ownership', () => ({
  assertBatchAccess: async (batchId: string) =>
    db.rows('batches').some((b) => b.id === batchId && b.organization_id === ORG) ? ORG : null,
}));

const { uploadBatchFiles } = await import('../actions/batch-wizard.js');

function seed() {
  db = new FakeDb({ schema: SCHEMA_APP });
  db.seed('organizations', [{ id: ORG, name: 'Prova' }]);
  db.seed('batches', [
    { id: BATCH, organization_id: ORG, status: 'draft', preset_version_id: 'v1', credits_reserved: 0 },
  ]);
}

/** Un caricamento come lo manda il browser. */
function caricamento(contenuto: string, nome = 'catalogo.csv') {
  const fd = new FormData();
  fd.append('batchId', BATCH);
  fd.append('sourceType', 'spreadsheet');
  fd.append('files', new File([contenuto], nome, { type: 'text/csv' }));
  return fd;
}

const messaggio = (r: unknown) => String((r as { error?: string }).error ?? '');

beforeEach(seed);

describe('file senza prodotti', () => {
  it('un file completamente vuoto viene respinto', async () => {
    const res = await uploadBatchFiles(caricamento(''));
    // Prima riceveva la spunta verde e l'utente scopriva il problema tre passi
    // dopo, davanti a «Nessun prodotto importato».
    expect(res.ok).toBe(false);
    expect(messaggio(res)).toMatch(/vuoto/i);
  });

  it('un file con la sola intestazione viene respinto, e dice perché', async () => {
    const res = await uploadBatchFiles(caricamento('sku,nome,formato'));
    expect(res.ok).toBe(false);
    // Il messaggio deve distinguere questo caso dal file vuoto: la causa e il
    // rimedio sono diversi (qui l'export si è fermato all'intestazione).
    expect(messaggio(res)).toMatch(/intestazione/i);
    expect(messaggio(res)).not.toMatch(/^Il file è vuoto/);
  });

  it('non lascia il file agganciato al batch', async () => {
    await uploadBatchFiles(caricamento('sku,nome'));
    // Un file registrato come sorgente valida farebbe credere all'analisi di
    // avere uno spreadsheet da leggere.
    expect(db.rows('source_items')).toHaveLength(0);
  });

  it('un file con una riga vera passa', async () => {
    const res = await uploadBatchFiles(caricamento('sku,nome\nOLIO-1,Olio EVO'));
    expect(res.ok).toBe(true);
    expect(db.rows('source_items')).toHaveLength(1);
  });

  it('quando passa non segnala nessun problema', async () => {
    const res = await uploadBatchFiles(caricamento('sku,nome\nOLIO-1,Olio EVO\nFORM-1,Pecorino'));
    expect(res.ok).toBe(true);
    const dati = (res as { data: { totalRows: number; file: { problem: string | null } } }).data;
    expect(dati.totalRows).toBe(2);
    expect(dati.file.problem).toBeNull();
  });
});
