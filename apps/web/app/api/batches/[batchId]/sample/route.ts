import { NextResponse } from 'next/server';
import { createAiProviders } from '@app/ai';
import { generateSample } from '@app/pipeline';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser } from '@/lib/auth';
import { assertBatchAccess } from '@/lib/ownership';
import { getServiceClient } from '@/lib/supabase/service';
import { checkAiRateLimit } from '@/lib/rate-limit';
import { runVisualExtractionForBatch } from '@/lib/actions/visual';
import {
  logWrite,
} from '@app/core';
import { writeOrTrace } from '@app/pipeline';

// Il campione legge le etichette dalle foto (vision) e poi genera il testo:
// ben oltre il timeout predefinito (10s) → serve margine, altrimenti la
// richiesta viene troncata e l'utente vede un errore generico.
export const maxDuration = 300;

// POST /api/batches/[batchId]/sample — genera un campione sincrono (gratuito).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return NextResponse.json({ error: 'Batch non accessibile' }, { status: 403 });

  const rl = await checkAiRateLimit(orgId, 'sample');
  if (!rl.allowed) return NextResponse.json({ error: rl.message }, { status: 429 });

  const env = getServerEnv();
  const service = getServiceClient();
  const providers = createAiProviders(env);

  try {
    await writeOrTrace(
      service,
      'batches.update(campione_in_corso)',
      service.from('batches').update({ status: 'sample_pending' }).eq('id', batchId),
      { organizationId: orgId, batchId, refId: batchId },
    );

    // Estrazione visiva automatica sul prodotto campione: se ha immagini e non è
    // ancora stato letto, l'AI legge le etichette così il campione ha dei fatti
    // da cui scrivere (anche per batch di sole foto). Best-effort e limitato al
    // solo candidato (veloce, niente timeout).
    // Stesso ordine deterministico di generateSample (qualità desc, id asc): così
    // i prodotti che l'AI legge sono ESATTAMENTE i candidati del campione. Ne
    // leggiamo qualcuno (non solo il primo) per coprire il fallback.
    const { data: candidates } = await service
      .from('products')
      .select('id')
      .eq('batch_id', batchId)
      .order('data_quality_score', { ascending: false })
      .order('id', { ascending: true })
      .limit(3);
    for (const c of candidates ?? []) {
      try {
        await runVisualExtractionForBatch({ batchId, productIds: [c.id] });
      } catch (e) {
        console.warn('[sample] estrazione visiva campione non riuscita:', e);
      }
    }

    const sample = await generateSample({ client: service, providers, env }, batchId);
    // Il campione e' gia' stato pagato al modello: rispondere 500 lo butterebbe
    // via. Ma senza questo stato il wizard non lascia passare al passo dopo.
    await writeOrTrace(
      service,
      'batches.update(campione_pronto)',
      service.from('batches').update({ status: 'sample_ready' }).eq('id', batchId),
      { organizationId: orgId, batchId, refId: batchId },
    );
    await logWrite('app_events.insert', service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'sample_generated',
      batch_id: batchId,
      metadata_json: { severity: sample.audit.severity },
    }));
    return NextResponse.json(sample);
  } catch (err) {
    await writeOrTrace(
      service,
      'batches.update(campione_ripristino)',
      service.from('batches').update({ status: 'tone_setup' }).eq('id', batchId),
      { organizationId: orgId, batchId, refId: batchId },
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Errore generazione campione' },
      { status: 500 },
    );
  }
}
