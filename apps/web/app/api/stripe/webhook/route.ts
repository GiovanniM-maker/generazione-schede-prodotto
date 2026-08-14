import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getServerEnv } from '@/lib/env.server';
import { getServiceClient } from '@/lib/supabase/service';
import type { TypedClient } from '@app/database';
import { getStripe, packForPriceId, CHIAVE_ABBONAMENTO } from '@/lib/stripe';
import {
  assicuraAbbonamento,
  fatturaDaAccreditare,
  idDi,
  istante,
  organizzazioneDi,
  periodoDellaFattura,
  statoAbbonamento,
} from '@/lib/abbonamenti';
import {
  logWrite,
  mustWrite,
  writeOrThrow,
} from '@app/core';

// POST /api/stripe/webhook — body RAW, firma verificata, idempotente.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const env = getServerEnv();
  if (env.ENABLE_MOCK_BILLING) {
    // In mock non elaboriamo webhook (accredito diretto al checkout).
    return NextResponse.json({ received: true, mock: true });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Firma mancante' }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe(env);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: `Firma non valida: ${err instanceof Error ? err.message : 'errore'}` },
      { status: 400 },
    );
  }

  const service = getServiceClient();

  // Idempotenza: registra l'evento. Se esiste già, distingui i casi:
  //  - status 'processed' → davvero duplicato, esci senza riprocessare;
  //  - status 'pending'/'failed' → un tentativo precedente NON è andato a buon
  //    fine (es. errore transitorio): riprocessa (apply_credit_purchase è
  //    idempotente sull'uuid evento, quindi non accredita due volte).
  let eventUuid: string;
  const { data: eventRow, error: insertErr } = await service
    .from('stripe_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertErr || !eventRow) {
    const { data: existing } = await service
      .from('stripe_events')
      .select('id, status')
      .eq('stripe_event_id', event.id)
      .maybeSingle();
    if (!existing) {
      // Non era un duplicato ma un errore d'inserimento: chiedi retry a Stripe.
      return NextResponse.json({ error: 'Registrazione evento fallita' }, { status: 500 });
    }
    if (existing.status === 'processed') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    eventUuid = existing.id; // pending/failed → riprocessa
  } else {
    eventUuid = eventRow.id;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.mode === 'subscription') {
        // Qui NON si accreditano crediti. L'abbonamento nasce, i crediti li
        // porta `invoice.paid` — che arriva comunque, anche al primo mese.
        // Accreditare in tutti e due i posti vorrebbe dire regalare il primo
        // ciclo a ogni nuovo abbonato.
        await registraAbbonamentoDalCheckout(service, session);
      } else if (session.payment_status === 'paid') {
        const orgId = session.metadata?.organization_id;
        let packKey = session.metadata?.pack_key ?? null;

        // Se manca la chiave nei metadata, deducila dal price della sessione.
        if (!packKey) {
          const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
          const priceId = items.data[0]?.price?.id;
          if (priceId) packKey = packForPriceId(env, priceId);
        }

        if (orgId && packKey) {
          const { data: product } = await service
            .from('billing_products')
            .select('credits, price_cents, currency')
            .eq('key', packKey)
            .single();
          if (product) {
            // L'importo lo dice Stripe, non il listino: se c'era uno sconto o
            // il prezzo è cambiato dopo, il listino racconterebbe un'altra
            // cifra rispetto a quella addebitata.
            const importo = session.amount_total ?? product.price_cents ?? null;
            const valuta = (session.currency ?? product.currency ?? 'EUR').toUpperCase();
            // Se l'accredito fallisce l'eccezione arriva al catch qui sotto,
            // che segna l'evento 'failed' e risponde 500: Stripe riprova.
            // Ignorare l'errore significava incassare senza dare i crediti,
            // marcare l'evento 'processed' e non lasciare traccia.
            await writeOrThrow('crediti.apply_credit_purchase', service.rpc('apply_credit_purchase', {
              org: orgId,
              amt: product.credits,
              stripe_event: eventUuid,
              price_key: packKey,
              amount_cents: importo,
              currency: valuta,
            }));
            await logWrite('app_events.insert', service.from('app_events').insert({
              organization_id: orgId,
              event_name: 'payment_completed',
              metadata_json: { packKey, credits: product.credits, amount_cents: importo, currency: valuta },
            }));
          }
        }
      }
    }

    // I crediti del mese arrivano qui, e solo qui.
    if (event.type === 'invoice.paid') {
      await accreditaCicloDaFattura(service, event.data.object as Stripe.Invoice, eventUuid);
    }

    // Cambi di stato: disdetta programmata, pagamento fallito, ripresa, fine.
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await aggiornaStatoAbbonamento(
        service,
        event.data.object as Stripe.Subscription,
        event.type === 'customer.subscription.deleted',
      );
    }

    // Se la marcatura fallisce l'evento resta 'pending': rispondendo 200
    // Stripe non riproverebbe piu' e la riga resterebbe a mentire per sempre.
    // Chiedere il retry e' sicuro: `apply_credit_purchase` e' idempotente
    // sull'uuid dell'evento, quindi il secondo giro non accredita due volte.
    const marcato = await mustWrite('stripe_events.update', service
      .from('stripe_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id));
    if (!marcato.ok) {
      return NextResponse.json({ error: 'Evento non marcato' }, { status: 500 });
    }
  } catch (err) {
    // Segna l'errore per un retry sicuro (l'evento resta registrato).
    // Ultimo anello: stiamo gia' rispondendo 500 e l'evento resta 'pending',
    // che e' comunque uno stato riprocessabile. Non c'e' altro da fare, e per
    // questo l'esito qui non viene letto.
    await mustWrite('stripe_events.update', service
      .from('stripe_events')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'errore' })
      .eq('stripe_event_id', event.id));
    return NextResponse.json({ error: 'Elaborazione fallita' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// I tre pezzi dell'abbonamento.
//
// Stanno qui sotto e non dentro il `try` perché il corpo della rotta è già
// lungo, ma la regola è la stessa: se una scrittura fallisce si solleva.
// L'eccezione arriva al `catch` della rotta, che marca l'evento `failed` e
// risponde 500 — cioè chiede a Stripe di riprovare. È l'unico modo onesto di
// gestire un incasso che non si è tradotto in servizio.
// ---------------------------------------------------------------------------

/** Il checkout ha creato l'abbonamento: si registra, senza accreditare niente. */
async function registraAbbonamentoDalCheckout(
  service: TypedClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const orgId = await organizzazioneDi(service, {
    metadata: session.metadata,
    customerId: idDi(session.customer),
  });
  const subId = idDi(session.subscription);
  if (!orgId || !subId) {
    // Senza organizzazione o senza abbonamento non c'è niente da scrivere, e
    // inventare una riga sarebbe peggio del silenzio. Resta la traccia.
    console.error(`[stripe] checkout abbonamento senza org (${orgId}) o sub (${subId})`);
    return;
  }

  const { data: listino } = await service
    .from('billing_products')
    .select('credits')
    .eq('key', CHIAVE_ABBONAMENTO)
    .maybeSingle();

  const esito = await assicuraAbbonamento(service, {
    organizationId: orgId,
    stripeSubscriptionId: subId,
    stato: 'active',
    creditiMensili: listino?.credits ?? null,
    disdettoAFineCiclo: false,
    canceledAt: null,
  });
  if (!esito.ok) throw new Error(`subscriptions.upsert: ${esito.error}`);

  await logWrite('app_events.insert', service.from('app_events').insert({
    organization_id: orgId,
    event_name: 'subscription_started',
    metadata_json: { stripe_subscription_id: subId },
  }));
}

/**
 * La fattura pagata: si chiude il ciclo vecchio e si accredita quello nuovo.
 *
 * `roll_subscription_cycle` fa le tre cose in una transazione — aggiorna il
 * periodo, fa scadere quello che restava, accredita i crediti del mese — e
 * l'accredito è idempotente sull'evento, quindi una seconda consegna della
 * stessa fattura non regala 150 crediti.
 */
async function accreditaCicloDaFattura(
  service: TypedClient,
  fattura: Stripe.Invoice,
  eventUuid: string,
): Promise<void> {
  if (!fatturaDaAccreditare(fattura)) return;

  const subId = idDi((fattura as unknown as { subscription?: unknown }).subscription);
  if (!subId) return; // fattura non legata a un abbonamento: non ci riguarda

  const orgId = await organizzazioneDi(service, {
    metadata: fattura.metadata,
    customerId: idDi(fattura.customer),
  });
  if (!orgId) {
    throw new Error(`fattura ${fattura.id}: nessuna organizzazione per il cliente`);
  }

  const periodo = periodoDellaFattura(fattura);
  if (!periodo.inizio || !periodo.fine) {
    throw new Error(`fattura ${fattura.id}: righe senza periodo, non so quando scadono i crediti`);
  }

  const { data: listino } = await service
    .from('billing_products')
    .select('credits')
    .eq('key', CHIAVE_ABBONAMENTO)
    .maybeSingle();

  // La riga può non esistere: `invoice.paid` può arrivare prima del checkout.
  const esito = await assicuraAbbonamento(service, {
    organizationId: orgId,
    stripeSubscriptionId: subId,
    stato: 'active',
    inizioPeriodo: periodo.inizio,
    finePeriodo: periodo.fine,
    creditiMensili: listino?.credits ?? null,
  });
  if (!esito.ok) throw new Error(`subscriptions.upsert: ${esito.error}`);

  await writeOrThrow('crediti.roll_subscription_cycle', service.rpc('roll_subscription_cycle', {
    org: orgId,
    stripe_event: eventUuid,
    period_start: periodo.inizio,
    period_end: periodo.fine,
    credits: listino?.credits ?? null,
  }));

  await logWrite('app_events.insert', service.from('app_events').insert({
    organization_id: orgId,
    event_name: 'subscription_renewed',
    metadata_json: {
      stripe_invoice_id: fattura.id,
      amount_paid: fattura.amount_paid,
      currency: fattura.currency,
      period_end: periodo.fine,
    },
  }));
}

/** Disdetta programmata, pagamento fallito, ripresa, fine. */
async function aggiornaStatoAbbonamento(
  service: TypedClient,
  sub: Stripe.Subscription,
  finito: boolean,
): Promise<void> {
  const orgId = await organizzazioneDi(service, {
    metadata: sub.metadata,
    customerId: idDi(sub.customer),
  });
  if (!orgId) {
    console.error(`[stripe] abbonamento ${sub.id} senza organizzazione`);
    return;
  }

  const s = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
    cancel_at_period_end?: boolean;
    canceled_at?: number | null;
  };

  const esito = await assicuraAbbonamento(service, {
    organizationId: orgId,
    stripeSubscriptionId: sub.id,
    stripePriceId: idDi(sub.items?.data?.[0]?.price),
    stato: finito ? 'canceled' : statoAbbonamento(sub.status),
    inizioPeriodo: istante(s.current_period_start),
    finePeriodo: istante(s.current_period_end),
    disdettoAFineCiclo: finito ? false : (s.cancel_at_period_end ?? false),
    canceledAt: istante(s.canceled_at ?? null),
  });
  if (!esito.ok) throw new Error(`subscriptions.upsert: ${esito.error}`);

  await logWrite('app_events.insert', service.from('app_events').insert({
    organization_id: orgId,
    event_name: finito ? 'subscription_ended' : 'subscription_updated',
    metadata_json: { status: sub.status, cancel_at_period_end: s.cancel_at_period_end ?? false },
  }));
}
