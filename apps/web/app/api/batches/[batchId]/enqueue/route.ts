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
    await service.from('batches').update({ status: 'approved' }).eq('id', batchId);
    const result = await enqueueBatch(service, env, batchId);

    // Nessun prodotto eleggibile: non lasciare il batch in "approved" (finirebbe
    // in una schermata di elaborazione bloccata a 0/0). Riporta l'utente alla
    // verifica dati con un messaggio chiaro.
    if (result.enqueued === 0) {
      await service
        .from('batches')
        .update({ status: 'input_review' })
        .eq('id', batchId);
      return NextResponse.json(
        {
          error:
            'Nessun prodotto è eleggibile per la generazione. Servono uno SKU e almeno 2 attributi valorizzati per prodotto. Controlla la mappatura e i dati.',
          code: 'NO_ELIGIBLE_PRODUCTS',
        },
        { status: 422 },
      );
    }

    await service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'generation_started',
      batch_id: batchId,
      metadata_json: { enqueued: result.enqueued },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore';
    const status = message.startsWith('INSUFFICIENT_CREDITS') ? 402 : 500;
    // Ripristina lo stato per consentire un nuovo tentativo.
    await service.from('batches').update({ status: 'sample_ready' }).eq('id', batchId);
    return NextResponse.json({ error: message }, { status });
  }
}
