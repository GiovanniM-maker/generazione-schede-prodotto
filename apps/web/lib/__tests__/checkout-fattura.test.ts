import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Non si incassa se non si può fatturare.
//
// Il checkout non guardava i dati di fatturazione perché non esistevano: si
// pagava, e poi la fattura non si poteva emettere perché mancavano ragione
// sociale, partita IVA e codice destinatario. Restituire i soldi costa più che
// fermarsi un attimo prima.
//
// Il controllo sta nel server, non nel form: il form si può aggirare, la rotta
// no.
// ---------------------------------------------------------------------------

interface StatoFinto {
  ruolo?: 'owner' | 'member';
  org?: Record<string, unknown> | null;
  prodotto?: Record<string, unknown> | null;
}

let stato: StatoFinto = {};
let sessioniCreate: Array<Record<string, unknown>> = [];
let clientiAggiornati: Array<Record<string, unknown>> = [];
let partiteIvaCreate: string[] = [];
let rpcChiamate: Array<{ fn: string; args: Record<string, unknown> }> = [];

const ORG_COMPLETA = {
  id: 'org-1',
  name: 'Cascina Verde',
  stripe_customer_id: 'cus_1',
  billing_name: 'Cascina Verde S.r.l.',
  vat_number: '00743110157',
  tax_code: null,
  sdi_code: 'M5UXCR1',
  pec_email: null,
  billing_address: 'Via Roma 1',
  billing_zip: '20121',
  billing_city: 'Milano',
  billing_province: 'MI',
  billing_country: 'IT',
};

vi.mock('@/lib/env.server', () => ({
  getServerEnv: () => ({
    ENABLE_MOCK_BILLING: false,
    NEXT_PUBLIC_APP_URL: 'https://app.test',
  }),
}));

vi.mock('@/lib/auth', () => ({
  getSessionUser: async () => ({ id: 'user-1', email: 'chi@paga.it' }),
  getUserOrg: async () => ({ organizationId: 'org-1', role: stato.ruolo ?? 'owner' }),
}));

vi.mock('@/lib/stripe', () => ({
  priceIdForPack: () => 'price_1',
  getStripe: () => ({
    customers: {
      create: async (args: Record<string, unknown>) => {
        clientiAggiornati.push(args);
        return { id: 'cus_new' };
      },
      update: async (_id: string, args: Record<string, unknown>) => {
        clientiAggiornati.push(args);
        return { id: 'cus_1' };
      },
      listTaxIds: async () => ({ data: [] }),
      createTaxId: async (_id: string, args: { value: string }) => {
        partiteIvaCreate.push(args.value);
        return { id: 'txi_1' };
      },
      deleteTaxId: async () => ({ deleted: true }),
    },
    checkout: {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          sessioniCreate.push(args);
          return { url: 'https://checkout.stripe.com/x' };
        },
      },
    },
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      rpcChiamate.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
    from(tabella: string) {
      const catena: Record<string, unknown> = {};
      Object.assign(catena, {
        select: () => catena,
        update: () => catena,
        insert: () => Promise.resolve({ data: null, error: null }),
        eq: () => catena,
        single: async () =>
          tabella === 'billing_products'
            ? { data: stato.prodotto === undefined ? { key: 'pack_50', credits: 50, name: '50 schede', price_cents: 2900, currency: 'EUR' } : stato.prodotto, error: null }
            : { data: stato.org === undefined ? ORG_COMPLETA : stato.org, error: null },
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r),
      });
      return catena;
    },
  }),
}));

const { POST } = await import('@/app/api/stripe/checkout/route');

function richiesta(packKey = 'pack_50'): Request {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packKey }),
  });
}

const corpo = async (res: Response) => (await res.json()) as Record<string, unknown>;

beforeEach(() => {
  stato = {};
  sessioniCreate = [];
  clientiAggiornati = [];
  partiteIvaCreate = [];
  rpcChiamate = [];
});

// ---------------------------------------------------------------------------

