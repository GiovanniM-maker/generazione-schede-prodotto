import { NextResponse } from 'next/server';
import { createAiProviders } from '@app/ai';
import { runProductGeneration, handleJobFailure, type GenerationContext } from '@app/pipeline';
import { queueRead, queueDelete } from '@app/database';
import { getServerEnv } from '@/lib/env.server';
import { getServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/auth';
import { notifyCompletedBatches } from '@/lib/notify';

// Drena la coda di generazione lato serverless: fa il lavoro del worker senza
// un processo separato.
// - POST: chiamato dalla pagina "Elaborazione in corso" (utente in sessione)
//   oppure da un cron con header Authorization: Bearer CRON_SECRET.
// - GET: chiamato dal Vercel Cron (vercel.json), che invia una GET con
//   Authorization: Bearer CRON_SECRET impostato automaticamente da Vercel.
// Così la generazione prosegue in background anche a pagina chiusa.
export const maxDuration = 300;

const VISIBILITY_TIMEOUT_SEC = 120;
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;
// Margine sotto maxDuration per chiudere in tempo.
const TIME_BUDGET_MS = 250_000;

function isCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

async function drain(): Promise<{ processed: number; empty: boolean; error?: string }> {
  const env = getServerEnv();
  const service = getServiceClient();
  const providers = createAiProviders(env);
  const ctx: GenerationContext = { client: service, providers, env };

  const deadline = Date.now() + TIME_BUDGET_MS;
  let processed = 0;

  while (Date.now() < deadline) {
    let messages;
    try {
      messages = await queueRead(service, VISIBILITY_TIMEOUT_SEC, CONCURRENCY);
    } catch (err) {
      return { processed, empty: false, error: err instanceof Error ? err.message : 'queue_read' };
    }
    if (messages.length === 0) {
      // Coda vuota: buon momento per notificare i batch appena completati.
      await notifyCompletedBatches(service);
      return { processed, empty: true };
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

  await notifyCompletedBatches(service);
  return { processed, empty: false };
}

export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
  }
  const res = await drain();
  return NextResponse.json(res, { status: res.error ? 500 : 200 });
}

// Vercel Cron invoca la route con una GET. Richiede sempre il CRON_SECRET:
// senza processo separato è il "worker" che gira ogni minuto in produzione.
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
  }
  const res = await drain();
  return NextResponse.json(res, { status: res.error ? 500 : 200 });
}
