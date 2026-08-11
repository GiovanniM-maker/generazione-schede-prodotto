import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// L'import: la funzione piu' lunga del progetto, e quella dove sono nati piu'
// guasti. Fino a oggi senza un solo test diretto.
//
// Storico dei bug passati da qui, tutti riprodotti come casi di prova:
//   - lo spreadsheet non veniva collegato al batch -> "solo immagini";
//   - "0 idonei alla generazione" su cataloghi perfettamente generabili, perche'
//     il conteggio usava una regola tarata sui campi moda;
//   - la categoria mappata dal file non risultava mappata dopo;
//   - un attributo duplicato faceva rifiutare TUTTI i fatti del blocco;
//   - le scritture a blocchi: una riga malformata non deve far perdere le altre.
//
// Il finto database applica gli ENUM e i vincoli unici come Postgres: se un test
// passa qui ma fallirebbe in produzione, e' il finto database a essere sbagliato.
// ---------------------------------------------------------------------------

const ORG = 'org-1';
const BATCH = 'b1';
const BUCKET = 'source-files';

let db: FakeDb;

vi.mock('@/lib/supabase/service', () => ({ getServiceClient: () => db }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: async () => ({ id: 'user-1' }),
  getUserOrg: async () => ({ organizationId: ORG }),
}));
vi.mock('@/lib/ownership', () => ({
  // Come in produzione: l'accesso si decide guardando il batch, non a priori.
  assertBatchAccess: async (batchId: string) =>
    db.rows('batches').some((b) => b.id === batchId && b.organization_id === ORG) ? ORG : null,
}));

const { confirmImportV2 } = await import('../actions/batch-wizard.js');

// --- scenario di base -------------------------------------------------------

const CSV_BASE = [
  'sku,nome,categoria,formato,origine',
  'OLIO-1,Olio EVO Coratina,Olio EVO,500 ml,Puglia',
  'FORM-1,Pecorino stagionato,Formaggi,300 g,Sardegna',
].join('\n');

function seedScenario(opts: { csv?: string; immagini?: string[] } = {}) {
  // I vincoli veri dello schema: enum, unicita' e cancellazioni a cascata.
  db = new FakeDb({ schema: SCHEMA_APP });

  db.seed('presets', [{ id: 'p1', organization_id: ORG, sector_id: 'food' }]);
  db.seed('preset_versions', [{ id: 'v1', preset_id: 'p1' }]);
  db.seed('batches', [{ id: BATCH, organization_id: ORG, preset_version_id: 'v1' }]);

  db.seed('attributes', [
    { id: 'a-nome', key: 'product_name', name: 'Nome prodotto', data_type: 'text', sector_id: 'food', status: 'active', owner_organization_id: null },
    { id: 'a-cat', key: 'category', name: 'Categoria', data_type: 'text', sector_id: 'food', status: 'active', owner_organization_id: null },
    { id: 'a-formato', key: null, name: 'Formato', data_type: 'text', sector_id: 'food', status: 'active', owner_organization_id: ORG },
    { id: 'a-origine', key: null, name: 'Origine', data_type: 'text', sector_id: 'food', status: 'active', owner_organization_id: ORG },
  ]);
  db.seed('preset_attributes', [
    { id: 'pa1', preset_version_id: 'v1', attribute_id: 'a-nome', enabled: true, display_order: 1 },
    { id: 'pa2', preset_version_id: 'v1', attribute_id: 'a-cat', enabled: true, display_order: 2 },
    { id: 'pa3', preset_version_id: 'v1', attribute_id: 'a-formato', enabled: true, display_order: 3 },
    { id: 'pa4', preset_version_id: 'v1', attribute_id: 'a-origine', enabled: true, display_order: 4 },
  ]);

  db.seed('categories', [
    { id: 'c-olio', name: 'Olio EVO', sector_id: 'food', status: 'active', owner_organization_id: ORG },
    { id: 'c-form', name: 'Formaggi', sector_id: 'food', status: 'active', owner_organization_id: ORG },
  ]);
  db.seed('preset_categories', [
    { id: 'pc1', preset_version_id: 'v1', category_id: 'c-olio', enabled: true },
    { id: 'pc2', preset_version_id: 'v1', category_id: 'c-form', enabled: true },
  ]);

  // Lo spreadsheet: file su storage + le righe che lo collegano al batch.
  db.seed('batch_sources', [
    { id: 'bs-file', batch_id: BATCH, source_type: 'spreadsheet_upload', status: 'ready' },
    { id: 'bs-img', batch_id: BATCH, source_type: 'images_upload', status: 'ready' },
  ]);
  db.seed('source_files', [
    { id: 'sf1', storage_bucket: BUCKET, storage_path: 'catalogo.csv', original_filename: 'catalogo.csv' },
  ]);
  db.seed('source_items', [
    { id: 'si-file', batch_source_id: 'bs-file', source_file_id: 'sf1', filename: 'catalogo.csv', status: 'valid' },
  ]);
  db.seedFile(BUCKET, 'catalogo.csv', opts.csv ?? CSV_BASE);

  for (const [i, sku] of (opts.immagini ?? []).entries()) {
    db.seed('source_items', [
      {
        id: `si-img-${i}`,
        batch_source_id: 'bs-img',
        filename: `${sku}_fronte.jpg`,
        detected_sku: sku,
        status: 'valid',
      },
    ]);
  }
}

