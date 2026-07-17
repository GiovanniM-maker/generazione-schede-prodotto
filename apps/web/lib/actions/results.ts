'use server';

import { queueSend, type Json } from '@app/database';
import type { ProductCopy } from '@app/core';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';

// Azioni sulla pagina risultati: edit (salvato separato), accetta, rifiuta, rigenera.

async function latestGenerationId(productId: string): Promise<string | null> {
  const service = getServiceClient();
  const { data } = await service
    .from('product_generations')
    .select('id')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function assertProductAccess(productId: string): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');
  const service = getServiceClient();
  const { data: product } = await service
    .from('products')
    .select('batch_id')
    .eq('id', productId)
    .single();
  if (!product) throw new Error('Prodotto non trovato');
  const orgId = await assertBatchAccess(product.batch_id);
  if (!orgId) throw new Error('Non accessibile');
  return orgId;
}

/** Salva il testo editato SEPARATAMENTE dall'output generato originale. */
export async function saveEditAction(input: {
  productId: string;
  edited: Partial<ProductCopy>;
}): Promise<void> {
  await assertProductAccess(input.productId);
  const genId = await latestGenerationId(input.productId);
  if (!genId) throw new Error('Nessuna generazione da modificare');
  const service = getServiceClient();
  await service
    .from('product_generations')
    .update({ edited_content_json: input.edited as unknown as Json })
    .eq('id', genId);
}

export async function acceptGenerationAction(productId: string): Promise<void> {
  await assertProductAccess(productId);
  const genId = await latestGenerationId(productId);
  if (!genId) throw new Error('Nessuna generazione');
  const service = getServiceClient();
  await service
    .from('product_generations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', genId);
}

export async function rejectGenerationAction(productId: string): Promise<void> {
  await assertProductAccess(productId);
  const genId = await latestGenerationId(productId);
  if (!genId) throw new Error('Nessuna generazione');
  const service = getServiceClient();
  await service.from('product_generations').update({ status: 'rejected' }).eq('id', genId);
}

/**
 * Rigenera un singolo prodotto: riserva 1 credito e accoda un nuovo job.
 * Per mantenere corrette le invarianti del ledger (una prenotazione per job,
 * consumata al successo o rimborsata a fallimento/cache), nell'MVP la
 * rigenerazione manuale consuma sempre 1 credito.
 */
export async function regenerateProductAction(input: {
  batchId: string;
  productId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return { ok: false, error: 'Non accessibile' };
  const service = getServiceClient();

  const { data: reserved } = await service.rpc('reserve_credits', {
    org: orgId,
    amt: 1,
    ref_type: 'regen',
    ref_id: input.productId,
  });
  if (!reserved) return { ok: false, error: 'INSUFFICIENT_CREDITS' };

  const { data: job, error } = await service
    .from('job_items')
    .insert({
      organization_id: orgId,
      batch_id: input.batchId,
      product_id: input.productId,
      status: 'queued',
    })
    .select('id')
    .single();
  if (error || !job) return { ok: false, error: error?.message ?? 'Job non creato' };
  await queueSend(service, { jobItemId: job.id });
  return { ok: true };
}
