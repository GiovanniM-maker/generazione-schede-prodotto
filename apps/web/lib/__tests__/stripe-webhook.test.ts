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
  /** Quanto ha davvero incassato Stripe (puo' differire dal listino). */
  amountTotal?: number | null;
  /** Un evento diverso da `checkout.session.completed` in modalita' pagamento. */
  evento?: { id: string; type: string; data: { object: Record<string, unknown> } };
  /** L'organizzazione trovata a partire dal cliente Stripe (null = nessuna). */
  orgDalCliente?: string | null;
  erroreUpsertAbbonamento?: string;
}

let stato: StatoFinto = {};
let rpcChiamate: Array<{ fn: string; args: Record<string, unknown> }> = [];
let aggiornamenti: Array<Record<string, unknown>> = [];
let abbonamentiScritti: Array<Record<string, unknown>> = [];

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
        if (stato.evento) return stato.evento;
        return {
          id: 'evt_1',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_1',
              payment_status: stato.paymentStatus ?? 'paid',
              amount_total: stato.amountTotal === undefined ? 2900 : stato.amountTotal,
              currency: 'eur',
              metadata: stato.metadata ?? { organization_id: 'org-1', pack_key: 'pack_50' },
            },
          },
        };
      },
    },
    checkout: { sessions: { listLineItems: async () => ({ data: [] }) } },
  }),
  packForPriceId: () => null,
  CHIAVE_ABBONAMENTO: 'subscription',
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
          upsert(riga: Record<string, unknown>) {
            abbonamentiScritti.push(riga);
            return Promise.resolve({
              data: null,
              error: stato.erroreUpsertAbbonamento
                ? { message: stato.erroreUpsertAbbonamento }
                : null,
            });
          },
          select() {
            return catena;
          },
          eq() {
            return catena;
          },
          maybeSingle: async () => {
            if (tabella === 'organizations') {
              const id = stato.orgDalCliente === undefined ? 'org-1' : stato.orgDalCliente;
              return { data: id ? { id } : null, error: null };
            }
            if (tabella === 'billing_products') {
              return { data: { credits: 150 }, error: null };
            }
            return stato.eventoEsistente != null
              ? { data: { id: 'uuid-evento', status: stato.eventoEsistente }, error: null }
              : { data: null, error: null };
          },
          single: async () =>
            tabella === 'billing_products'
              ? { data: { credits: 50, price_cents: 2900, currency: 'EUR' }, error: null }
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
  abbonamentiScritti = [];
});