const MAPPING_BASE = { 'a-nome': 'nome', 'a-formato': 'formato', 'a-origine': 'origine' };

function importa(over: Record<string, unknown> = {}) {
  return confirmImportV2({
    batchId: BATCH,
    skuHeader: 'sku',
    attributeMapping: MAPPING_BASE,
    categoryHeader: 'categoria',
    options: { includeImageOnly: false, excludeIncomplete: false },
    ...over,
  } as never);
}

const prodotti = () => db.rows('products');
const fattiDi = (productId: string) =>
  db.rows('product_attribute_values').filter((r) => r.product_id === productId);

beforeEach(() => seedScenario());

// ---------------------------------------------------------------------------

describe('import: il percorso normale', () => {
  it('crea un prodotto per riga, con SKU e nome', async () => {
    const res = await importa();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.imported).toBe(2);
    expect(prodotti().map((p) => p.sku).sort()).toEqual(['FORM-1', 'OLIO-1']);
    expect(db.rows('products').find((p) => p.sku === 'OLIO-1')?.name).toBe('Olio EVO Coratina');
  });

  it('salva i fatti di ogni prodotto', async () => {
    await importa();
    const olio = prodotti().find((p) => p.sku === 'OLIO-1');
    const fatti = fattiDi(String(olio?.id));
    const perAttributo = new Map(fatti.map((f) => [f.attribute_id, f.value_json]));
    expect(perAttributo.get('a-formato')).toBe('500 ml');
    expect(perAttributo.get('a-origine')).toBe('Puglia');
  });

  it('i fatti sono marcati come provenienti dal file, non inventati', async () => {
    await importa();
    for (const f of db.rows('product_attribute_values')) {
      expect(f.source_type).toBe('spreadsheet');
      expect(f.status).toBe('provided');
    }
  });

  it('conserva la riga grezza: nessun dato del file viene buttato', async () => {
    await importa();
    const olio = prodotti().find((p) => p.sku === 'OLIO-1');
    expect(olio?.raw_input_json).toMatchObject({ sku: 'OLIO-1', origine: 'Puglia' });
  });

  it('aggiorna i contatori del batch con quello che è entrato davvero', async () => {
    const res = await importa();
    if (!res.ok) throw new Error(res.error);
    const batch = db.rows('batches').find((b) => b.id === BATCH);
    expect(batch?.total_products).toBe(res.data.imported);
    expect(batch?.status).toBe('input_review');
  });
});

