import { NextResponse } from 'next/server';
import { createAiProviders } from '@app/ai';
import { runProductGeneration, handleJobFailure, type GenerationContext } from '@app/pipeline';
import { queueRead, queueDelete } from '@app/database';
import { getServerEnv } from '@/lib/env.server';
import { getServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/auth';

// Drena la coda di generazione lato serverless: fa il lavoro del worker senza
// un processo separato. Chiamato dalla pagina "Elaborazione in corso" (sessione)
// e, opzionalmente, da un Vercel Cron (header Authorization: Bearer CRON_SECRET).
export const maxDuration = 300;

const VISIBILITY_TIMEOUT_SEC = 120;
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;
// Margine sotto maxDuration per chiudere in tempo.
const TIME_BUDGET_MS = 250_000;

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  if (!isCron) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
  }

  const env = getServerEnv();
  const service = getServiceClient();
  const providers = createAiProviders(env);
  const ctx: GenerationContext = { client: service, providers, env };

  const deadline = Date.now() + TIME_BUDGET_MS;
  let processed = 0;
  let empty = false;

  while (Date.now() < deadline) {
    let messages;
    try {
      messages = await queueRead(service, VISIBILITY_TIMEOUT_SEC, CONCURRENCY);
    } catch (err) {
      return NextResponse.json(
        { processed, error: err instanceof Error ? err.message : 'queue_read' },
        { status: 500 },
      );
    }
    if (messages.length === 0) {
      empty = true;
      break;
    }
    await Promise.all(
      messages.map(async (m) => {
        const jobItemId = m.message.jobItemId;
        let done = false;
        try {
          await runProductGeneration(ctx, jobItemId);
          done = true;
        } catch (err) {
          const decision = await handleJobFailure(service, jobItemId, err, MAX_ATTEMPTS);
          // Fallimento definitivo: rimuovi comunque il messaggio (credito rimborsato).
          if (!decision.retry) done = true;
        }
        if (done) {
          try {
            await queueDelete(service, m.msg_id);
          } catch {
            /* il messaggio riapparirà; runProductGeneration è idempotente */
          }
        }
      }),
    );
    processed += messages.length;
  }

  return NextResponse.json({ processed, empty });
}
