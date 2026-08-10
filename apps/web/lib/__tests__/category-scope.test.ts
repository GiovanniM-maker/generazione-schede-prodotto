import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Il vocabolario delle categorie di un batch.
//
// Il bug: il wizard proponeva (e assegnava) TUTTE le categorie del settore,
// comprese quelle di sistema che nel preset scelto non esistono. Sul database
// reale il preset "Eataly" aveva 17 categorie e il wizard ne offriva 31.
// Effetto: prodotti assegnati a categorie senza attributi → niente da estrarre.
// ---------------------------------------------------------------------------

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
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

const { getBatchCategoryOptions, setProductsCategoryAction } = await import(
  '../actions/batch-wizard.js'
);

/** Preset con 2 categorie, dentro un settore che ne ha 5. */
function seedBaseline() {
  db = new FakeDb();
  db.seed('presets', [{ id: 'p1', organization_id: ORG, sector_id: 'food' }]);
  db.seed('preset_versions', [{ id: 'v1', preset_id: 'p1' }]);
  db.seed('batches', [{ id: 'b1', organization_id: ORG, preset_version_id: 'v1' }]);
  db.seed('categories', [
    { id: 'c-olio', name: 'Olio EVO', sector_id: 'food', status: 'active', owner_organization_id: ORG },
    { id: 'c-form', name: 'Formaggi', sector_id: 'food', status: 'active', owner_organization_id: ORG },
    // Di sistema, nel settore ma NON nel preset: non devono comparire.
    { id: 'c-pasta', name: 'Pasta e riso', sector_id: 'food', status: 'active', owner_organization_id: null },
    { id: 'c-vini', name: 'Vini', sector_id: 'food', status: 'active', owner_organization_id: null },
    { id: 'c-snack', name: 'Snack', sector_id: 'food', status: 'active', owner_organization_id: null },
  ]);
  db.seed('preset_categories', [
    { id: 'pc1', preset_version_id: 'v1', category_id: 'c-olio', enabled: true },
    { id: 'pc2', preset_version_id: 'v1', category_id: 'c-form', enabled: true },
  ]);
}

beforeEach(seedBaseline);

describe('categorie disponibili in un batch', () => {
  it('offre solo le categorie del preset, non quelle del settore', async () => {
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.categories.map((c) => c.name)).toEqual(['Formaggi', 'Olio EVO']);
    expect(res.data.fromPreset).toBe(true);
  });

  it('non fa passare le categorie di sistema del settore', async () => {
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    const names = res.data.categories.map((c) => c.name);
    // Prima la controparte positiva: senza questa, un elenco vuoto farebbe
    // passare il test a vuoto e non proverebbe nulla.
    expect(names).toContain('Olio EVO');
    for (const leaked of ['Pasta e riso', 'Vini', 'Snack']) {
      expect(names).not.toContain(leaked);
    }
  });

  it('esclude le categorie disattivate nel preset', async () => {
    db.rows('preset_categories').find((r) => r.id === 'pc1')!.enabled = false;
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.categories.map((c) => c.name)).toEqual(['Formaggi']);
  });

  it('esclude le categorie non più attive nel catalogo', async () => {
    db.rows('categories').find((r) => r.id === 'c-form')!.status = 'archived';
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.categories.map((c) => c.name)).toEqual(['Olio EVO']);
  });

  it('ordina per nome, così l’elenco è prevedibile', async () => {
    db.seed('categories', [
      { id: 'c-acq', name: 'Acqua', sector_id: 'food', status: 'active', owner_organization_id: ORG },
    ]);
    db.seed('preset_categories', [
      { id: 'pc3', preset_version_id: 'v1', category_id: 'c-acq', enabled: true },
    ]);
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.categories.map((c) => c.name)).toEqual(['Acqua', 'Formaggi', 'Olio EVO']);
  });

  it('a parità di nome tiene quella dell’organizzazione, non quella di sistema', async () => {
    db.seed('categories', [
      { id: 'c-sys-olio', name: 'Olio EVO', sector_id: 'food', status: 'active', owner_organization_id: null },
    ]);
    db.seed('preset_categories', [
      { id: 'pc4', preset_version_id: 'v1', category_id: 'c-sys-olio', enabled: true },
    ]);
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    const olio = res.data.categories.filter((c) => c.name === 'Olio EVO');
    expect(olio).toHaveLength(1);
    expect(olio[0].id).toBe('c-olio');
  });

  it('preset senza categorie: ripiega sul settore e lo DICHIARA', async () => {
    db.tables['preset_categories'] = [];
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.fromPreset).toBe(false);
    expect(res.data.categories.length).toBe(5);
  });

  it('batch senza preset: nessuna categoria, nessun ripiego', async () => {
    db.rows('batches')[0].preset_version_id = null;
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.categories).toEqual([]);
    expect(res.data.fromPreset).toBe(false);
  });

  it('preset di un’altra organizzazione: nessuna categoria', async () => {
    db.rows('presets')[0].organization_id = OTHER_ORG;
    const res = await getBatchCategoryOptions({ batchId: 'b1' });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.categories).toEqual([]);
  });

  it('batch di un’altra organizzazione: accesso negato', async () => {
    db.seed('batches', [{ id: 'b-altro', organization_id: OTHER_ORG, preset_version_id: 'v1' }]);
    const res = await getBatchCategoryOptions({ batchId: 'b-altro' });
    expect(res.ok).toBe(false);
  });
});

