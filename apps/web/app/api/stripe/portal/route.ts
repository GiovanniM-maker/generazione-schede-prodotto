import { NextResponse } from 'next/server';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getStripe } from '@/lib/stripe';

// ---------------------------------------------------------------------------
// La porta per uscire.
//
// Un abbonamento che si sottoscrive in due clic e si disdice scrivendo
// un'email non è un abbonamento: è una trappola. Il pannello di Stripe fa le
// quattro cose che servono — disdire, cambiare carta, aggiornare i dati,
// scaricare le fatture — e non richiede che le riscriviamo noi.
//
// La disdetta non passa da qui per essere registrata: la registra
// `customer.subscription.updated`, che Stripe manda comunque. Se il cliente
// disdice dal pannello e chiude il browser prima di tornare indietro, per noi
// non cambia niente. È l'unico modo in cui può funzionare: quello che succede
// dentro Stripe lo sappiamo dagli eventi, non dai ritorni.
// ---------------------------------------------------------------------------

const GUASTO =
  'Non riusciamo ad aprire la gestione dell’abbonamento in questo momento. Riprova fra qualche minuto e, se continua, scrivici.';

export async function POST() {
  const env = getServerEnv();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const org = await getUserOrg(user.id);
  if (!org) return NextResponse.json({ error: GUASTO }, { status: 400 });

  // Sono soldi: li gestisce chi è intestatario, come per l'acquisto.
  if (org.role !== 'owner') {
    return NextResponse.json(
      { error: "Solo il proprietario dell'organizzazione può gestire l'abbonamento." },
      { status: 403 },
    );
  }

  const service = getServiceClient();
  const { data: orgRow } = await service
    .from('organizations')
    .select('stripe_customer_id')
    .eq('id', org.organizationId)
    .single();

  // Senza cliente Stripe non c'è niente da gestire: non ha mai pagato.
  if (!orgRow?.stripe_customer_id) {
    console.error(`[portale] organizzazione ${org.organizationId} senza cliente Stripe`);
    return NextResponse.json({ error: GUASTO }, { status: 409 });
  }

  try {
    const stripe = getStripe(env);
    const sessione = await stripe.billingPortal.sessions.create({
      customer: orgRow.stripe_customer_id,
      return_url: `${env.NEXT_PUBLIC_APP_URL}/app/billing`,
    });
    return NextResponse.json({ url: sessione.url });
  } catch (err) {
    console.error(`[portale] ${err instanceof Error ? err.message : 'errore'}`);
    return NextResponse.json({ error: GUASTO }, { status: 500 });
  }
}
