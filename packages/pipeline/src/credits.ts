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
// Dove c'è un utente davanti allo schermo la regola resta un'altra: si
// interrompe e glielo si dice (vedi il webhook Stripe, che risponde 500 così
// Stripe riprova). Qui siamo nel worker, dove non c'è nessuno: vale
// `writeOrTrace`, cioè una riga interrogabile in `app_events`.
// ---------------------------------------------------------------------------

import type { TypedClient, Database } from '@app/database';
import { writeOrTrace, type TraceContext } from './trace.js';

/** I fallimenti del registro crediti hanno un nome tutto loro: si notano. */
export const EVENTO_CREDITI_FALLITO = 'credit_ledger_failed';

/** Le tre funzioni che spostano crediti. Le altre `rpc` sono sole letture. */
export type FunzioneCrediti =
  | 'apply_credit_purchase'
  | 'release_credits'
  | 'consume_reserved_credit';

export type CreditOpContext = TraceContext;

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
  return writeOrTrace(client, `crediti.${fn}`, client.rpc(fn, args), {
    ...ctx,
    evento: EVENTO_CREDITI_FALLITO,
    dettagli: { funzione: fn, argomenti: args },
  });
}