describe('import: eleggibilità alla generazione', () => {
  it('con SKU e almeno due fatti il prodotto è idoneo — anche in un catalogo food', async () => {
    const res = await importa();
    if (!res.ok) throw new Error(res.error);
    // Il bug storico: qui usciva 0 perche' il conteggio usava una regola moda.
    expect(res.data.valid).toBe(2);
    expect(prodotti().every((p) => p.verification_status === 'eligible')).toBe(true);
  });

  it('SKU e nome soltanto non bastano: nome e categoria non contano come fatti', async () => {
    // Due valori mappati, ma entrambi identificativi: devono valere ZERO fatti
    // aggiuntivi. Con un solo valore il test non distinguerebbe una regola
    // giusta da una che conta tutto.
    seedScenario({ csv: 'sku,nome,categoria\nX-1,Solo nome,Olio EVO' });
    const res = await importa({
      attributeMapping: { 'a-nome': 'nome', 'a-cat': 'categoria' },
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.valid).toBe(0);
    expect(db.row('products').verification_status).toBe('excluded');
  });

  it('un solo fatto vero non basta: la soglia è due', async () => {
    seedScenario({ csv: 'sku,nome,formato\nX-1,Nome,500 ml' });
    const res = await importa({
      attributeMapping: { 'a-nome': 'nome', 'a-formato': 'formato' },
      categoryHeader: undefined,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.valid).toBe(0);
  });

  it('due fatti veri bastano, anche senza categoria', async () => {
    seedScenario({ csv: 'sku,formato,origine\nX-1,500 ml,Puglia' });
    const res = await importa({
      attributeMapping: { 'a-formato': 'formato', 'a-origine': 'origine' },
      categoryHeader: undefined,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.valid).toBe(1);
  });

  it('anche le colonne LIBERE contano come fatti', async () => {
    seedScenario({ csv: 'sku,peso,colore\nX-1,500 g,Verde' });
    const res = await importa({
      attributeMapping: {},
      categoryHeader: undefined,
      extraColumns: [
        { header: 'peso', name: 'Peso' },
        { header: 'colore', name: 'Colore' },
      ],
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.valid).toBe(1);
  });

  it('con "escludi incompleti" le righe non idonee non vengono nemmeno create', async () => {
    seedScenario({ csv: 'sku,nome,categoria\nX-1,Solo nome,Olio EVO' });
    const res = await importa({
      attributeMapping: { 'a-nome': 'nome' },
      options: { includeImageOnly: false, excludeIncomplete: true },
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imported).toBe(0);
    expect(prodotti()).toHaveLength(0);
  });
});

describe('import: la categoria', () => {
  it('la colonna categoria viene collegata alla categoria del preset', async () => {
    const res = await importa();
    if (!res.ok) throw new Error(res.error);
    expect(res.data.categoriesMatched).toBe(2);
    const olio = prodotti().find((p) => p.sku === 'OLIO-1');
    expect(olio?.category_id).toBe('c-olio');
    expect(olio?.category).toBe('Olio EVO');
  });

  it('riconosce la categoria anche con spazi e maiuscole diverse', async () => {
    seedScenario({ csv: 'sku,categoria,peso\nX-1,  olio evo  ,500 g' });
    const res = await importa({ attributeMapping: {}, extraColumns: [{ header: 'peso', name: 'Peso' }] });
    if (!res.ok) throw new Error(res.error);
    expect(db.row('products').category_id).toBe('c-olio');
    // Salva il nome del catalogo, non quello scritto nel file.
    expect(db.row('products').category).toBe('Olio EVO');
  });

  it('una categoria sconosciuta viene segnalata, non inventata', async () => {
    seedScenario({ csv: 'sku,categoria,peso\nX-1,Elettronica,500 g' });
    const res = await importa({ attributeMapping: {}, extraColumns: [{ header: 'peso', name: 'Peso' }] });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.unmatchedCategories).toContain('Elettronica');
    expect(db.row('products').category_id).toBeNull();
  });

  it('la rimappatura manuale dell’utente vince sul riconoscimento automatico', async () => {
    seedScenario({ csv: 'sku,categoria,peso\nX-1,Roba mia,500 g' });
    const res = await importa({
      attributeMapping: {},
      extraColumns: [{ header: 'peso', name: 'Peso' }],
      categoryOverrides: { 'Roba mia': 'c-form' },
    });
    if (!res.ok) throw new Error(res.error);
    expect(db.row('products').category_id).toBe('c-form');
    expect(res.data.unmatchedCategories).not.toContain('Roba mia');
  });

  it('la colonna Categoria dedicata ha la precedenza sull’attributo mappato', async () => {
    seedScenario({ csv: 'sku,categoria,cat_attr,peso\nX-1,Formaggi,Olio EVO,500 g' });
    const res = await importa({
      attributeMapping: { 'a-cat': 'cat_attr' },
      extraColumns: [{ header: 'peso', name: 'Peso' }],
    });
    if (!res.ok) throw new Error(res.error);
    expect(db.row('products').category_id).toBe('c-form');
  });

  it('senza colonna categoria i prodotti restano senza, pronti per le foto', async () => {
    seedScenario({ csv: 'sku,peso,origine\nX-1,500 g,Puglia' });
    const res = await importa({ attributeMapping: {}, categoryHeader: undefined, extraColumns: [
      { header: 'peso', name: 'Peso' },
      { header: 'origine', name: 'Origine' },
    ] });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.categoriesMatched).toBe(0);
    expect(db.row('products').category_id).toBeNull();
  });
});

describe('import: righe problematiche', () => {
  it('una riga senza SKU viene scartata, le altre entrano', async () => {
    seedScenario({ csv: 'sku,peso\nX-1,500 g\n,300 g\nX-2,200 g' });
    const res = await importa({ attributeMapping: {}, categoryHeader: undefined, extraColumns: [{ header: 'peso', name: 'Peso' }] });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imported).toBe(2);
    expect(res.data.invalid).toBeGreaterThanOrEqual(1);
  });

  it('SKU duplicato: vince la prima riga, la seconda è scartata', async () => {
    seedScenario({ csv: 'sku,peso\nX-1,500 g\nX-1,999 g' });
    const res = await importa({ attributeMapping: {}, categoryHeader: undefined, extraColumns: [{ header: 'peso', name: 'Peso' }] });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imported).toBe(1);
    const fatti = fattiDi(String(db.row('products').id));
    expect(fatti.map((f) => f.value_json)).toContain('500 g');
    expect(fatti.map((f) => f.value_json)).not.toContain('999 g');
  });

  it('celle vuote non diventano fatti vuoti', async () => {
    seedScenario({ csv: 'sku,peso,origine\nX-1,500 g,' });
    await importa({ attributeMapping: {}, categoryHeader: undefined, extraColumns: [
      { header: 'peso', name: 'Peso' },
      { header: 'origine', name: 'Origine' },
    ] });
    const valori = fattiDi(String(db.row('products').id)).map((f) => f.value_json);
    expect(valori).toEqual(['500 g']);
  });

  it('due colonne che puntano allo stesso attributo non fanno perdere i fatti', async () => {
    // Il vincolo unico (prodotto, attributo) e' reale: se un doppione arriva al
    // database, l'INTERO blocco di fatti viene rifiutato e il prodotto resta
    // senza dati. Due difese in fila lo impediscono: la guardia sulla chiave
    // canonica (che e' quella che scatta oggi) e la deduplica per attributo
    // (seconda linea, per quando la prima cambia forma). Togliendole entrambe
    // questo test diventa rosso — verificato.
    seedScenario({ csv: 'sku,peso,peso_bis,origine\nX-1,500 g,600 g,Puglia' });
    await importa({
      attributeMapping: {},
      categoryHeader: undefined,
      extraColumns: [
        { header: 'peso', name: 'Peso' },
        { header: 'peso_bis', name: 'Peso' },
        { header: 'origine', name: 'Origine' },
      ],
    });
    const fatti = fattiDi(String(db.row('products').id));
    expect(fatti.length).toBeGreaterThanOrEqual(2);
    expect(fatti.filter((f) => f.attribute_id === fatti[0]?.attribute_id)).toHaveLength(1);
  });

  it('file senza righe: nessun prodotto, nessun errore', async () => {
    seedScenario({ csv: 'sku,peso' });
    const res = await importa({ attributeMapping: {}, categoryHeader: undefined });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.imported).toBe(0);
  });

  it('file non più leggibile su storage: non importa nulla e non esplode', async () => {
    seedScenario();
    db.rows('source_files')[0]!.storage_path = 'sparito.csv';
    const res = await importa();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.imported).toBe(0);
    expect(prodotti()).toHaveLength(0);
  });

  it('colonna SKU inesistente nel file: nessun prodotto inventato', async () => {
    seedScenario();
    const res = await importa({ skuHeader: 'colonna_che_non_esiste' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.imported).toBe(0);
  });

  it('gli spazi attorno allo SKU non creano prodotti diversi', async () => {
    seedScenario({ csv: 'sku,peso\n  X-1  ,500 g\nX-1,600 g' });
    const res = await importa({ attributeMapping: {}, categoryHeader: undefined, extraColumns: [{ header: 'peso', name: 'Peso' }] });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imported).toBe(1);
    expect(db.row('products').sku).toBe('X-1');
  });
});

