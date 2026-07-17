import { RETRYABLE_ERROR_CODES, type ErrorCode } from '@app/config';

// ---------------------------------------------------------------------------
// Classificazione retry ed exponential backoff. I validation error non si
// ritentano; rate limit/timeout/storage/db sì.
// ---------------------------------------------------------------------------

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.includes(code);
}

/** Decide se ritentare dato il codice errore e i tentativi già fatti. */
export function shouldRetry(code: ErrorCode, attempts: number, maxAttempts: number): boolean {
  if (!isRetryable(code)) return false;
  return attempts < maxAttempts;
}

/** Backoff esponenziale con jitter deterministico opzionale (ms). */
export function backoffMs(attempt: number, baseMs = 2000, capMs = 60000, jitter = 0): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return exp + Math.max(0, jitter);
}

/** Normalizza un errore sconosciuto in un ErrorCode. */
export function classifyError(err: unknown): ErrorCode {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429')) return 'AI_RATE_LIMIT';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'AI_TIMEOUT';
  if (msg.includes('invalid') && msg.includes('output')) return 'AI_INVALID_OUTPUT';
  if (msg.includes('storage')) return 'STORAGE_ERROR';
  if (msg.includes('database') || msg.includes('postgres') || msg.includes('sql')) {
    return 'DATABASE_ERROR';
  }
  return 'UNKNOWN_ERROR';
}
