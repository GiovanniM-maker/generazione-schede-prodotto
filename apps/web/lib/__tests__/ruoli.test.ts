import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// I ruoli, applicati sul serio.
//
// `organization_members.role` esisteva da sempre e l'interfaccia mostrava il
// badge «Proprietario / Membro». Il server lo controllava in DUE file su tutto
// il progetto: ovunque altro si passava dal client di servizio, che scavalca le
// regole di accesso del database senza mai guardare chi sta chiedendo. Un
// semplice membro comprava crediti, cancellava batch interi, riscriveva i
// preset.
//
// Una distinzione mostrata e non applicata è peggio di nessuna distinzione:
// promette una protezione che non c'è.
//
// La linea: **il membro fa il lavoro, il proprietario decide i soldi e le
// regole.** Questi test la fissano azione per azione — e soprattutto
// verificano che un'azione NUOVA nasca protetta, perché è lì che una regola
// del genere si perde: non quando la si scrive, ma sei mesi dopo.
// ---------------------------------------------------------------------------

const ORG = 'org-1';
const PROPRIETARIO = 'user-owner';
const MEMBRO = 'user-member';

let db: FakeDb;
let utenteCorrente = PROPRIETARIO;

vi.mock('@/lib/supabase/service', () => ({ getServiceClient: () => db }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => db }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: async () => ({ id: utenteCorrente }),
  getUserOrg: async (userId: string) => {
    const m = db.rows('organization_members').find((r) => r.user_id === userId);
    return m ? { organizationId: m.organization_id as string, role: m.role as string } : null;
  },
}));

const catalogo = await import('../actions/catalog.js');

function semina() {
  db = new FakeDb({ schema: SCHEMA_APP });
  db.seed('organizations', [{ id: ORG, name: 'Prova' }]);
  db.seed('organization_members', [
    { id: 'm1', organization_id: ORG, user_id: PROPRIETARIO, role: 'owner' },
    { id: 'm2', organization_id: ORG, user_id: MEMBRO, role: 'member' },
  ]);
  db.seed('sectors', [{ id: 'food', name: 'Food', slug: 'food' }]);
}

const errore = (r: unknown) => String((r as { error?: string }).error ?? '');

beforeEach(() => {
  semina();
  utenteCorrente = PROPRIETARIO;
});

// ---------------------------------------------------------------------------

describe('il catalogo lo cambia solo il proprietario', () => {
  it('un membro non può creare un preset', async () => {
    utenteCorrente = MEMBRO;
    const res = await catalogo.createPreset({ sectorId: 'food', name: 'Suo preset' });
    expect(res.ok).toBe(false);
    // Il messaggio dice CHI può farlo: «non autorizzato» lascia l'utente a
    // chiedersi se è un guasto.
    expect(errore(res)).toMatch(/solo il proprietario/i);
    expect(db.rows('presets')).toHaveLength(0);
  });

  it('il proprietario invece può', async () => {
    const res = await catalogo.createPreset({ sectorId: 'food', name: 'Preset Food' });
    expect(res.ok).toBe(true);
    expect(db.rows('presets')).toHaveLength(1);
  });

  it('un membro non può creare categorie', async () => {
    utenteCorrente = MEMBRO;
    const res = await catalogo.createCategory({ sectorId: 'food', name: 'Olio EVO' });
    expect(res.ok).toBe(false);
    expect(db.rows('categories')).toHaveLength(0);
  });

  it('un membro non può creare attributi', async () => {
    utenteCorrente = MEMBRO;
    const res = await catalogo.createAttribute({
      sectorId: 'food',
      name: 'Formato',
      dataType: 'text',
    } as never);
    expect(res.ok).toBe(false);
    expect(db.rows('attributes')).toHaveLength(0);
  });

  it('un membro non può svuotare una versione di preset', async () => {
    utenteCorrente = MEMBRO;
    const res = await catalogo.clearPresetVersion({ presetId: 'p1' } as never);
    expect(res.ok).toBe(false);
    expect(errore(res)).toMatch(/solo il proprietario/i);
  });
});

describe('leggere resta di tutti', () => {
  // Un membro deve poter vedere la configurazione per fare il suo lavoro:
  // chiudergli anche la lettura lo bloccherebbe senza motivo.
  it('un membro vede i settori', async () => {
    utenteCorrente = MEMBRO;
    expect((await catalogo.listSectors()).ok).toBe(true);
  });

  it('un membro vede i preset', async () => {
    utenteCorrente = MEMBRO;
    expect((await catalogo.listPresets()).ok).toBe(true);
  });

  it('un membro vede categorie e attributi', async () => {
    utenteCorrente = MEMBRO;
    expect((await catalogo.listCategories()).ok).toBe(true);
    expect((await catalogo.listAttributes()).ok).toBe(true);
  });
});

describe('la regola non si perde per strada', () => {
  /**
   * Le sole azioni del catalogo aperte anche ai membri. Tutte le altre sono di
   * chi possiede l'organizzazione — **per costruzione**, perché il guardiano
   * comune pretende il proprietario se non gli si dice il contrario.
   */
  const APERTE_AI_MEMBRI = new Set([
    'listSectors',
    'listPresets',
    'getPresetDetail',
    'listCategories',
    'getCategoryDetail',
    'listAttributes',
    'getAttributeDetail',
  ]);

  it('ogni azione del catalogo o è di lettura o è del proprietario', async () => {
    utenteCorrente = MEMBRO;
    const nomi = Object.keys(catalogo).filter(
      (k) => typeof (catalogo as Record<string, unknown>)[k] === 'function',
    );
    expect(nomi.length).toBeGreaterThan(20);

    const passateAlMembro: string[] = [];
    for (const nome of nomi) {
      if (APERTE_AI_MEMBRI.has(nome)) continue;
      const fn = (catalogo as unknown as Record<string, (i: unknown) => Promise<unknown>>)[nome]!;
      // Le si passa un input vuoto: se il ruolo è controllato per primo — e
      // deve esserlo — la risposta è il rifiuto, non un errore di validazione.
      const res = await fn({}).catch((e: unknown) => ({ ok: false, error: String(e) }));
      const messaggio = errore(res);
      const rifiutata = (res as { ok?: boolean }).ok === false && /solo il proprietario/i.test(messaggio);
      if (!rifiutata) passateAlMembro.push(`${nome} → ${messaggio.slice(0, 60) || 'ok'}`);
    }

    // Se questo elenco non è vuoto, qualcuno ha aggiunto un'azione al catalogo
    // saltando il guardiano comune. È esattamente il modo in cui una regola
    // così si perde.
    expect(passateAlMembro).toEqual([]);
  });
});