describe('assegnazione manuale della categoria', () => {
  beforeEach(() => {
    db.seed('products', [
      { id: 'prod-1', batch_id: 'b1', sku: 'A1', category: null, category_id: null },
      { id: 'prod-2', batch_id: 'b1', sku: 'A2', category: null, category_id: null },
    ]);
  });

  it('assegna una categoria del preset e scrive anche il nome', async () => {
    const res = await setProductsCategoryAction({
      batchId: 'b1',
      productIds: ['prod-1'],
      categoryId: 'c-olio',
    });
    expect(res.ok).toBe(true);
    const p = db.rows('products').find((r) => r.id === 'prod-1');
    expect(p?.category_id).toBe('c-olio');
    expect(p?.category).toBe('Olio EVO');
  });

  it('RIFIUTA una categoria fuori dal preset, anche se esiste nel settore', async () => {
    const res = await setProductsCategoryAction({
      batchId: 'b1',
      productIds: ['prod-1'],
      categoryId: 'c-vini',
    });
    expect(res.ok).toBe(false);
    expect(db.rows('products').find((r) => r.id === 'prod-1')?.category_id).toBeNull();
  });

  it('rifiuta una categoria inesistente', async () => {
    const res = await setProductsCategoryAction({
      batchId: 'b1',
      productIds: ['prod-1'],
      categoryId: 'c-inventata',
    });
    expect(res.ok).toBe(false);
  });

  it('azzerare la categoria è sempre permesso', async () => {
    db.rows('products')[0].category_id = 'c-olio';
    db.rows('products')[0].category = 'Olio EVO';
    const res = await setProductsCategoryAction({
      batchId: 'b1',
      productIds: ['prod-1'],
      categoryId: null,
    });
    expect(res.ok).toBe(true);
    expect(db.rows('products')[0].category_id).toBeNull();
    expect(db.rows('products')[0].category).toBeNull();
  });

  it('non tocca i prodotti di un altro batch', async () => {
    db.seed('batches', [{ id: 'b2', organization_id: ORG, preset_version_id: 'v1' }]);
    db.seed('products', [
      { id: 'prod-x', batch_id: 'b2', sku: 'X', category: null, category_id: null },
    ]);
    await setProductsCategoryAction({
      batchId: 'b1',
      productIds: ['prod-1', 'prod-x'],
      categoryId: 'c-olio',
    });
    expect(db.rows('products').find((r) => r.id === 'prod-x')?.category_id).toBeNull();
  });

  it('elenco vuoto: nessuna scrittura', async () => {
    const before = db.calls.length;
    const res = await setProductsCategoryAction({ batchId: 'b1', productIds: [], categoryId: 'c-olio' });
    expect(res.ok).toBe(true);
    expect(db.calls.slice(before).filter((c) => c.op === 'update')).toHaveLength(0);
  });
});
