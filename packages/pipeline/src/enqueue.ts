import { classifyError, isRetryable } from '@app/core';
import type { ErrorCode } from '@app/config';
import type { ServerEnv } from '@app/config';
import { queueSend, type TypedClient } from '@app/database';
import { updateBatchProgress } from './generate.js';

// ---------------------------------------------------------------------------
// Prenotazione crediti + creazione job items + invio messaggi in coda.
// Transazionale sui crediti tramite reserve_credits (advisory lock in SQL).
// ---------------------------------------------------------------------------

export interface EnqueueResult {
  enqueued: number;
  reserved: number;
  skipped: number;
}

/**
 * Accoda i prodotti eleggibili di un batch. Verifica e riserva i crediti in
 * modo atomico. Crea un job_item per prodotto (unique index impedisce doppioni)
 * e invia un messaggio con SOLO il jobItemId.
 */
export async function enqueueBatch(
  client: TypedClient,
  env: ServerEnv,
  batchId: string,
): Promise<EnqueueResult> {
  const { data: batch, error: batchErr } = await client
    .from('batches')
    .select('id, organization_id, status')
    .eq('id', batchId)
    .single();
  if (batchErr || !batch) throw new Error('DATABASE_ERROR: batch non trovato');

  // Guardia anti doppio-enqueue: se il batch è già in coda/elaborazione non
  // riservare di nuovo i crediti (eviterebbe un leak di crediti riservati).
  if (batch.status === 'queued' || batch.status === 'processing') {
    return { enqueued: 0, reserved: 0, skipped: 0 };
  }

  // Prodotti eleggibili: sector-agnostico. L'eleggibilità (SKU + ≥2 fatti) è
  // calcolata all'import e salvata in verification_status='eligible'.
  const { data: products } = await client
    .from('products')
    .select('id')
    .eq('batch_id', batchId)
    .eq('verification_status', 'eligible');

  const eligible = products ?? [];
  if (eligible.length === 0) {
    return { enqueued: 0, reserved: 0, skipped: 0 };
  }

  // Riserva N crediti atomicamente.
  const { data: reserved, error: resErr } = await client.rpc('reserve_credits', {
    org: batch.organization_id,
    amt: eligible.length,
    ref_type: 'batch',
    ref_id: batchId,
  });
  if (resErr) throw new Error(`DATABASE_ERROR: ${resErr.message}`);
  if (!reserved) {
    throw new Error('INSUFFICIENT_CREDITS: crediti insufficienti per il batch');
  }

  await client
    .from('batches')
    .update({ status: 'queued', credits_reserved: eligible.length, started_at: new Date().toISOString() })
    .eq('id', batchId);

  let enqueued = 0;
  let skipped = 0;
  for (const p of eligible) {
    // Inserisci job_item; l'indice univoco parziale evita doppioni attivi.
    const { data: job, error: jobErr } = await client
      .from('job_items')
      .insert({
        organization_id: batch.organization_id,
        batch_id: batchId,
        product_id: p.id,
        status: 'queued',
      })
      .select('id')
      .single();
    if (jobErr || !job) {
      skipped++;
      continue;
    }
    await queueSend(client, { jobItemId: job.id });
    enqueued++;
  }

  // Rilascia i crediti riservati ma non usati (item saltati per doppioni/errore),
  // così nessun credito resta bloccato.
  if (skipped > 0) {
    await client.rpc('release_credits', {
      org: batch.organization_id,
      amt: skipped,
      ref_type: 'enqueue_skip',
      ref_id: batchId,
    });
  }

  await client
    .from('batches')
    .update({ status: 'processing', credits_reserved: enqueued })
    .eq('id', batchId);
  await updateBatchProgress(client, batchId);
  return { enqueued, reserved: eligible.length, skipped };
}

// ---------------------------------------------------------------------------
// Gestione fallimento di un job item nel worker.
// ---------------------------------------------------------------------------

export interface FailureDecision {
  retry: boolean;
  code: ErrorCode;
}

/** Normalizza un errore in ErrorCode, riconoscendo il prefisso "CODICE:". */
export function normalizeErrorCode(err: unknown): ErrorCode {
  const msg = err instanceof Error ? err.message : String(err);
  const prefix = msg.split(':')[0]?.trim();
  const known: ErrorCode[] = [
    'INVALID_PRODUCT_DATA',
    'INSUFFICIENT_FACTS',
    'AI_RATE_LIMIT',
    'AI_TIMEOUT',
    'AI_INVALID_OUTPUT',
    'AI_UNSUPPORTED_CLAIM',
    'STORAGE_ERROR',
    'DATABASE_ERROR',
    'UNKNOWN_ERROR',
  ];
  if (prefix && known.includes(prefix as ErrorCode)) return prefix as ErrorCode;
  return classifyError(err);
}

/**
 * Registra il fallimento di un job. Se non ritentabile o esauriti i tentativi:
 * marca failed, rilascia il credito riservato, aggiorna il batch.
 */
export async function handleJobFailure(
  client: TypedClient,
  jobItemId: string,
  err: unknown,
  maxAttempts: number,
): Promise<FailureDecision> {
  const code = normalizeErrorCode(err);
  const message = err instanceof Error ? err.message : String(err);

  const { data: job } = await client
    .from('job_items')
    .select('id, organization_id, batch_id, attempts, status')
    .eq('id', jobItemId)
    .single();
  if (!job) return { retry: false, code };

  // Se il job è già in stato terminale di successo, NON marcare failed né
  // rimborsare: l'errore proviene da un'operazione post-successo (es. delete coda).
  if (job.status === 'completed' || job.status === 'needs_review') {
    return { retry: false, code };
  }

  const attempts = (job.attempts ?? 0) + 1;
  const retry = isRetryable(code) && attempts < maxAttempts;

  if (retry) {
    await client
      .from('job_items')
      .update({ status: 'queued', attempts, last_error_code: code, last_error_message: message })
      .eq('id', jobItemId);
    return { retry: true, code };
  }

  // Definitivo: marca failed e rilascia il credito riservato (rimborso).
  await client
    .from('job_items')
    .update({ status: 'failed', attempts, last_error_code: code, last_error_message: message })
    .eq('id', jobItemId);
  await client.rpc('release_credits', {
    org: job.organization_id,
    amt: 1,
    ref_type: 'job_failed',
    ref_id: jobItemId,
  });
  await updateBatchProgress(client, job.batch_id);
  return { retry: false, code };
}
