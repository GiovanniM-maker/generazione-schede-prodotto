'use server';

import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';
import { runVisualExtractionCore } from '@/lib/actions/visual';
import { mustWrite } from '@app/core';

// ---------------------------------------------------------------------------
// Analisi foto in BACKGROUND.
//
// Prima l'analisi girava nel browser: chiudendo la pagina il lavoro si fermava.
// Ora lo stato vive sul batch e il cron riprende ciò che resta, quindi l'utente
// può chiudere e tornare quando vuole. L'utente può comunque restare a guardare
// il progresso se vuole rivedere le categorie prima di generare.
// ---------------------------------------------------------------------------

type Service = ReturnType<typeof getServiceClient>;

/** Un'esecuzione bloccata da più di questo tempo viene ripresa. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

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

/**
 * Riprende le analisi in sospeso. Chiamata dal cron: prende UN batch alla volta
 * con un claim atomico (niente doppie esecuzioni), lavora entro il tempo dato e
 * lascia lo stato 'pending' se resta altro da fare (il giro dopo continua).
 */
export async function resumeVisualAnalysis(
  service: Service,
  opts: { deadline: number },
): Promise<{ batchesTouched: number }> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  let touched = 0;

  while (Date.now() < opts.deadline) {
    // Candidati: in attesa, oppure "in esecuzione" ma fermi da troppo tempo
    // (invocazione morta a metà) → vanno ripresi.
    const { data: candidates } = await service
      .from('batches')
      .select('id, organization_id, visual_analysis_status, visual_analysis_claimed_at')
      .in('visual_analysis_status', ['pending', 'running'])
      .order('created_at', { ascending: true })
      .limit(5);

    const batch = (candidates ?? []).find(
      (b) =>
        b.visual_analysis_status === 'pending' ||
        !b.visual_analysis_claimed_at ||
        b.visual_analysis_claimed_at < staleBefore,
    );
    if (!batch) break;
    const currentStatus = batch.visual_analysis_status;
    if (!currentStatus) break;

    // Claim atomico: solo un'esecuzione lavora su questo batch.
    const { data: claimed } = await service
      .from('batches')
      .update({ visual_analysis_status: 'running', visual_analysis_claimed_at: new Date().toISOString() })
      .eq('id', batch.id)
      .eq('visual_analysis_status', currentStatus)
      .select('id');
    if (!claimed || claimed.length === 0) continue; // preso da un altro giro

    touched++;
    if (!batch.organization_id) {
      await mustWrite('batches.update', service
        .from('batches')
        .update({ visual_analysis_status: 'error', visual_analysis_error: 'Organizzazione mancante' })
        .eq('id', batch.id));
      continue;
    }
    try {
      const res = await runVisualExtractionCore(batch.organization_id, { batchId: batch.id });
      if (!res.ok) {
        await mustWrite('batches.update', service
          .from('batches')
          .update({ visual_analysis_status: 'error', visual_analysis_error: res.error })
          .eq('id', batch.id));
        continue;
      }
      // Restano prodotti non analizzati → lascia 'pending': il prossimo giro
      // del cron continua. Altrimenti chiudi.
      const finished = res.data.productsSkipped === 0;
      await mustWrite('batches.update', service
        .from('batches')
        .update({
          visual_analysis_status: finished ? 'done' : 'pending',
          visual_analysis_claimed_at: null,
        })
        .eq('id', batch.id));
      if (finished) continue;
    } catch (e) {
      await mustWrite('batches.update', service
        .from('batches')
        .update({
          visual_analysis_status: 'error',
          visual_analysis_error: e instanceof Error ? e.message : 'Errore analisi foto',
        })
        .eq('id', batch.id));
    }
  }

  return { batchesTouched: touched };
}
