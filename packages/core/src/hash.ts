import { createHash } from 'node:crypto';
import type { FactAttribute } from './types.js';

// ---------------------------------------------------------------------------
// input_hash deterministico per caching/idempotenza. Serializza in modo stabile
// i fatti canonici + versioni + modello + output richiesto.
// ---------------------------------------------------------------------------

/** Serializzazione JSON con chiavi ordinate (deterministica). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export interface HashInput {
  facts: FactAttribute[];
  presetVersion: string;
  brandProfileVersion: string;
  promptVersion: string;
  model: string;
  requestedOutput: string[];
}

/** Normalizza i fatti a coppie {fieldKey, value, status} ordinate per chiave. */
function canonicalFacts(facts: FactAttribute[]): Array<[string, string, string]> {
  return facts
    .map((f) => [f.fieldKey, f.value, f.status] as [string, string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function computeInputHash(input: HashInput): string {
  const payload = {
    facts: canonicalFacts(input.facts),
    presetVersion: input.presetVersion,
    brandProfileVersion: input.brandProfileVersion,
    promptVersion: input.promptVersion,
    model: input.model,
    requestedOutput: [...input.requestedOutput].sort(),
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}
