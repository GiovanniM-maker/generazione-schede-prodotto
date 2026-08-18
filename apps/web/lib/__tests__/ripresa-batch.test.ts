import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Riprendere un batch lasciato a metà.
//
// Il wizard teneva tutto nella memoria del browser: F5 al passo 4 riportava al
// passo 1, Indietro usciva dall'applicazione, e il batch creato restava
// `draft` nel database senza alcun modo di riaprirlo. Chi caricava un catalogo
// da 2.000 righe e sbagliava un tasto ricominciava da capo. Tre revisioni
// indipendenti dell'audit ci sono inciampate.
//
// Il punto di questi test è uno solo: **quello che serve per continuare deve
// venire dal server**, non dalla memoria di una scheda che si è chiusa. In
// particolare l'anteprima del file, che prima viveva in `sessionStorage` e con
// essa moriva.
// ---------------------------------------------------------------------------

const ORG = 'org-1';
const ALTRA_ORG = 'org-2';
const BATCH = 'b1';
const BUCKET = 'source-files';

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

const { riprendiBatch } = await import('../actions/batch-wizard.js');

const CSV = [
  'Codice,Nome prodotto,Formato,Origine',
  'OLI-001,Olio EVO Coratina,500 ml,Puglia',
  'PAS-002,Spaghetti di Gragnano,500 g,Campania',
].join('\n');

function semina(opts: { conFile?: boolean; sourceType?: string | null; status?: string } = {}) {
  db = new FakeDb({ schema: SCHEMA_APP });
  db.seed('organizations', [{ id: ORG, name: 'Prova' }]);
  db.seed('preset_versions', [{ id: 'v1', preset_id: 'p1', version: 1 }]);
  db.seed('batches', [
    {
      id: BATCH,
      organization_id: ORG,
      name: 'Catalogo autunno',
      status: opts.status ?? 'draft',
      source_type: opts.sourceType === undefined ? 'spreadsheet' : opts.sourceType,
      preset_version_id: 'v1',
      credits_reserved: 0,
    },
  ]);
  if (opts.conFile ?? true) {
    db.seed('batch_sources', [
      { id: 'bs1', organization_id: ORG, batch_id: BATCH, source_type: 'spreadsheet_upload', status: 'ready' },
    ]);
    db.seed('source_files', [
      { id: 'sf1', organization_id: ORG, storage_bucket: BUCKET, storage_path: 'p/catalogo.csv', original_filename: 'catalogo.csv' },
    ]);
    db.seed('source_items', [
      { id: 'si1', organization_id: ORG, batch_source_id: 'bs1', source_file_id: 'sf1', filename: 'catalogo.csv', status: 'valid' },
    ]);
    db.seedFile(BUCKET, 'p/catalogo.csv', CSV);
  }
}

const dati = (r: unknown) => (r as { data: Record<string, unknown> }).data;

beforeEach(() => semina());

