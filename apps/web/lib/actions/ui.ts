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

  return {
    ok: true,
    progress: {
      total: batch.total_products ?? 0,
      processed: batch.processed_products ?? 0,
      needsReview: needsReview ?? 0,
      failed: batch.failed_products ?? 0,
      status: batch.status ?? 'processing',
    },
  };
}
