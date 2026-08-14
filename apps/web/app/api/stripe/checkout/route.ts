import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getStripe, priceIdForPack, CHIAVE_ABBONAMENTO } from '@/lib/stripe';
import {
  logWrite,
  mustWrite,
} from '@app/core';
import { writeOrTrace } from '@app/pipeline';
import { datiFatturaCompleti, type AnagraficaFattura } from '@/lib/fattura';

// ---------------------------------------------------------------------------
// I dati per la fattura, dalla nostra tabella a Stripe.
//
// Nel repository non ce n'era traccia: nessun campo, nessun controllo, nessuna
// schermata. Un cliente B2B italiano pagava e poi non riceveva niente di
// utilizzabile.
// ---------------------------------------------------------------------------

const PAESI_UE = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

type AnagraficaOrg = AnagraficaFattura;

/** I campi italiani, scritti in chiaro sulla fattura (Stripe non li ha nativi). */
function campiFattura(o: AnagraficaOrg | null | undefined) {
  const campi: { name: string; value: string }[] = [];
  if (o?.sdi_code) campi.push({ name: 'Codice destinatario', value: o.sdi_code });
  if (o?.pec_email) campi.push({ name: 'PEC', value: o.pec_email.slice(0, 30) });
  if (o?.tax_code) campi.push({ name: 'Codice fiscale', value: o.tax_code });
  return campi.length > 0 ? campi : undefined;
}

/**
 * Allinea la partita IVA sul cliente Stripe.
 *
 * È un oggetto separato, non un campo: si aggiunge e si rimuove, non si
 * sovrascrive. Se quella giusta c'è già non si tocca nulla — creare un
 * duplicato la farebbe comparire due volte in fattura.
 */
async function sincronizzaPartitaIva(
  stripe: Stripe,
  customerId: string,
  vat: string | null,
  paese: string,
): Promise<void> {
  const pa = paese.toUpperCase();
  // `eu_vat` vale solo dentro l'Unione: dichiarare quel tipo per un paese
  // fuori farebbe rifiutare la chiamata da Stripe e fallire l'acquisto.
  if (!vat || !PAESI_UE.has(pa)) return;
  const valore = `${pa}${vat}`;
  const esistenti = await stripe.customers.listTaxIds(customerId, { limit: 10 });
  if (esistenti.data.some((t) => t.value === valore)) return;
  for (const vecchia of esistenti.data) {
    await stripe.customers.deleteTaxId(customerId, vecchia.id);
  }
  await stripe.customers.createTaxId(customerId, { type: 'eu_vat', value: valore });
}

/**
 * Quello che si legge quando il guasto è NOSTRO.
 *
 * Premendo «Acquista» con Stripe non configurato, al cliente compariva
 * «Prezzo Stripe non configurato»: il nome di una nostra variabile d'ambiente,
 * davanti a una persona che stava per pagare. Non è un errore che può
 * correggere, e leggerlo lo lascia solo a chiedersi se i suoi soldi siano al
 * sicuro.
 *
 * Quindi: una frase sola, che dice le tre cose che servono — non è colpa tua,
 * non ti abbiamo addebitato niente, ecco cosa fare. Il motivo vero va nei log,
 * dove serve a noi.
 */
const GUASTO_NOSTRO =
  'Non riusciamo ad avviare il pagamento in questo momento. Non ti è stato addebitato niente: riprova fra qualche minuto e, se continua, scrivici.';

function guastoNostro(motivo: string, stato = 500) {
  console.error(`[acquisto] ${motivo}`);
  return NextResponse.json({ error: GUASTO_NOSTRO }, { status: stato });
}

