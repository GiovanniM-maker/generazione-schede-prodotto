import type Stripe from 'stripe';
import type { TypedClient } from '@app/database';
import { CHIAVE_ABBONAMENTO } from '@/lib/stripe';

// ---------------------------------------------------------------------------
// Da un evento Stripe a una riga di `subscriptions`.
//
// TRE COSE CHE NON SI POSSONO DARE PER SCONTATE
//
// 1. **L'ordine degli eventi.** Stripe non lo garantisce: `invoice.paid` può
//    arrivare *prima* di `checkout.session.completed`. Se la riga
//    dell'abbonamento la creasse solo il checkout, il primo incasso troverebbe
//    `roll_subscription_cycle` senza abbonamento e solleverebbe — cioè
//    l'abbonato avrebbe pagato e sarebbe rimasto a zero crediti finché
//    qualcuno non se ne accorgeva. Per questo ogni evento che sa abbastanza
//    scrive la riga: `assicuraAbbonamento` è una `upsert`, non una `insert`.
//
// 2. **Quale organizzazione.** L'id sta nei metadata quando lo abbiamo messo
//    noi, ma gli eventi generati da Stripe (rinnovi, cambi di stato) non li
//    portano. La via che regge sempre è il cliente:
//    `organizations.stripe_customer_id`.
//
// 3. **Il periodo.** Sull'abbonamento sta in `current_period_*`; sulla fattura
//    sta nelle righe, che sono la fonte giusta per il ciclo che si sta
//    pagando. Prendere il periodo dall'abbonamento mentre si processa una
//    fattura vecchia farebbe scadere i crediti al momento sbagliato.
// ---------------------------------------------------------------------------

/** Gli stati che Stripe manda, ridotti a quelli del nostro enum. */
const STATI = new Set([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'unpaid',
]);

export function statoAbbonamento(stato: string | null | undefined): string {
  if (!stato) return 'incomplete';
  // `incomplete_expired` e `paused` non hanno una casella nostra: valgono come
  // «non dà diritti», che è quello che sono.
  if (stato === 'incomplete_expired') return 'incomplete';
  if (stato === 'paused') return 'unpaid';
  return STATI.has(stato) ? stato : 'incomplete';
}

/** Da un timestamp Stripe (secondi) a ISO. Null resta null. */
export function istante(secondi: number | null | undefined): string | null {
  return typeof secondi === 'number' ? new Date(secondi * 1000).toISOString() : null;
}

export interface DatiAbbonamento {
  organizationId: string;
  stripeSubscriptionId: string | null;
  stripePriceId?: string | null;
  stato: string;
  inizioPeriodo?: string | null;
  finePeriodo?: string | null;
  disdettoAFineCiclo?: boolean;
  creditiMensili?: number | null;
  canceledAt?: string | null;
}

/**
 * Scrive (o aggiorna) la riga dell'abbonamento dell'organizzazione.
 *
 * Un abbonamento per organizzazione: la tabella ha `unique (organization_id)`,
 * e la `upsert` ci si appoggia. Due righe vorrebbero dire due fatture e un
 * ciclo ambiguo.
 */
export async function assicuraAbbonamento(
  service: TypedClient,
  d: DatiAbbonamento,
): Promise<{ ok: boolean; error?: string }> {
  const riga: Record<string, unknown> = {
    organization_id: d.organizationId,
    status: d.stato,
  };
  // Solo i campi che l'evento conosce davvero: scrivere `null` su un campo che
  // questo evento non porta cancellerebbe quello che sapevamo già.
  if (d.stripeSubscriptionId) riga.stripe_subscription_id = d.stripeSubscriptionId;
  if (d.stripePriceId) riga.stripe_price_id = d.stripePriceId;
  if (d.inizioPeriodo) riga.current_period_start = d.inizioPeriodo;
  if (d.finePeriodo) riga.current_period_end = d.finePeriodo;
  if (d.disdettoAFineCiclo !== undefined) riga.cancel_at_period_end = d.disdettoAFineCiclo;
  if (d.canceledAt !== undefined) riga.canceled_at = d.canceledAt;
  if (d.creditiMensili != null) riga.monthly_credits = d.creditiMensili;
  riga.plan_key = CHIAVE_ABBONAMENTO;

  const { error } = await service
    .from('subscriptions')
    .upsert(riga, { onConflict: 'organization_id' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * L'organizzazione a cui appartiene un evento Stripe.
 *
 * Prima i metadata — li abbiamo messi noi e sono i più diretti — poi il
 * cliente. Il secondo è quello che regge sui rinnovi, che nascono dentro
 * Stripe e non portano niente di nostro.
 */
export async function organizzazioneDi(
  service: TypedClient,
  opzioni: { metadata?: Stripe.Metadata | null; customerId?: string | null },
): Promise<string | null> {
  const daiMetadata = opzioni.metadata?.organization_id;
  if (daiMetadata) return daiMetadata;
  if (!opzioni.customerId) return null;

  const { data } = await service
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', opzioni.customerId)
    .maybeSingle();
  return data?.id ?? null;
}

/** L'id, sia che Stripe mandi la stringa sia che mandi l'oggetto espanso. */
export function idDi(valore: unknown): string | null {
  if (typeof valore === 'string') return valore;
  if (valore && typeof valore === 'object' && 'id' in valore) {
    const id = (valore as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

/**
 * Il periodo che una fattura sta pagando.
 *
 * Sta nelle righe, non sulla fattura: `lines.data[].period`. Si prende la
 * finestra più larga fra le righe — una fattura può contenere un rateo e il
 * ciclo nuovo, e il ciclo nuovo è quello che conta per la scadenza dei crediti.
 */
export function periodoDellaFattura(
  fattura: Stripe.Invoice,
): { inizio: string | null; fine: string | null } {
  let inizio: number | null = null;
  let fine: number | null = null;
  for (const riga of fattura.lines?.data ?? []) {
    const p = (riga as { period?: { start?: number; end?: number } }).period;
    if (!p) continue;
    if (typeof p.start === 'number' && (inizio === null || p.start < inizio)) inizio = p.start;
    if (typeof p.end === 'number' && (fine === null || p.end > fine)) fine = p.end;
  }
  return { inizio: istante(inizio), fine: istante(fine) };
}

/** Le fatture che danno diritto ai crediti del mese. */
export function fatturaDaAccreditare(fattura: Stripe.Invoice): boolean {
  // `subscription_create` è il primo mese, `subscription_cycle` i rinnovi.
  // `subscription_update` (cambio piano a metà ciclo) e `manual` no: la prima
  // è un conguaglio, la seconda una fattura scritta a mano nel pannello, e
  // accreditare 150 crediti per un conguaglio di due euro sarebbe un regalo.
  const motivo = fattura.billing_reason;
  return motivo === 'subscription_create' || motivo === 'subscription_cycle';
}
