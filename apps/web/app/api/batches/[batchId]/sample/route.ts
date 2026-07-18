import { NextResponse } from 'next/server';
import { createAiProviders } from '@app/ai';
import { generateSample } from '@app/pipeline';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser } from '@/lib/auth';
import { assertBatchAccess } from '@/lib/ownership';
import { getServiceClient } from '@/lib/supabase/service';
import { checkAiRateLimit } from '@/lib/rate-limit';

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
    await service.from('batches').update({ status: 'sample_pending' }).eq('id', batchId);
    const sample = await generateSample({ client: service, providers, env }, batchId);
    await service.from('batches').update({ status: 'sample_ready' }).eq('id', batchId);
    await service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'sample_generated',
      batch_id: batchId,
      metadata_json: { severity: sample.audit.severity },
    });
    return NextResponse.json(sample);
  } catch (err) {
    await service.from('batches').update({ status: 'tone_setup' }).eq('id', batchId);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Errore generazione campione' },
      { status: 500 },
    );
  }
}