describe('import: immagini insieme al file', () => {
  it('collega le immagini ai prodotti con lo stesso SKU', async () => {
    seedScenario({ immagini: ['OLIO-1', 'FORM-1'] });
    await importa();
    const olio = prodotti().find((p) => p.sku === 'OLIO-1');
    const link = db.rows('product_source_links').filter((l) => l.product_id === olio?.id);
    expect(link).toHaveLength(1);
    expect(link[0]?.link_type).toBe('sku_exact');
  });

  it('SKU presenti in entrambe le sorgenti: i prodotti vengono dal file, non duplicati', async () => {
    // Il guasto storico: lo spreadsheet non veniva collegato e l'app diceva
    // "solo immagini" pur avendo entrambi i file.
    seedScenario({ immagini: ['OLIO-1', 'FORM-1'] });
    const res = await importa({ options: { includeImageOnly: true, excludeIncomplete: false } });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imported).toBe(2);
    expect(res.data.imageOnly).toBe(0);
  });

  it('un’immagine con SKU non nel file diventa un prodotto solo-foto, se richiesto', async () => {
    seedScenario({ immagini: ['OLIO-1', 'NUOVO-9'] });
    const res = await importa({ options: { includeImageOnly: true, excludeIncomplete: false } });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imageOnly).toBe(1);
    const nuovo = prodotti().find((p) => p.sku === 'NUOVO-9');
    expect(nuovo?.verification_status).toBe('excluded');
  });

  it('senza l’opzione, le immagini orfane non creano prodotti', async () => {
    seedScenario({ immagini: ['NUOVO-9'] });
    const res = await importa();
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imageOnly).toBe(0);
    expect(prodotti().find((p) => p.sku === 'NUOVO-9')).toBeUndefined();
  });
});

