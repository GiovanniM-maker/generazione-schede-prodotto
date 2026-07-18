import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getServerEnv } from '@/lib/env.server';
import { getServiceClient } from '@/lib/supabase/service';
import { getStripe, packForPriceId } from '@/lib/stripe';

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
      if (session.payment_status === 'paid') {
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
            .select('credits')
            .eq('key', packKey)
            .single();
          if (product) {
            await service.rpc('apply_credit_purchase', {
              org: orgId,
              amt: product.credits,
              stripe_event: eventUuid,
              price_key: packKey,
            });
            await service.from('app_events').insert({
              organization_id: orgId,
              event_name: 'payment_completed',
              metadata_json: { packKey, credits: product.credits },
            });
          }
        }
      }
    }

    await service
      .from('stripe_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id);
  } catch (err) {
    // Segna l'errore per un retry sicuro (l'evento resta registrato).
    await service
      .from('stripe_events')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'errore' })
      .eq('stripe_event_id', event.id);
    return NextResponse.json({ error: 'Elaborazione fallita' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
