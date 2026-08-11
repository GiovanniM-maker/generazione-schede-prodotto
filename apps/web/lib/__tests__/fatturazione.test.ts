import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';
import { datiFatturaCompleti } from '../fattura.js';

// ---------------------------------------------------------------------------
// I dati per la fattura.
//
// Senza partita IVA e codice destinatario nessun cliente B2B italiano può
// comprare: la fattura elettronica non è un optional, è come funziona la
// fatturazione in Italia. Nel repository non ce n'era traccia — nessun campo,
// nessun controllo, nessuna schermata: si pagava e poi non arrivava niente di
// utilizzabile.
//
// Questi test fissano due cose. La prima è che i dati sbagliati vengano
// rifiutati QUI, dove si può ancora correggerli, e non dallo SDI tre giorni
// dopo. La seconda è che la regola su «quando si può fatturare» resti una sola:
// la usano il form e il checkout, e se divergono vince la più permissiva —
// quella che fa incassare senza poter emettere.
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

const fatturazione = await import('../actions/fatturazione.js');

const VALIDI = {
  billingName: 'Cascina Verde S.r.l.',
  vatNumber: '00743110157',
  sdiCode: '0000000',
  pecEmail: 'cascina@pec.it',
  address: 'Via Roma 1',
  zip: '20121',
  city: 'Milano',
  province: 'MI',
};

function semina() {
  db = new FakeDb({ schema: SCHEMA_APP });
  db.seed('organizations', [{ id: ORG, name: 'Cascina Verde' }]);
  db.seed('organization_members', [
    { id: 'm1', organization_id: ORG, user_id: PROPRIETARIO, role: 'owner' },
    { id: 'm2', organization_id: ORG, user_id: MEMBRO, role: 'member' },
  ]);
}

const errore = (r: unknown) => String((r as { error?: string }).error ?? '');
const org = () => db.row('organizations');

beforeEach(() => {
  semina();
  utenteCorrente = PROPRIETARIO;
});

// ---------------------------------------------------------------------------

describe('chi può cambiare i dati della fattura', () => {
  it('un membro no: è la ragione sociale con cui l’azienda risponde', async () => {
    utenteCorrente = MEMBRO;
    const res = await fatturazione.salvaDatiFatturazione(VALIDI);
    expect(res.ok).toBe(false);
    expect(errore(res)).toMatch(/solo il proprietario/i);
    expect(org().billing_name).toBeUndefined();
  });

  it('il proprietario sì', async () => {
    const res = await fatturazione.salvaDatiFatturazione(VALIDI);
    expect(res.ok).toBe(true);
    expect(org().billing_name).toBe('Cascina Verde S.r.l.');
  });
});

describe('cosa si rifiuta prima di arrivare allo SDI', () => {
  it('una partita IVA con il controllo sbagliato', async () => {
    // Undici cifre non bastano: senza il carattere di controllo la fattura
    // torna indietro dopo l’invio, quando il pagamento è già avvenuto.
    const res = await fatturazione.salvaDatiFatturazione({ ...VALIDI, vatNumber: '00743110158' });
    expect(res.ok).toBe(false);
    expect(errore(res)).toMatch(/partita IVA non è valida/i);
    expect(org().vat_number).toBeUndefined();
  });

  it('nessun modo di identificare il cliente', async () => {
    const res = await fatturazione.salvaDatiFatturazione({
      ...VALIDI,
      vatNumber: '',
      taxCode: '',
    });
    expect(res.ok).toBe(false);
    expect(errore(res)).toMatch(/partita IVA o.*codice fiscale/i);
  });

  it('in Italia, nessun recapito dove mandare il documento', async () => {
    const res = await fatturazione.salvaDatiFatturazione({
      ...VALIDI,
      sdiCode: '',
      pecEmail: '',
    });
    expect(res.ok).toBe(false);
    // Il messaggio non dice solo «manca»: dice cosa scrivere quando non si ha
    // un codice, che è la domanda che fa chiunque la prima volta.
    expect(errore(res)).toMatch(/0000000/);
  });

  it('un codice destinatario della lunghezza sbagliata', async () => {
    const res = await fatturazione.salvaDatiFatturazione({ ...VALIDI, sdiCode: 'ABC12' });
    expect(res.ok).toBe(false);
    expect(errore(res)).toMatch(/7 caratteri/);
  });

  it('un indirizzo incompleto', async () => {
    const res = await fatturazione.salvaDatiFatturazione({ ...VALIDI, city: '   ' });
    expect(res.ok).toBe(false);
    expect(errore(res)).toMatch(/indirizzo, CAP e città/i);
  });
});

