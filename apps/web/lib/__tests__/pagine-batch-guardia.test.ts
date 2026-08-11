import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Nessuna pagina di batch si apre su un batch che non esiste.
//
// `/app/batches/[id]/mapping` è stata tolta perché si apriva sempre vuota: un
// vicolo cieco raggiungibile dalla dashboard. Ma il difetto non era della
// pagina, era del modo di scriverle — e infatti era sopravvissuto in altre
// quattro. Tutte controllavano che ci fosse una sessione, nessuna che il batch
// esistesse o fosse tuo: le regole di accesso del database tenevano al sicuro i
// dati, ma la pagina si disegnava lo stesso, con la tabella vuota e i pulsanti
// che portavano avanti.
//
// Il primo test qui sotto è quello che conta: non guarda le quattro pagine di
// oggi, guarda anche la quinta che qualcuno aggiungerà fra sei mesi.
// ---------------------------------------------------------------------------

const DIR_PAGINE = join(process.cwd(), 'apps/web/app/app/batches/[batchId]');

const pagine = readdirSync(DIR_PAGINE, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ nome: e.name, src: readFileSync(join(DIR_PAGINE, e.name, 'page.tsx'), 'utf8') }));

describe('la guardia sulle pagine di un batch', () => {
  it('trova le pagine da controllare (se questo numero crolla, l’analisi è rotta)', () => {
    expect(pagine.map((p) => p.nome).sort()).toEqual(['input', 'processing', 'results', 'sample']);
  });

  it('ogni pagina chiede prima se il batch esiste', () => {
    const scoperte = pagine.filter((p) => !/\bbatchDiPagina\s*\(/.test(p.src)).map((p) => p.nome);
    expect(scoperte).toEqual([]);
  });

  it('e lo chiede PRIMA di leggere altro', () => {
    // Leggere i prodotti di un batch inesistente dà zero righe, identiche a
    // quelle di un batch vuoto: se la guardia arriva dopo, la pagina ha già
    // deciso cosa mostrare.
    const tardive = pagine
      .filter((p) => {
        const guardia = p.src.indexOf('await batchDiPagina(');
        const primaLettura = p.src.search(/await supabase\s*\n?\s*\.from\(|\.from\('products'\)/);
        return guardia >= 0 && primaLettura >= 0 && primaLettura < guardia;
      })
      .map((p) => p.nome);
    expect(tardive).toEqual([]);
  });

  it('esiste una pagina che spiega il 404, invece di una schermata nuda', () => {
    const src = readFileSync(join(DIR_PAGINE, 'not-found.tsx'), 'utf8');
    // Deve dire cosa è successo e dare un'uscita: un «404» da solo lascia
    // l'utente a chiedersi se il guasto è del prodotto.
    expect(src).toMatch(/eliminato/i);
    expect(src).toMatch(/altra organizzazione/i);
    expect(src).toContain('href="/app"');
  });
});

// ---------------------------------------------------------------------------

const ORG = 'org-1';
const ALTRA = 'org-2';
let db: FakeDb;

const nonTrovato = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw nonTrovato;
  },
}));
// Il client "server" replica le regole di accesso: vede solo i batch
// dell'organizzazione di chi sta chiedendo. È il punto su cui poggia tutto
// questo controllo, quindi il finto deve comportarsi così.
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (tabella: string) => {
      const q = db.from(tabella);
      if (tabella === 'batches') q.eq('organization_id', ORG);
      return q;
    },
  }),
}));

const { batchDiPagina } = await import('../batch-page.js');

beforeEach(() => {
  db = new FakeDb({ schema: SCHEMA_APP });
  db.seed('batches', [
    { id: 'b1', organization_id: ORG, name: 'Listino primavera', status: 'input_review' },
    { id: 'b2', organization_id: ALTRA, name: 'Roba di altri', status: 'completed' },
  ]);
});

describe('cosa fa la guardia', () => {
  it('restituisce il batch quando è tuo', async () => {
    await expect(batchDiPagina('b1')).resolves.toMatchObject({
      id: 'b1',
      name: 'Listino primavera',
      status: 'input_review',
    });
  });

  it('su un batch di un’altra organizzazione fa 404, non una pagina vuota', async () => {
    await expect(batchDiPagina('b2')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('su un batch che non esiste fa 404', async () => {
    await expect(batchDiPagina('mai-esistito')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('l’assenza del profilo di brand è `null`, non una chiave che manca', async () => {
    // Non c'è un `?? null` a proteggere questa riga: la colonna è nullable e la
    // query la chiede sempre, quindi il valore c'è ed è `null`. Il test fissa
    // la forma, perché chi legge fa `Boolean(batch.brandProfileVersionId)` e su
    // una chiave assente non se ne accorgerebbe.
    await expect(batchDiPagina('b1')).resolves.toMatchObject({ brandProfileVersionId: null });
  });
});
