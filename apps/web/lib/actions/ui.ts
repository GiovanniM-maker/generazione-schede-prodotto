'use server';

import { ensureOrg, getSessionUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Azioni UI aggiuntive, minimali, non coperte dalle action stabili.

/** Garantisce l'esistenza dell'organizzazione dell'utente (onboarding). */
export async function ensureOrgAction(
  name: string,
): Promise<{ organizationId: string }> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');
  const org = await ensureOrg(user.id, name?.trim() || 'La mia azienda');
  return { organizationId: org.organizationId };
}

export interface BatchProgress {
  total: number;
  processed: number;
  needsReview: number;
  failed: number;
  status: string;
}

/** Legge l'avanzamento di un batch (per il polling in elaborazione). */
export async function getBatchProgressAction(
  batchId: string,
): Promise<BatchProgress> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');
  const supabase = await createSupabaseServerClient();

  const { data: batch } = await supabase
    .from('batches')
    .select('status, total_products, processed_products, failed_products')
    .eq('id', batchId)
    .maybeSingle();

  if (!batch) throw new Error('Batch non accessibile');

  const { count: needsReview } = await supabase
    .from('product_generations')
    .select('id, products!inner(batch_id)', { count: 'exact', head: true })
    .eq('products.batch_id', batchId)
    .eq('status', 'needs_review');

  return {
    total: batch.total_products ?? 0,
    processed: batch.processed_products ?? 0,
    needsReview: needsReview ?? 0,
    failed: batch.failed_products ?? 0,
    status: batch.status ?? 'processing',
  };
}
