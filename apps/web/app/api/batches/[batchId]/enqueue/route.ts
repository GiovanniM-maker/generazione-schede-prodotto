import { NextResponse } from 'next/server';
import { enqueueBatch } from '@app/pipeline';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser } from '@/lib/auth';
import { assertBatchAccess } from '@/lib/ownership';
import { getServiceClient } from '@/lib/supabase/service';

// POST /api/batches/[batchId]/enqueue — riserva crediti e accoda la generazione.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return NextResponse.json({ error: 'Batch non accessibile' }, { status: 403 });

  const env = getServerEnv();
  const service = getServiceClient();

  try {
    // NON pre-impostare lo stato: la guardia di enqueueBatch deve restare
    // autoritativa (evita ri-addebito su chiamate ripetute dopo il completamento).
    const result = await enqueueBatch(service, env, batchId);

    if (result.enqueued === 0) {
      // Distingui "già in coda/elaborato" (guardia) da "nessun eleggibile".
      const { data: b } = await service
        .from('batches')
        .select('status')
        .eq('id', batchId)
        .maybeSingle();
      const alreadyRunning = ['queued', 'processing', 'completed', 'partial_failed'].includes(
        b?.status ?? '',
      );
      if (alreadyRunning) {
        return NextResponse.json(
          { error: 'Il batch è già stato avviato o completato.', code: 'ALREADY_STARTED' },
          { status: 409 },
        );
      }
      // Genuinamente 0 eleggibili pre-elaborazione: torna alla verifica dati.
      await service.from('batches').update({ status: 'input_review' }).eq('id', batchId);
      return NextResponse.json(
        {
          error:
            'Nessun prodotto è eleggibile per la generazione. Servono uno SKU e almeno 2 attributi valorizzati per prodotto. Controlla la mappatura e i dati.',
          code: 'NO_ELIGIBLE_PRODUCTS',
        },
        { status: 422 },
      );
    }

    // Evento storico best-effort: non deve far scattare il rollback del catch.
    try {
      await service.from('app_events').insert({
        organization_id: orgId,
        user_id: user.id,
        event_name: 'generation_started',
        batch_id: batchId,
        metadata_json: { enqueued: result.enqueued },
      });
    } catch {
      /* storico accessorio */
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore';
    const status = message.startsWith('INSUFFICIENT_CREDITS') ? 402 : 500;
    // Ripristina lo stato per consentire un nuovo tentativo.
    await service.from('batches').update({ status: 'sample_ready' }).eq('id', batchId);
    return NextResponse.json({ error: message }, { status });
  }
}