describe('import: rifare l’import dello stesso batch', () => {
  it('non duplica i prodotti', async () => {
    await importa();
    await importa();
    expect(prodotti()).toHaveLength(2);
  });

  it('il secondo import rispecchia il file NUOVO, non quello vecchio', async () => {
    // Senza la pulizia dell'import precedente questo test resta rosso: i
    // prodotti vecchi sopravvivono e i nuovi non entrano (vincolo unico).
    // Contarli soltanto non basterebbe: passerebbe per il motivo sbagliato.
    await importa();
    expect(prodotti().map((p) => p.sku).sort()).toEqual(['FORM-1', 'OLIO-1']);

    db.seedFile(BUCKET, 'catalogo.csv', 'sku,nome,categoria,formato,origine\nNUOVO-9,Prodotto nuovo,Formaggi,1 kg,Lazio');
    const res = await importa();
    if (!res.ok) throw new Error(res.error);

    expect(res.data.imported).toBe(1);
    expect(prodotti().map((p) => p.sku)).toEqual(['NUOVO-9']);
  });

  it('il secondo import non lascia in giro i fatti dei prodotti spariti', async () => {
    await importa();
    db.seedFile(BUCKET, 'catalogo.csv', 'sku,nome,categoria,formato,origine\nNUOVO-9,Prodotto nuovo,Formaggi,1 kg,Lazio');
    await importa();

    const idsVivi = new Set(prodotti().map((p) => p.id));
    const orfani = db.rows('product_attribute_values').filter((f) => !idsVivi.has(f.product_id));
    expect(orfani).toEqual([]);
  });

  it('conserva i fatti che l’utente aveva confermato a mano', async () => {
    await importa();
    const olio = prodotti().find((p) => p.sku === 'OLIO-1');
    db.seed('product_attribute_values', [
      {
        id: 'confermato',
        organization_id: ORG,
        product_id: olio?.id,
        attribute_id: 'a-cat',
        value_json: 'Verificato a mano',
        status: 'confirmed',
        source_type: 'image',
        source_item_id: null,
      },
    ]);

    await importa();

    const nuovoOlio = prodotti().find((p) => p.sku === 'OLIO-1');
    const ripristinato = fattiDi(String(nuovoOlio?.id)).find((f) => f.attribute_id === 'a-cat');
    expect(ripristinato?.value_json).toBe('Verificato a mano');
    expect(ripristinato?.status).toBe('confirmed');
  });
});

