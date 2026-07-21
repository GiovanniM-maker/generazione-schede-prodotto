import { NextResponse } from 'next/server';
import { enqueueBatch } from '@app/pipeline';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser } from '@/lib/auth';
import { assertBatchAccess } from '@/lib/ownership';
import { getServiceClient } from '@/lib/supabase/service';
import { runVisualExtractionForBatch } from '@/lib/actions/visual';

// L'estrazione visiva può leggere fino a 50 prodotti: diamo tempo alla funzione.
export const maxDuration = 300;

// POST /api/batches/[batchId]/enqueue — riserva crediti e accoda la generazione.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return NextResponse.json({ error: 'Batch non accessibile' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { notify?: boolean };

  const env = getServerEnv();
  const service = getServiceClient();

  // Opt-in notifica email: salva il destinatario (email dell'account) sul batch.
  // A fine generazione il drain invierà l'avviso.
  if (body.notify && user.email) {
    await service.from('batches').update({ notify_email: user.email, notified_at: null }).eq('id', batchId);
  }

  try {
    // Estrazione visiva automatica PRIMA dell'accodamento: legge le etichette dei
    // prodotti con foto non ancora letti, così anche i prodotti solo-immagini
    // acquisiscono dei fatti e diventano eleggibili. Best-effort (non blocca
    // l'accodamento se fallisce); idempotente (salta i già letti).
    try {
      await runVisualExtractionForBatch({ batchId });
    } catch (e) {
      console.warn('[enqueue] estrazione visiva automatica non riuscita:', e);
    }

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
