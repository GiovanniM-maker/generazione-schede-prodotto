'use server';

import { getSessionUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Azioni UI aggiuntive, minimali, non coperte dalle action stabili.

export interface BatchProgress {
  total: number;
  processed: number;
  needsReview: number;
  failed: number;
  status: string;
  /** Messaggio leggibile quando ci sono fallimenti (es. credito AI esaurito). */
  topError?: string;
}

/** Traduce il codice errore del worker in un messaggio azionabile per l'utente. */
function friendlyError(code?: string | null): string | undefined {
  switch (code) {
    case 'AI_NO_CREDIT':
      return 'Il servizio AI ha esaurito il credito. Ricarica il saldo su OpenRouter, poi rilancia la generazione (i tuoi crediti non sono stati consumati).';
    case 'AI_RATE_LIMIT':
      return 'Il servizio AI ha applicato un limite temporaneo. Attendi qualche minuto e rilancia.';
    case 'AI_TIMEOUT':
      return 'Il servizio AI non ha risposto in tempo. Riprova a lanciare la generazione.';
    case 'AI_INVALID_OUTPUT':
      return 'Il servizio AI ha restituito un risultato non valido. Riprova.';
    case 'INSUFFICIENT_FACTS':
      return 'Dati insufficienti per generare: aggiungi attributi o analizza le foto, poi riprova.';
    default:
      return code
        ? 'Generazione non riuscita per alcuni prodotti. Riprova; se persiste, controlla il credito del servizio AI.'
        : undefined;
  }
}

export type BatchProgressResult =
  | { ok: true; progress: BatchProgress }
  | { ok: false; error: string };

/**
 * Legge l'avanzamento di un batch (per il polling in elaborazione).
 * Non lancia mai eccezioni oltre il confine server (in produzione Next.js
 * oscura i messaggi delle eccezioni): restituisce sempre un'unione discriminata.
 */
export async function getBatchProgressAction(
  batchId: string,
): Promise<BatchProgressResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const supabase = await createSupabaseServerClient();

  const { data: batch } = await supabase
    .from('batches')
    .select('status, total_products, processed_products, failed_products')
    .eq('id', batchId)
    .maybeSingle();

  if (!batch) return { ok: false, error: 'Batch non accessibile' };

  const { count: needsReview } = await supabase
    .from('product_generations')
    .select('id, products!inner(batch_id)', { count: 'exact', head: true })
    .eq('products.batch_id', batchId)
    .eq('status', 'needs_review');

  // Se ci sono fallimenti, recupera il motivo prevalente per mostrarlo chiaro.
  let topError: string | undefined;
  if ((batch.failed_products ?? 0) > 0) {
    const { data: jf } = await supabase
      .from('job_items')
      .select('last_error_code')
      .eq('batch_id', batchId)
      .eq('status', 'failed')
      .not('last_error_code', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    topError = friendlyError(jf?.[0]?.last_error_code) ?? friendlyError('generic');
  }

  return {
    ok: true,
    progress: {
      total: batch.total_products ?? 0,
      processed: batch.processed_products ?? 0,
      needsReview: needsReview ?? 0,
      failed: batch.failed_products ?? 0,
      status: batch.status ?? 'processing',
      topError,
    },
  };
}