describe('import: scritture a blocchi', () => {
  function csvGrande(n: number): string {
    const righe = ['sku,peso,origine'];
    for (let i = 0; i < n; i++) righe.push(`SKU-${i},${i} g,Italia`);
    return righe.join('\n');
  }

  it('250 prodotti entrano tutti', async () => {
    seedScenario({ csv: csvGrande(250) });
    const res = await importa({
      attributeMapping: {},
      categoryHeader: undefined,
      extraColumns: [
        { header: 'peso', name: 'Peso' },
        { header: 'origine', name: 'Origine' },
      ],
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.imported).toBe(250);
    expect(prodotti()).toHaveLength(250);
  });

  it('e in POCHE scritture, non una per prodotto', async () => {
    seedScenario({ csv: csvGrande(250) });
    const prima = db.calls.length;
    await importa({
      attributeMapping: {},
      categoryHeader: undefined,
      extraColumns: [
        { header: 'peso', name: 'Peso' },
        { header: 'origine', name: 'Origine' },
      ],
    });
    const scritture = db.calls
      .slice(prima)
      .filter((c) => c.op === 'insert' && (c.table === 'products' || c.table === 'product_attribute_values'));
    // A blocchi: ~3 per i prodotti + ~1 per i fatti. Una per prodotto sarebbero 500.
    expect(scritture.length).toBeLessThanOrEqual(12);
  });

  it('ogni prodotto conserva i propri fatti, non quelli di un altro', async () => {
    seedScenario({ csv: csvGrande(120) });
    await importa({
      attributeMapping: {},
      categoryHeader: undefined,
      extraColumns: [
        { header: 'peso', name: 'Peso' },
        { header: 'origine', name: 'Origine' },
      ],
    });
    for (const sku of ['SKU-0', 'SKU-99', 'SKU-119']) {
      const p = prodotti().find((x) => x.sku === sku);
      const valori = fattiDi(String(p?.id)).map((f) => String(f.value_json));
      const atteso = `${sku.split('-')[1]} g`;
      expect(valori, `fatti di ${sku}`).toContain(atteso);
    }
  });
});

describe('import: accessi', () => {
  it('un batch di un’altra organizzazione viene rifiutato e non scrive nulla', async () => {
    const res = await importa({ batchId: 'batch-inesistente' });
    expect(res.ok).toBe(false);
    expect(prodotti()).toHaveLength(0);
  });

  it('tutti i prodotti creati appartengono all’organizzazione del batch', async () => {
    await importa();
    expect(prodotti().every((p) => p.organization_id === ORG)).toBe(true);
    expect(db.rows('product_attribute_values').every((f) => f.organization_id === ORG)).toBe(true);
  });

  it('i prodotti sono legati alla versione di preset del batch', async () => {
    await importa();
    expect(prodotti().every((p) => p.preset_version_id === 'v1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('import: quando una scrittura fallisce', () => {
  // Fino a ieri queste scritture usavano `mustWrite` con l'esito buttato via.
  // L'import proseguiva, rispondeva `ok` e l'utente vedeva "importato" davanti
  // a un batch che non era cambiato. Il finto database sa guastarsi a comando,
  // quindi adesso il comportamento si puo' verificare invece che sperare.

  it('non dichiara riuscito un re-import che non ha ripulito il precedente', async () => {
    await importa();
    const primaVolta = prodotti().length;
    expect(primaVolta).toBeGreaterThan(0);

    db.guasta('products', 'delete', 'permission denied for table products');
    const res = await importa();

    expect(res.ok).toBe(false);
    expect(String((res as { error?: string }).error)).toMatch(/import precedente non rimosso/i);
    // E i prodotti di prima sono ancora tutti li': niente stato a meta'.
    expect(prodotti()).toHaveLength(primaVolta);
  });

  it('non dichiara riuscito un import che non ha aggiornato lo stato del batch', async () => {
    db.guasta('batches', 'update', 'invalid input value for enum batch_status');
    const res = await importa();

    expect(res.ok).toBe(false);
    expect(String((res as { error?: string }).error)).toMatch(/stato del batch/i);
  });

  it('un fatto non salvato lascia una traccia interrogabile, non solo un log', async () => {
    // I fatti sono la ragione per cui un prodotto e' generabile. Se non
    // arrivano a database e nessuno lo registra, il prodotto risulta importato
    // e vuoto, e non c'e' modo di sapere perche'.
    db.guasta('product_attribute_values', 'insert', 'value too long for type character varying');
    await importa();

    const tracce = db.rows('app_events').filter((e) => e.event_name === 'write_failed');
    expect(tracce.length).toBeGreaterThan(0);
    const meta = tracce[0]!.metadata_json as Record<string, unknown>;
    expect(String(meta.operazione)).toContain('product_attribute_values');
    expect(String(meta.errore)).toContain('value too long');
  });
});
