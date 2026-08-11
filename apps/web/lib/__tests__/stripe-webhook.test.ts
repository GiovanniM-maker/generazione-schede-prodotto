import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Il webhook di Stripe: dove i soldi diventano crediti.
//
// Era la rotta piu' delicata del prodotto e non aveva un solo test. Tre modi
// di sbagliare, tutti costosi in modo diverso:
//
//   - accreditare due volte lo stesso pagamento  → si regalano crediti;
//   - non accreditare e rispondere 200           → il cliente paga e non riceve
//                                                  niente, e Stripe non riprova;
//   - accettare un evento con firma non valida   → chiunque puo' regalarsi crediti.
//
// Il secondo caso era reale: l'errore di `apply_credit_purchase` veniva
// buttato via, l'evento marcato 'processed' e la risposta era 200.
// ---------------------------------------------------------------------------

interface StatoFinto {
  /** L'evento e' gia' nella tabella con questo stato (null = mai visto). */
  eventoEsistente?: 'pending' | 'processed' | 'failed' | null;
  erroreAccredito?: string;
  erroreMarcatura?: string;
  /** La firma non verifica. */
  firmaNonValida?: boolean;
  paymentStatus?: string;
  metadata?: Record<string, string>;
  mock?: boolean;
}

let stato: StatoFinto = {};
let rpcChiamate: Array<{ fn: string; args: Record<string, unknown> }> = [];
let aggiornamenti: Array<Record<string, unknown>> = [];

vi.mock('@/lib/env.server', () => ({
  getServerEnv: () => ({
    ENABLE_MOCK_BILLING: stato.mock ?? false,
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
  }),
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: () => {
        if (stato.firmaNonValida) throw new Error('firma non corrispondente');
        return {
          id: 'evt_1',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_1',
              payment_status: stato.paymentStatus ?? 'paid',
              metadata: stato.metadata ?? { organization_id: 'org-1', pack_key: 'pack_50' },
            },
          },
        };
      },
    },
    checkout: { sessions: { listLineItems: async () => ({ data: [] }) } },
  }),
  packForPriceId: () => null,
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => {
    const client = {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcChiamate.push({ fn, args });
        return Promise.resolve({
          data: null,
          error: stato.erroreAccredito ? { message: stato.erroreAccredito } : null,
        });
      },
      from(tabella: string) {
        const catena: Record<string, unknown> = {};
        let patch: Record<string, unknown> | null = null;

        const esito = () => {
          if (tabella === 'stripe_events' && patch) {
            aggiornamenti.push(patch);
            return {
              data: null,
              error: stato.erroreMarcatura && patch.status === 'processed'
                ? { message: stato.erroreMarcatura }
                : null,
            };
          }
          return { data: null, error: null };
        };

        Object.assign(catena, {
          insert(riga: Record<string, unknown>) {
            if (tabella === 'stripe_events') {
              // La unique su stripe_event_id fa fallire il secondo inserimento.
              const duplicato = stato.eventoEsistente != null;
              return {
                select: () => ({
                  single: async () =>
                    duplicato
                      ? { data: null, error: { message: 'duplicate key' } }
                      : { data: { id: 'uuid-evento' }, error: null },
                }),
              };
            }
            void riga;
            return Promise.resolve({ data: null, error: null });
          },
          update(p: Record<string, unknown>) {
            patch = p;
            return catena;
          },
          select() {
            return catena;
          },
          eq() {
            return catena;
          },
          maybeSingle: async () =>
            stato.eventoEsistente != null
              ? { data: { id: 'uuid-evento', status: stato.eventoEsistente }, error: null }
              : { data: null, error: null },
          single: async () =>
            tabella === 'billing_products'
              ? { data: { credits: 50 }, error: null }
              : { data: null, error: null },
          then: (r: (v: unknown) => unknown) => Promise.resolve(esito()).then(r),
        });
        return catena;
      },
    };
    return client;
  },
}));

const { POST } = await import('@/app/api/stripe/webhook/route');

function richiesta(firmata = true): Request {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: firmata ? { 'stripe-signature': 't=1,v1=abc' } : {},
    body: '{}',
  });
}

beforeEach(() => {
  stato = {};
  rpcChiamate = [];
  aggiornamenti = [];
});

describe('webhook Stripe', () => {
  it('accredita i crediti di un pagamento riuscito', async () => {
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(rpcChiamate).toEqual([
      {
        fn: 'apply_credit_purchase',
        args: { org: 'org-1', amt: 50, stripe_event: 'uuid-evento', price_key: 'pack_50' },
      },
    ]);
    expect(aggiornamenti.some((a) => a.status === 'processed')).toBe(true);
  });

  it('rifiuta una firma non valida senza toccare il registro', async () => {
    stato.firmaNonValida = true;
    const res = await POST(richiesta());
    expect(res.status).toBe(400);
    // Senza questo controllo chiunque potrebbe regalarsi crediti con una POST.
    expect(rpcChiamate).toEqual([]);
  });

  it('rifiuta una richiesta senza firma', async () => {
    const res = await POST(richiesta(false));
    expect(res.status).toBe(400);
    expect(rpcChiamate).toEqual([]);
  });

  it('non riaccredita un evento già elaborato', async () => {
    stato.eventoEsistente = 'processed';
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(rpcChiamate).toEqual([]);
  });

  it('riprova un evento rimasto in sospeso', async () => {
    // Un tentativo precedente non era andato: l'accredito e' idempotente
    // sull'uuid, quindi riprocessare e' sicuro e necessario.
    stato.eventoEsistente = 'pending';
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(rpcChiamate).toHaveLength(1);
  });

  it('se l’accredito fallisce risponde 500 e segna l’evento fallito', async () => {
    // Il bug vero: l'errore veniva ignorato, l'evento marcato 'processed' e la
    // risposta era 200. Il cliente pagava e non riceveva niente, per sempre.
    stato.erroreAccredito = 'funzione non trovata';
    const res = await POST(richiesta());
    expect(res.status).toBe(500);
    expect(aggiornamenti.some((a) => a.status === 'processed')).toBe(false);
    const fallito = aggiornamenti.find((a) => a.status === 'failed');
    expect(fallito).toBeDefined();
    expect(String(fallito!.error_message)).toContain('funzione non trovata');
  });

  it('se non riesce a marcare l’evento chiede il retry invece di mentire', async () => {
    stato.erroreMarcatura = 'colonna inesistente';
    const res = await POST(richiesta());
    // 200 lascerebbe l'evento 'pending' per sempre, e Stripe non riproverebbe.
    expect(res.status).toBe(500);
  });

  it('ignora una sessione non pagata', async () => {
    stato.paymentStatus = 'unpaid';
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(rpcChiamate).toEqual([]);
  });

  it('non accredita senza organizzazione nei metadata', async () => {
    stato.metadata = { pack_key: 'pack_50' };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(rpcChiamate).toEqual([]);
  });

  it('in modalità mock non elabora nulla', async () => {
    stato.mock = true;
    const res = await POST(richiesta());
    expect(await res.json()).toMatchObject({ mock: true });
    expect(rpcChiamate).toEqual([]);
  });
});