describe('prima di far pagare', () => {
  it('con i dati completi apre il checkout', async () => {
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect((await corpo(res)).url).toBe('https://checkout.stripe.com/x');
  });

  it('senza ragione sociale si ferma, e dice dove sistemarlo', async () => {
    stato.org = { ...ORG_COMPLETA, billing_name: null };
    const res = await POST(richiesta());
    expect(res.status).toBe(409);
    const b = await corpo(res);
    // Il flag serve all'interfaccia per portare l'utente al form invece di
    // lasciarlo davanti a un errore senza uscita.
    expect(b.missingBilling).toBe(true);
    expect(sessioniCreate).toHaveLength(0);
  });

  it('senza partita IVA né codice fiscale si ferma', async () => {
    stato.org = { ...ORG_COMPLETA, vat_number: null, tax_code: null };
    const res = await POST(richiesta());
    expect(res.status).toBe(409);
    expect(sessioniCreate).toHaveLength(0);
  });

  it('in Italia, senza codice destinatario né PEC si ferma', async () => {
    stato.org = { ...ORG_COMPLETA, sdi_code: null, pec_email: null };
    const res = await POST(richiesta());
    expect(res.status).toBe(409);
    expect(sessioniCreate).toHaveLength(0);
  });

  it('fuori dall’Italia lo SDI non si pretende: la vendita passa', async () => {
    stato.org = {
      ...ORG_COMPLETA,
      sdi_code: null,
      pec_email: null,
      billing_country: 'FR',
      vat_number: '40303265045',
    };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
  });

  it('un pacchetto senza prezzo non si vende', async () => {
    // Sulla landing non compare, ma la rotta è raggiungibile lo stesso: senza
    // cifra non c'è né consenso né fattura.
    stato.prodotto = { key: 'pack_50', credits: 50, name: '50 schede', price_cents: null, currency: 'EUR' };
    const res = await POST(richiesta());
    expect(res.status).toBe(409);
    expect(sessioniCreate).toHaveLength(0);
  });

  it('un membro non compra: sono soldi dell’organizzazione', async () => {
    stato.ruolo = 'member';
    const res = await POST(richiesta());
    expect(res.status).toBe(403);
    expect(sessioniCreate).toHaveLength(0);
  });
});

describe('cosa arriva a Stripe', () => {
  it('la ragione sociale della fattura, non il nome dell’organizzazione', async () => {
    // «Cascina Verde» è come si chiamano, «Cascina Verde S.r.l.» è chi emette
    // la fattura: sulla fattura va il secondo.
    await POST(richiesta());
    expect(clientiAggiornati[0]).toMatchObject({ name: 'Cascina Verde S.r.l.' });
  });

  it('l’indirizzo di fatturazione', async () => {
    await POST(richiesta());
    expect(clientiAggiornati[0]).toMatchObject({
      address: { line1: 'Via Roma 1', postal_code: '20121', city: 'Milano', country: 'IT' },
    });
  });

  it('la partita IVA col prefisso del paese, che Stripe pretende', async () => {
    await POST(richiesta());
    expect(partiteIvaCreate).toEqual(['IT00743110157']);
  });

  it('fuori dall’Unione non dichiara una VAT europea', async () => {
    // Stripe rifiuterebbe il tipo `eu_vat` per un paese extra-UE e l'acquisto
    // fallirebbe del tutto.
    stato.org = { ...ORG_COMPLETA, billing_country: 'CH', vat_number: 'CHE123456789' };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(partiteIvaCreate).toEqual([]);
  });

  it('il codice destinatario, che Stripe non ha come campo suo', async () => {
    await POST(richiesta());
    const sessione = sessioniCreate[0] as {
      invoice_creation?: { invoice_data?: { custom_fields?: { name: string; value: string }[] } };
    };
    expect(sessione.invoice_creation?.invoice_data?.custom_fields).toContainEqual({
      name: 'Codice destinatario',
      value: 'M5UXCR1',
    });
  });

  it('chiede la fattura: senza, Stripe incassa e basta', async () => {
    await POST(richiesta());
    expect(sessioniCreate[0]).toMatchObject({ invoice_creation: { enabled: true } });
  });
});