describe('cosa si accetta, perché rifiutarlo sarebbe peggio', () => {
  it('una partita IVA estera, che segue regole non nostre', async () => {
    // Il controllo italiano applicato a una VAT francese la boccerebbe pur
    // essendo valida: fuori dall’Italia non lo si applica.
    const res = await fatturazione.salvaDatiFatturazione({
      ...VALIDI,
      country: 'FR',
      vatNumber: '40303265045',
      sdiCode: '',
      pecEmail: '',
    });
    expect(res.ok).toBe(true);
    expect(org().billing_country).toBe('FR');
  });

  it('la partita IVA scritta come la scrive la gente: «IT» e spazi', async () => {
    const res = await fatturazione.salvaDatiFatturazione({
      ...VALIDI,
      vatNumber: 'IT 007 431 101 57',
    });
    expect(res.ok).toBe(true);
    // Normalizzata in archivio: il prefisso lo rimette il checkout quando
    // serve, e due formati diversi per lo stesso numero non aiutano nessuno.
    expect(org().vat_number).toBe('00743110157');
  });

  it('un privato senza partita IVA ma con codice fiscale', async () => {
    const res = await fatturazione.salvaDatiFatturazione({
      ...VALIDI,
      vatNumber: '',
      taxCode: 'rssmra80a01h501u',
    });
    expect(res.ok).toBe(true);
    expect(org().tax_code).toBe('RSSMRA80A01H501U');
  });
});

describe('quando i dati bastano per emettere', () => {
  it('lo dice solo se ci sono tutti', async () => {
    const res = await fatturazione.salvaDatiFatturazione(VALIDI);
    expect(res).toMatchObject({ ok: true, data: { completi: true } });
  });

  it('fuori dall’Italia non pretende lo SDI, che lì non esiste', () => {
    expect(
      datiFatturaCompleti({
        billing_name: 'Ferme Verte SARL',
        vat_number: '40303265045',
        billing_address: 'Rue de Rivoli 1',
        billing_zip: '75001',
        billing_city: 'Paris',
        billing_country: 'FR',
      }),
    ).toBe(true);
  });

  it('in Italia senza SDI né PEC non bastano', () => {
    expect(
      datiFatturaCompleti({
        billing_name: 'Cascina Verde S.r.l.',
        vat_number: '00743110157',
        billing_address: 'Via Roma 1',
        billing_zip: '20121',
        billing_city: 'Milano',
        billing_country: 'IT',
      }),
    ).toBe(false);
  });

  it('senza paese si assume l’Italia, la regola più severa', () => {
    // Sbagliare per eccesso di rigore fa perdere una vendita; sbagliare per
    // difetto fa incassare senza poter fatturare.
    expect(
      datiFatturaCompleti({
        billing_name: 'Cascina Verde S.r.l.',
        vat_number: '00743110157',
        billing_address: 'Via Roma 1',
        billing_zip: '20121',
        billing_city: 'Milano',
      }),
    ).toBe(false);
  });

  it('su un’organizzazione vuota non promette niente', () => {
    expect(datiFatturaCompleti(null)).toBe(false);
    expect(datiFatturaCompleti({})).toBe(false);
  });
});

describe('quando il salvataggio non riesce', () => {
  it('lo dice, invece di rispondere «salvato»', async () => {
    // È la famiglia di bug più insidiosa del progetto: la scrittura fallisce e
    // l’interfaccia mostra il segno di spunta.
    db.guasta('organizations', 'update', 'connessione persa');
    const res = await fatturazione.salvaDatiFatturazione(VALIDI);
    expect(res.ok).toBe(false);
    expect(errore(res)).toMatch(/connessione persa/);
  });
});

describe('rileggere i dati', () => {
  it('restituisce quello che è stato salvato', async () => {
    await fatturazione.salvaDatiFatturazione(VALIDI);
    const res = await fatturazione.leggiDatiFatturazione();
    expect(res).toMatchObject({
      ok: true,
      data: { billingName: 'Cascina Verde S.r.l.', vatNumber: '00743110157', completi: true },
    });
  });

  it('su un’organizzazione nuova dice che manca tutto, senza inventare', async () => {
    const res = await fatturazione.leggiDatiFatturazione();
    expect(res).toMatchObject({ ok: true, data: { billingName: null, completi: false } });
  });
});