describe('webhook Stripe', () => {
  it('accredita i crediti di un pagamento riuscito', async () => {
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(rpcChiamate).toEqual([
      {
        fn: 'apply_credit_purchase',
        args: {
          org: 'org-1',
          amt: 50,
          stripe_event: 'uuid-evento',
          price_key: 'pack_50',
          amount_cents: 2900,
          currency: 'EUR',
        },
      },
    ]);
    expect(aggiornamenti.some((a) => a.status === 'processed')).toBe(true);
  });

  it('registra l\u2019importo incassato da Stripe, non quello del listino', async () => {
    // Con uno sconto (o dopo un cambio di prezzo) le due cifre divergono: in
    // cronologia deve restare quella addebitata, altrimenti la ricevuta si
    // riscrive da sola ogni volta che si tocca il listino.
    stato.amountTotal = 2400;
    await POST(richiesta());
    expect(rpcChiamate[0]!.args.amount_cents).toBe(2400);
  });

  it('senza importo da Stripe ripiega sul listino, senza inventare', async () => {
    stato.amountTotal = null;
    await POST(richiesta());
    expect(rpcChiamate[0]!.args.amount_cents).toBe(2900);
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

// ---------------------------------------------------------------------------
// L'abbonamento.
//
// Tre modi di sbagliare, tutti diversi da quelli dei pacchetti:
//
//   - accreditare i crediti sia al checkout sia alla fattura → primo mese
//     doppio, per ogni nuovo abbonato;
//   - accreditare su una fattura che non è un ciclo (un conguaglio di due
//     euro) → 150 crediti regalati;
//   - pretendere che gli eventi arrivino in ordine → `invoice.paid` prima del
//     checkout trova nessun abbonamento, e l'abbonato paga e resta a zero.
//
// Stripe non garantisce l'ordine di consegna. Il terzo non è un caso di
// scuola: è quello che succede quando la rete fa il suo mestiere.
// ---------------------------------------------------------------------------

/** Una fattura pagata, con le righe che portano il periodo. */
function fattura(campi: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    type: 'invoice',
    customer: 'cus_1',
    subscription: 'sub_1',
    billing_reason: 'subscription_cycle',
    amount_paid: 9900,
    currency: 'eur',
    metadata: {},
    lines: {
      data: [
        { period: { start: 1_760_000_000, end: 1_762_678_400 } },
      ],
    },
    ...campi,
  };
}

describe('abbonamento', () => {
  it('il checkout registra l’abbonamento e NON accredita crediti', () => {
    // I crediti li porta `invoice.paid`, che arriva comunque anche al primo
    // mese. Accreditare qui vorrebbe dire regalare il primo ciclo a tutti.
    stato.evento = {
      id: 'evt_sub',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_2',
          mode: 'subscription',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { organization_id: 'org-1' },
        },
      },
    };
    return POST(richiesta()).then(async (res) => {
      expect(res.status).toBe(200);
      expect(rpcChiamate).toEqual([]);
      expect(abbonamentiScritti).toHaveLength(1);
      expect(abbonamentiScritti[0]).toMatchObject({
        organization_id: 'org-1',
        stripe_subscription_id: 'sub_1',
        status: 'active',
        monthly_credits: 150,
      });
    });
  });

  it('la fattura pagata fa girare il ciclo, con il periodo delle righe', async () => {
    stato.evento = { id: 'evt_inv', type: 'invoice.paid', data: { object: fattura() } };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(rpcChiamate).toHaveLength(1);
    expect(rpcChiamate[0]!.fn).toBe('roll_subscription_cycle');
    expect(rpcChiamate[0]!.args).toMatchObject({
      org: 'org-1',
      stripe_event: 'uuid-evento',
      credits: 150,
      period_start: new Date(1_760_000_000 * 1000).toISOString(),
      period_end: new Date(1_762_678_400 * 1000).toISOString(),
    });
  });

  it('la fattura arriva prima del checkout: l’abbonamento si crea lo stesso', async () => {
    // Stripe non garantisce l'ordine. Se la riga la creasse solo il checkout,
    // `roll_subscription_cycle` solleverebbe e l'abbonato resterebbe a zero.
    stato.evento = {
      id: 'evt_inv2',
      type: 'invoice.paid',
      data: { object: fattura({ billing_reason: 'subscription_create' }) },
    };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(abbonamentiScritti).toHaveLength(1);
    expect(rpcChiamate[0]!.fn).toBe('roll_subscription_cycle');
  });

  it('un conguaglio non vale 150 crediti', async () => {
    stato.evento = {
      id: 'evt_inv3',
      type: 'invoice.paid',
      data: { object: fattura({ billing_reason: 'subscription_update' }) },
    };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(rpcChiamate).toEqual([]);
    expect(abbonamentiScritti).toEqual([]);
  });

  it('una fattura senza periodo non accredita: si chiede il retry', async () => {
    // Senza periodo non si sa quando scadono i crediti, e metterli senza
    // scadenza vorrebbe dire regalare per sempre quello che dura un mese.
    stato.evento = {
      id: 'evt_inv4',
      type: 'invoice.paid',
      data: { object: fattura({ lines: { data: [] } }) },
    };
    const res = await POST(richiesta());
    expect(res.status).toBe(500);
    expect(rpcChiamate).toEqual([]);
  });

  it('una fattura di un cliente sconosciuto chiede il retry invece di tacere', async () => {
    stato.orgDalCliente = null;
    stato.evento = { id: 'evt_inv5', type: 'invoice.paid', data: { object: fattura() } };
    const res = await POST(richiesta());
    expect(res.status).toBe(500);
    expect(rpcChiamate).toEqual([]);
  });

  it('la disdetta programmata si registra senza spegnere niente', async () => {
    // `cancel_at_period_end` non toglie i diritti: l'abbonamento resta attivo
    // fino a fine ciclo, ed è quello per cui il cliente ha pagato.
    stato.evento = {
      id: 'evt_sub_upd',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          cancel_at_period_end: true,
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_678_400,
          metadata: {},
          items: { data: [{ price: { id: 'price_sub' } }] },
        },
      },
    };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(abbonamentiScritti[0]).toMatchObject({
      status: 'active',
      cancel_at_period_end: true,
      stripe_price_id: 'price_sub',
    });
    expect(rpcChiamate).toEqual([]);
  });

  it('la fine dell’abbonamento si registra come tale', async () => {
    stato.evento = {
      id: 'evt_sub_del',
      type: 'customer.subscription.deleted',
      data: {
        object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: {}, items: { data: [] } },
      },
    };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(abbonamentiScritti[0]).toMatchObject({
      status: 'canceled',
      cancel_at_period_end: false,
    });
  });

  it('uno stato che Stripe conosce e noi no non diventa «attivo»', async () => {
    // `incomplete_expired` e `paused` non hanno una casella nostra. Farli
    // ricadere su «attivo» vorrebbe dire regalare il servizio a chi non paga.
    stato.evento = {
      id: 'evt_sub_pause',
      type: 'customer.subscription.updated',
      data: {
        object: { id: 'sub_1', customer: 'cus_1', status: 'paused', metadata: {}, items: { data: [] } },
      },
    };
    await POST(richiesta());
    expect(abbonamentiScritti[0]!.status).toBe('unpaid');
  });

  it('uno stato che Stripe inventerà domani non diventa «attivo»', async () => {
    // Stripe aggiunge stati nel tempo. Il valore predefinito deve essere quello
    // che NON regala il servizio: se non lo riconosciamo, non dà diritti.
    stato.evento = {
      id: 'evt_sub_futuro',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'qualcosa_che_non_esiste_ancora',
          metadata: {},
          items: { data: [] },
        },
      },
    };
    await POST(richiesta());
    expect(abbonamentiScritti[0]!.status).toBe('incomplete');
  });

  it('«incomplete_expired» vale come «incomplete», non come attivo', async () => {
    stato.evento = {
      id: 'evt_sub_exp',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'incomplete_expired',
          metadata: {},
          items: { data: [] },
        },
      },
    };
    await POST(richiesta());
    expect(abbonamentiScritti[0]!.status).toBe('incomplete');
  });

  it('se la riga dell’abbonamento non si scrive, si chiede il retry', async () => {
    stato.erroreUpsertAbbonamento = 'colonna inesistente';
    stato.evento = { id: 'evt_inv6', type: 'invoice.paid', data: { object: fattura() } };
    const res = await POST(richiesta());
    expect(res.status).toBe(500);
    expect(rpcChiamate).toEqual([]);
  });
});