describe('riprendere un batch', () => {
  it('restituisce nome, preset e tipo di fonte', async () => {
    const res = await riprendiBatch({ batchId: BATCH });
    expect(res.ok).toBe(true);
    const d = dati(res);
    expect(d.name).toBe('Catalogo autunno');
    expect(d.presetVersionId).toBe('v1');
    expect(d.presetId).toBe('p1');
    expect(d.sourceType).toBe('spreadsheet');
    expect(d.status).toBe('draft');
  });

  it('ri-legge il file da storage e ne ridà l’anteprima', async () => {
    // È il cuore della ripresa: prima l'anteprima viveva in `sessionStorage` e
    // moriva con la scheda. Il file su storage no.
    const d = dati(await riprendiBatch({ batchId: BATCH }));
    const s = d.spreadsheet as Record<string, unknown>;
    expect(s.filename).toBe('catalogo.csv');
    expect(s.headers).toEqual(['Codice', 'Nome prodotto', 'Formato', 'Origine']);
    expect(s.totalRows).toBe(2);
    expect((s.previewRows as unknown[])[0]).toMatchObject({ Codice: 'OLI-001' });
  });

  it('ripropone le colonne SKU e Nome, senza confonderle', async () => {
    const d = dati(await riprendiBatch({ batchId: BATCH }));
    const s = d.spreadsheet as Record<string, unknown>;
    expect(s.suggestedSkuHeader).toBe('Codice');
    expect(s.suggestedNameHeader).toBe('Nome prodotto');
  });

  it('senza file caricato lo dice invece di inventarselo', async () => {
    semina({ conFile: false });
    const d = dati(await riprendiBatch({ batchId: BATCH }));
    expect(d.spreadsheet).toBeNull();
    expect(d.immagini).toBe(0);
  });

  it('conta le immagini già caricate', async () => {
    db.seed('batch_sources', [
      { id: 'bs2', organization_id: ORG, batch_id: BATCH, source_type: 'images_upload', status: 'ready' },
    ]);
    db.seed('source_items', [
      { id: 'si2', organization_id: ORG, batch_source_id: 'bs2', filename: 'OLI-001.jpg', status: 'valid' },
      { id: 'si3', organization_id: ORG, batch_source_id: 'bs2', filename: 'PAS-002.jpg', status: 'valid' },
    ]);
    const d = dati(await riprendiBatch({ batchId: BATCH }));
    expect(d.immagini).toBe(2);
  });

  it('conta i prodotti già in catalogo: la Lista SKU non carica file', async () => {
    // Una lavorazione da SKU crea prodotti senza nessun file: guardando solo
    // file e immagini, la ripresa la considerava «senza dati» e riportava chi
    // era al passo 9 indietro al passo delle fonti — il wizard che «torna
    // indietro da solo» visto in produzione.
    db.seed('products', [
      { id: 'pr-1', organization_id: ORG, batch_id: BATCH, sku: 'E1V9G130201' },
    ]);
    const res = await riprendiBatch({ batchId: BATCH });
    expect(dati(res).prodotti).toBe(1);
  });

  it('un batch di un’altra organizzazione viene rifiutato', async () => {
    db.seed('batches', [
      { id: 'b9', organization_id: ALTRA_ORG, name: 'Non tuo', status: 'draft', credits_reserved: 0 },
    ]);
    const res = await riprendiBatch({ batchId: 'b9' });
    expect(res.ok).toBe(false);
    expect(String((res as { error: string }).error)).toMatch(/non accessibile/i);
  });

  it('un id inventato viene fermato dal controllo di accesso', async () => {
    // È il controllo di accesso a respingerlo, non il «batch non trovato»
    // dentro la funzione: quello copre solo la corsa fra le due letture (batch
    // cancellato nel mezzo) e da qui non è raggiungibile.
    const res = await riprendiBatch({ batchId: '00000000-0000-0000-0000-000000000000' });
    expect(res.ok).toBe(false);
    expect(String((res as { error: string }).error)).toMatch(/non accessibile/i);
  });

  it('se il file su storage è sparito, la ripresa regge lo stesso', async () => {
    // Il file può non esserci più (pulizia, errore, bucket svuotato): la
    // ripresa deve riportare il resto invece di fallire del tutto.
    semina({ conFile: true });
    db.seedFile(BUCKET, 'altro/percorso.csv', 'x');
    db.tables['source_files'] = [
      { id: 'sf1', organization_id: ORG, storage_bucket: BUCKET, storage_path: 'sparito.csv', original_filename: 'catalogo.csv' },
    ];
    const res = await riprendiBatch({ batchId: BATCH });
    expect(res.ok).toBe(true);
    expect(dati(res).spreadsheet).toBeNull();
    expect(dati(res).name).toBe('Catalogo autunno');
  });

  it('non legge il file più di una volta', async () => {
    await riprendiBatch({ batchId: BATCH });
    const letture = db.calls.filter((c) => c.op === 'download').length;
    // Ri-leggere e ri-analizzare un catalogo costa: su 50.000 righe la
    // differenza fra una lettura e tre si sente.
    expect(letture).toBe(1);
  });
});
