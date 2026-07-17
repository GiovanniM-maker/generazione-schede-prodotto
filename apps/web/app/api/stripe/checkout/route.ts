import { NextResponse } from 'next/server';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getStripe, priceIdForPack } from '@/lib/stripe';

// POST /api/stripe/checkout  { packKey: 'pack_50' | 'pack_200' | 'pack_500' }
// Non si fida MAI di prezzo/crediti inviati dal client: risolve tutto server-side.
export async function POST(request: Request) {
  const env = getServerEnv();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const org = await getUserOrg(user.id);
  if (!org) return NextResponse.json({ error: 'Organizzazione mancante' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { packKey?: string };
  const packKey = body.packKey;
  if (!packKey || !['pack_50', 'pack_200', 'pack_500'].includes(packKey)) {
    return NextResponse.json({ error: 'Pacchetto non valido' }, { status: 400 });
  }

  const service = getServiceClient();
  const { data: product } = await service
    .from('billing_products')
    .select('key, credits, name')
    .eq('key', packKey)
    .eq('active', true)
    .single();
  if (!product) return NextResponse.json({ error: 'Pacchetto non trovato' }, { status: 404 });

  // --- Mock billing: accredito diretto in modalità test (mai in produzione) ---
  if (env.ENABLE_MOCK_BILLING) {
    const fakeEventId = crypto.randomUUID();
    await service.rpc('apply_credit_purchase', {
      org: org.organizationId,
      amt: product.credits,
      stripe_event: fakeEventId,
      price_key: packKey,
    });
    await service.from('app_events').insert({
      organization_id: org.organizationId,
      user_id: user.id,
      event_name: 'payment_completed',
      metadata_json: { packKey, credits: product.credits, mock: true },
    });
    return NextResponse.json({
      url: `${env.NEXT_PUBLIC_APP_URL}/app/billing?success=1&mock=1`,
      mock: true,
    });
  }

  // --- Stripe reale ---
  const priceId = priceIdForPack(env, packKey);
  if (!priceId) return NextResponse.json({ error: 'Prezzo Stripe non configurato' }, { status: 500 });

  const stripe = getStripe(env);

  // Recupera o crea il Customer Stripe.
  const { data: orgRow } = await service
    .from('organizations')
    .select('id, name, stripe_customer_id')
    .eq('id', org.organizationId)
    .single();
  let customerId = orgRow?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { organization_id: org.organizationId },
    });
    customerId = customer.id;
    await service
      .from('organizations')
      .update({ stripe_customer_id: customerId })
      .eq('id', org.organizationId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.NEXT_PUBLIC_APP_URL}/app/billing?success=1`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/app/billing?canceled=1`,
    metadata: { organization_id: org.organizationId, pack_key: packKey },
  });

  await service.from('app_events').insert({
    organization_id: org.organizationId,
    user_id: user.id,
    event_name: 'checkout_started',
    metadata_json: { packKey },
  });

  return NextResponse.json({ url: session.url });
}
