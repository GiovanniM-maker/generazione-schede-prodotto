'use server';

import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';

// ---------------------------------------------------------------------------
// Analisi foto in BACKGROUND.
//
// Prima l'analisi girava nel browser: chiudendo la pagina il lavoro si fermava.
// Ora lo stato vive sul batch e il cron riprende ciò che resta, quindi l'utente
// può chiudere e tornare quando vuole. L'utente può comunque restare a guardare
// il progresso se vuole rivedere le categorie prima di generare.
// ---------------------------------------------------------------------------



export interface AnalysisProgress {
  status: 'idle' | 'pending' | 'running' | 'done' | 'error';
  done: number;
  total: number;
  error: string | null;
}

/**
 * Marca il batch come "da analizzare". Ritorna subito: il lavoro vero lo fa il
 * cron (o la chiamata a `resumeVisualAnalysis`), così non dipende dalla pagina.
 */
export async function startVisualAnalysisAction(input: {
  batchId: string;
  skipCategory?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return { ok: false, error: 'Batch non accessibile' };
  const service = getServiceClient();

  const { error } = await service
    .from('batches')
    .update({
      visual_analysis_status: 'pending',
      visual_analysis_error: null,
      visual_analysis_claimed_at: null,
    })
    .eq('id', input.batchId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Progresso dell'analisi: quanti prodotti hanno già dei dati letti dalle foto. */
export async function getVisualAnalysisProgressAction(input: {
  batchId: string;
}): Promise<{ ok: true; data: AnalysisProgress } | { ok: false; error: string }> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return { ok: false, error: 'Batch non accessibile' };
  const service = getServiceClient();

  const { data: batch } = await service
    .from('batches')
    .select('visual_analysis_status, visual_analysis_error')
    .eq('id', input.batchId)
    .maybeSingle();

  const { data: products } = await service
    .from('products')
    .select('id, category_id, category')
    .eq('batch_id', input.batchId);
  const ids = (products ?? []).map((p) => p.id);

  // "Analizzato" = ha almeno un fatto letto dalle foto, oppure una categoria.
  let done = 0;
  if (ids.length > 0) {
    const { data: pav } = await service
      .from('product_attribute_values')
      .select('product_id')
      .in('product_id', ids)
      .eq('source_type', 'image');
    const withFacts = new Set((pav ?? []).map((r) => r.product_id));
    done = (products ?? []).filter((p) => withFacts.has(p.id) || p.category_id || p.category).length;
  }

  const raw = batch?.visual_analysis_status;
  const status: AnalysisProgress['status'] =
    raw === 'pending' || raw === 'running' || raw === 'done' || raw === 'error' ? raw : 'idle';

  return {
    ok: true,
    data: { status, done, total: ids.length, error: batch?.visual_analysis_error ?? null },
  };
}

