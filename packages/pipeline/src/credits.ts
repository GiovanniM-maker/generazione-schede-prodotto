// ---------------------------------------------------------------------------
// Il registro dei crediti non può sbagliare in silenzio.
//
// Le funzioni `apply_credit_purchase`, `release_credits` e
// `consume_reserved_credit` sono chiamate con `rpc`, e `rpc` — come `insert` —
// *restituisce* l'errore invece di sollevarlo. Sette punti del codice lo
// buttavano via. Sono esattamente i punti dove passano i soldi:
//
//   - accredito dopo il pagamento     → pagato e senza crediti
//   - rimborso di un job fallito      → addebitato per una scheda mai prodotta
//   - rimborso di una cache hit       → addebitato per zero lavoro
//   - consumo del credito riservato   → credito bloccato per sempre
//
// `console.error` non basta: nel worker nessuno legge quei log. Un fallimento
// qui lascia una riga in `app_events` con nome `credit_ledger_failed`, che è
// interrogabile e si vede.
//
// Dove c'è un utente davanti allo schermo la regola resta un'altra: si
// interrompe e glielo si dice (vedi il webhook Stripe, che risponde 500 così
// Stripe riprova).
// ---------------------------------------------------------------------------

import { mustWrite } from '@app/core';
import type { TypedClient, Json, Database } from '@app/database';

/** Le tre funzioni che spostano crediti. Le altre `rpc` sono sole letture. */
export type FunzioneCrediti =
  | 'apply_credit_purchase'
  | 'release_credits'
  | 'consume_reserved_credit';

export interface CreditOpContext {
  organizationId: string;
  /** A che cosa si riferisce l'operazione: job, batch, prodotto. */
  refId?: string | null;
  batchId?: string | null;
}

/**
 * Esegue un'operazione sul registro crediti e, se fallisce, lascia una traccia
 * interrogabile oltre al log del server.
 *
 * Ritorna `true` se è andata. Il chiamante decide se può proseguire: quasi
 * sempre sì (la generazione è già avvenuta e non si butta via il lavoro), ma
 * la discrepanza non resta invisibile.
 */
export async function creditOp<F extends FunzioneCrediti>(
  client: TypedClient,
  fn: F,
  args: Database['public']['Functions'][F]['Args'],
  ctx: CreditOpContext,
): Promise<boolean> {
  const esito = await mustWrite(`crediti.${fn}`, client.rpc(fn, args));
  if (esito.ok) return true;

  // La segnalazione non deve poter far cadere il chiamante: se anche questa
  // fallisce resta il console.error di `mustWrite`.
  await mustWrite(
    'app_events.insert(credit_ledger_failed)',
    client.from('app_events').insert({
      organization_id: ctx.organizationId,
      event_name: 'credit_ledger_failed',
      batch_id: ctx.batchId ?? null,
      metadata_json: {
        funzione: fn,
        errore: esito.error,
        riferimento: ctx.refId ?? null,
        argomenti: args,
      } as unknown as Json,
    }),
  );
  return false;
}
