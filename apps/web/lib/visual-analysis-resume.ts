// ---------------------------------------------------------------------------
// Ripresa delle analisi foto in sospeso. Modulo normale, NON "use server".
//
// Riceve il client di servizio come parametro e non fa controlli di sessione:
// e' il cron a chiamarla. Esportata da un file "use server" sarebbe stata un
// endpoint pubblico.
// ---------------------------------------------------------------------------

import { getServiceClient } from '@/lib/supabase/service';
import { mustWrite } from '@app/core';
import { runVisualExtractionCore } from '@/lib/visual-core';

type Service = ReturnType<typeof getServiceClient>;

/** Un'esecuzione bloccata da piu' di questo tempo viene ripresa. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

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