// POST /api/stripe/checkout  { packKey: 'pack_50' | 'pack_200' | 'pack_500' }
// Non si fida MAI di prezzo/crediti inviati dal client: risolve tutto server-side.
export async function POST(request: Request) {
  const env = getServerEnv();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const org = await getUserOrg(user.id);
  if (!org) return guastoNostro('utente senza organizzazione al checkout', 400);
  // Sono soldi: li spende chi è intestatario dell'organizzazione.
  if (org.role !== 'owner') {
    return NextResponse.json(
      { error: "Solo il proprietario dell'organizzazione può acquistare crediti." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { packKey?: string };
  const packKey = body.packKey;
  if (!packKey || !['pack_50', 'pack_200', 'pack_500', CHIAVE_ABBONAMENTO].includes(packKey)) {
    return guastoNostro(`voce di listino fuori elenco: ${String(packKey)}`, 400);
  }
  const abbonamento = packKey === CHIAVE_ABBONAMENTO;

  const service = getServiceClient();
  const { data: product } = await service
    .from('billing_products')
    .select('key, credits, name, price_cents, currency, kind')
    .eq('key', packKey)
    .eq('active', true)
    .single();
  if (!product) return guastoNostro(`pacchetto ${packKey} assente o non attivo`, 404);
  // Un pacchetto senza prezzo non si vende: senza cifra non c'è né consenso né
  // fattura. La landing e la pagina crediti già non lo mostrano; qui si chiude
  // anche la porta di servizio.
  if (product.price_cents == null) {
    return guastoNostro(`pacchetto ${packKey} senza price_cents`, 409);
  }

  // Un abbonamento non si può simulare con un accredito una tantum: ha un
  // ciclo, un rinnovo e una disdetta. Fingerlo qui vorrebbe dire provare
  // qualcosa che non è il prodotto.
  if (abbonamento && env.ENABLE_MOCK_BILLING) {
    return guastoNostro('abbonamento richiesto con fatturazione simulata', 409);
  }

  // --- Mock billing: accredito diretto in modalità test (mai in produzione) ---
  if (env.ENABLE_MOCK_BILLING) {
    const fakeEventId = crypto.randomUUID();
    const accredito = await mustWrite('crediti.apply_credit_purchase', service.rpc('apply_credit_purchase', {
      org: org.organizationId,
      amt: product.credits,
      stripe_event: fakeEventId,
      price_key: packKey,
      amount_cents: product.price_cents,
      currency: product.currency ?? 'EUR',
    }));
    // Meglio un errore onesto che una pagina "acquisto riuscito" davanti a un
    // saldo rimasto identico.
    if (!accredito.ok) {
      return guastoNostro(`accredito simulato non riuscito per ${packKey}`);
    }
    await logWrite('app_events.insert', service.from('app_events').insert({
      organization_id: org.organizationId,
      user_id: user.id,
      event_name: 'payment_completed',
      metadata_json: {
        packKey,
        credits: product.credits,
        amount_cents: product.price_cents,
        currency: product.currency ?? 'EUR',
        mock: true,
      },
    }));
    return NextResponse.json({
      url: `${env.NEXT_PUBLIC_APP_URL}/app/billing?success=1&mock=1`,
      mock: true,
    });
  }

  // --- Stripe reale ---
  const priceId = priceIdForPack(env, packKey);
  if (!priceId) return guastoNostro(`manca l'id prezzo Stripe per ${packKey}`);

  const stripe = getStripe(env);

  // Recupera o crea il Customer Stripe.
  const { data: orgRow } = await service
    .from('organizations')
    .select(
      'id, name, stripe_customer_id, billing_name, vat_number, tax_code, sdi_code, pec_email, billing_address, billing_zip, billing_city, billing_province, billing_country',
    )
    .eq('id', org.organizationId)
    .single();

  // In Italia la fattura non è un optional: senza ragione sociale, indirizzo,
  // partita IVA (o codice fiscale) e recapito SDI/PEC non si può emettere il
  // documento, e incassare senza poterlo emettere è un problema di chi vende.
  // Meglio fermarsi qui, con un messaggio che dice dove andare, che dopo il
  // pagamento.
  const datiOk = datiFatturaCompleti(orgRow);
  if (!datiOk) {
    return NextResponse.json(
      {
        error:
          'Prima di acquistare servono i dati per la fattura (ragione sociale, indirizzo, partita IVA o codice fiscale, codice destinatario o PEC).',
        missingBilling: true,
      },
      { status: 409 },
    );
  }

  const anagrafica = {
    name: orgRow?.billing_name ?? orgRow?.name ?? undefined,
    address: {
      line1: orgRow?.billing_address ?? undefined,
      postal_code: orgRow?.billing_zip ?? undefined,
      city: orgRow?.billing_city ?? undefined,
      state: orgRow?.billing_province ?? undefined,
      country: orgRow?.billing_country ?? 'IT',
    },
    // I campi italiani sul CLIENTE, non solo sulla singola fattura.
    //
    // Un acquisto una tantum ha una fattura sola e la si può decorare al
    // volo; un abbonamento ne emette una al mese, e quelle nascono dentro
    // Stripe senza passare da noi. Messi qui valgono per tutte — comprese le
    // dodici del prossimo anno.
    invoice_settings: { custom_fields: campiFattura(orgRow) ?? ([] as Stripe.CustomerCreateParams.InvoiceSettings.CustomField[]) },
    // Lo SDI non è un campo nativo di Stripe: viaggia nei metadata del cliente
    // e come campo in chiaro sulla fattura, che è dove serve leggerlo.
    metadata: {
      organization_id: org.organizationId,
      sdi_code: orgRow?.sdi_code ?? '',
      pec_email: orgRow?.pec_email ?? '',
      tax_code: orgRow?.tax_code ?? '',
    },
  };

  let customerId = orgRow?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      ...anagrafica,
    });
    customerId = customer.id;
    // Se non si salva, al prossimo acquisto si crea un secondo cliente Stripe
    // per la stessa organizzazione e lo storico si spezza in due.
    await writeOrTrace(
      service,
      'organizations.update(stripe_customer)',
      service.from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', org.organizationId),
      { organizationId: org.organizationId, refId: customerId },
    );
  } else {
    // Il cliente esisteva già: riallinealo, altrimenti una correzione fatta
    // nel form resterebbe da questa parte e la fattura uscirebbe coi vecchi
    // dati.
    await stripe.customers.update(customerId, anagrafica);
  }

  // La partita IVA su Stripe è un oggetto a parte, non un campo del cliente.
  await sincronizzaPartitaIva(stripe, customerId, orgRow?.vat_number ?? null, anagrafica.address.country);

  const comune: Omit<Stripe.Checkout.SessionCreateParams, 'mode'> = {
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.NEXT_PUBLIC_APP_URL}/app/billing?success=1`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/app/billing?canceled=1`,
    metadata: { organization_id: org.organizationId, pack_key: packKey },
  };

  // L'abbonamento fattura da sé a ogni ciclo: `invoice_creation` non si può
  // usare (Stripe lo rifiuta in modalità `subscription`) e i campi italiani
  // vanno messi sull'abbonamento, così finiscono su OGNI fattura e non solo
  // sulla prima. `subscription_data.metadata` è anche l'unico modo di far
  // arrivare l'id dell'organizzazione sugli eventi di rinnovo, che nascono
  // dentro Stripe e non portano niente di nostro.
  const session = abbonamento
    ? await stripe.checkout.sessions.create({
        ...comune,
        mode: 'subscription',
        subscription_data: {
          metadata: { organization_id: org.organizationId, pack_key: packKey },
        },
      })
    : await stripe.checkout.sessions.create({
        ...comune,
        mode: 'payment',
        // Senza questo Stripe incassa e basta: la fattura va chiesta, e i campi
        // italiani vanno scritti sopra perché il commercialista li trovi.
        invoice_creation: {
          enabled: true,
          invoice_data: {
            custom_fields: campiFattura(orgRow),
            metadata: { organization_id: org.organizationId, pack_key: packKey },
          },
        },
      });

  await logWrite('app_events.insert', service.from('app_events').insert({
    organization_id: org.organizationId,
    user_id: user.id,
    event_name: 'checkout_started',
    metadata_json: { packKey, abbonamento },
  }));

  return NextResponse.json({ url: session.url });
}
