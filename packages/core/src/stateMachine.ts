// ---------------------------------------------------------------------------
// State machine di batch e job item. Transizioni valide esplicite.
// ---------------------------------------------------------------------------

export type BatchStatus =
  | 'draft'
  | 'uploaded'
  | 'mapping'
  | 'input_review'
  | 'tone_setup'
  | 'sample_pending'
  | 'sample_ready'
  | 'approved'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'canceled';

export type JobItemStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'needs_review'
  | 'failed'
  | 'canceled';

const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  draft: ['uploaded', 'canceled'],
  uploaded: ['mapping', 'canceled'],
  mapping: ['input_review', 'canceled'],
  input_review: ['tone_setup', 'mapping', 'canceled'],
  tone_setup: ['sample_pending', 'input_review', 'canceled'],
  sample_pending: ['sample_ready', 'failed', 'canceled'],
  sample_ready: ['approved', 'sample_pending', 'tone_setup', 'canceled'],
  approved: ['queued', 'canceled'],
  queued: ['processing', 'canceled'],
  processing: ['completed', 'partial_failed', 'failed', 'canceled'],
  completed: [],
  partial_failed: ['queued', 'completed'], // retry dei falliti
  failed: ['queued'],
  canceled: [],
};

const JOB_TRANSITIONS: Record<JobItemStatus, JobItemStatus[]> = {
  pending: ['queued', 'canceled'],
  queued: ['processing', 'canceled'],
  processing: ['completed', 'needs_review', 'failed'],
  needs_review: ['completed', 'processing', 'canceled'],
  failed: ['queued', 'canceled'], // retry
  completed: [],
  canceled: [],
};

export function canTransitionBatch(from: BatchStatus, to: BatchStatus): boolean {
  return BATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionJob(from: JobItemStatus, to: JobItemStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertBatchTransition(from: BatchStatus, to: BatchStatus): void {
  if (!canTransitionBatch(from, to)) {
    throw new Error(`Transizione batch non valida: ${from} -> ${to}`);
  }
}

export function assertJobTransition(from: JobItemStatus, to: JobItemStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Transizione job non valida: ${from} -> ${to}`);
  }
}

/** Deriva lo stato finale del batch dai contatori. */
export function deriveBatchOutcome(
  total: number,
  completed: number,
  failed: number,
): BatchStatus | null {
  if (total === 0) return null;
  if (completed + failed < total) return 'processing';
  if (failed === 0) return 'completed';
  if (completed === 0) return 'failed';
  return 'partial_failed';
}
