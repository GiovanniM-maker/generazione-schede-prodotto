'use server';

import { createAiProviders } from '@app/ai';
import {
  OUTPUT_COPY_FIELDS,
  type FieldInstruction,
  type ProductCopy,
  type PromptCorrection,
} from '@app/core';
import type { Json } from '@app/database';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getServerEnv } from '@/lib/env.server';
import { assertBatchAccess } from '@/lib/ownership';

// ---------------------------------------------------------------------------
// Correzioni degli output + miglioramento del prompt (apprendimento).
//
// Flusso: l'utente modifica un output e spiega il PERCHÉ -> registriamo una
// correzione. Quando ci sono correzioni in sospeso, "Migliora il prompt"
// propone istruzioni migliori (una chiamata AI), crea una BOZZA di preset con
// il diff PRIMA/DOPO e la lascia da pubblicare. Nessuna auto-sovrascrittura.
// Nessun addebito crediti (solo stima di costo mostrata).
// ---------------------------------------------------------------------------

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

const labelByFieldKey = new Map<string, string>(
  OUTPUT_COPY_FIELDS.map((f) => [f.fieldKey, f.label]),
);
const fieldKeyByCopyKey = new Map<string, string>(
  OUTPUT_COPY_FIELDS.map((f) => [f.copyKey, f.fieldKey]),
);

// Stima di costo (conservativa) — modelli economici tipo Flash/mini.
// Mostrata all'utente; NON usata per addebitare crediti.
const PRICE_INPUT_PER_1M_USD = 0.15;
const PRICE_OUTPUT_PER_1M_USD = 0.6;
const MAX_CORRECTIONS_PER_RUN = 100;

function estTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

// --- Accesso -------------------------------------------------------------

interface PresetCtx {
  orgId: string;
  presetId: string;
  presetName: string;
  sectorId: string | null;
  activeVersionId: string | null;
}

async function assertPresetAccess(presetId: string): Promise<PresetCtx | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const service = getServiceClient();
  const { data: preset } = await service
    .from('presets')
    .select('id, name, organization_id, sector_id, active_version_id')
    .eq('id', presetId)
    .maybeSingle();
  if (!preset) return null;
  const { data: member } = await service
    .from('organization_members')
    .select('id')
    .eq('organization_id', preset.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return null;
  return {
    orgId: preset.organization_id,
    presetId: preset.id,
    presetName: preset.name,
    sectorId: preset.sector_id,
    activeVersionId: preset.active_version_id,
  };
}

async function loadProductScope(productId: string): Promise<{
  orgId: string;
  batchId: string;
  presetVersionId: string | null;
  presetId: string | null;
} | null> {
  const service = getServiceClient();
  const { data: product } = await service
    .from('products')
    .select('id, batch_id, preset_version_id')
    .eq('id', productId)
    .maybeSingle();
  if (!product) return null;
  const orgId = await assertBatchAccess(product.batch_id);
  if (!orgId) return null;
  let presetId: string | null = null;
  if (product.preset_version_id) {
    const { data: pv } = await service
      .from('preset_versions')
      .select('preset_id')
      .eq('id', product.preset_version_id)
      .maybeSingle();
    presetId = pv?.preset_id ?? null;
  }
  return { orgId, batchId: product.batch_id, presetVersionId: product.preset_version_id, presetId };
}

// --- Salvataggio modifica + correzione -----------------------------------

export interface OutputChange {
  /** Chiave del campo ProductCopy modificato (title, shortDescription, ...). */
  copyKey: string;
  original: string;
  corrected: string;
  reason: string;
}

/**
 * Salva l'output editato (edited_content_json) e registra le correzioni con il
 * relativo "perché". Le correzioni alimentano il miglioramento del prompt.
 * Gratuito: nessuna chiamata AI, nessun credito.
 */
export async function saveOutputEdit(input: {
  productId: string;
  edited: Partial<ProductCopy>;
  changes: OutputChange[];
}): Promise<ActionResult<{ recorded: number }>> {
  const scope = await loadProductScope(input.productId);
  if (!scope) return fail('Prodotto non accessibile');
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const service = getServiceClient();

  const { data: gen } = await service
    .from('product_generations')
    .select('id, generated_content_json')
    .eq('product_id', input.productId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!gen) return fail('Nessuna generazione da modificare');

  // Persisti il testo editato (separato dall'output originale).
  await service
    .from('product_generations')
    .update({ edited_content_json: input.edited as unknown as Json })
    .eq('id', gen.id);

  // Registra solo le modifiche reali (corrected != original), con o senza motivo.
  const rows = input.changes
    .filter((c) => (c.corrected ?? '') !== (c.original ?? ''))
    .map((c) => {
      const fieldKey = fieldKeyByCopyKey.get(c.copyKey) ?? c.copyKey;
      return {
        organization_id: scope.orgId,
        batch_id: scope.batchId,
        product_id: input.productId,
        generation_id: gen.id,
        preset_id: scope.presetId,
        preset_version_id: scope.presetVersionId,
        field_key: fieldKey,
        original_value: c.original ?? '',
        corrected_value: c.corrected ?? '',
        reason: c.reason?.trim() || null,
        created_by: user.id,
      };
    });

  if (rows.length > 0) {
    await service.from('output_corrections').insert(rows);
  }
  return ok({ recorded: rows.length });
}

// --- Stato + stima costo -------------------------------------------------

export interface CorrectionsStatus {
  pending: number;
  fieldsAffected: number;
  withReason: number;
  estimate: {
    inputTokens: number;
    outputTokens: number;
    usdLow: number;
    usdHigh: number;
  } | null;
}

/** Conta le correzioni in sospeso per il preset e stima il costo del miglioramento. */
export async function getCorrectionsStatus(input: {
  presetId: string;
}): Promise<ActionResult<CorrectionsStatus>> {
  const ctx = await assertPresetAccess(input.presetId);
  if (!ctx) return fail('Preset non accessibile');
  const service = getServiceClient();

  const { data: pending } = await service
    .from('output_corrections')
    .select('field_key, original_value, corrected_value, reason')
    .eq('preset_id', input.presetId)
    .eq('applied_to_prompt', false)
    .limit(MAX_CORRECTIONS_PER_RUN);

  const list = pending ?? [];
  if (list.length === 0) {
    return ok({ pending: 0, fieldsAffected: 0, withReason: 0, estimate: null });
  }

  const fields = new Set(list.map((c) => c.field_key));
  const withReason = list.filter((c) => (c.reason ?? '').trim().length > 0).length;

  // Stima grezza dei token dal volume di testo delle correzioni.
  const chars = list.reduce(
    (acc, c) =>
      acc + (c.original_value?.length ?? 0) + (c.corrected_value?.length ?? 0) + (c.reason?.length ?? 0),
    0,
  );
  const inputTokens = estTokens(chars) + 600; // + system/prompt overhead
  const outputTokens = fields.size * 160;
  const usd =
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_1M_USD +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_1M_USD;

  return ok({
    pending: list.length,
    fieldsAffected: fields.size,
    withReason,
    estimate: {
      inputTokens,
      outputTokens,
      usdLow: Math.round(usd * 10000) / 10000,
      usdHigh: Math.round(usd * 3 * 10000) / 10000, // margine per modelli più costosi
    },
  });
}

// --- Miglioramento del prompt (crea bozza, non pubblica) -----------------

export interface FieldDiff {
  fieldKey: string;
  label: string;
  before: string;
  after: string;
  rationale: string;
}

export interface ImprovementResult {
  presetId: string;
  draftVersionId: string;
  summary: string;
  changes: FieldDiff[];
  correctionsUsed: number;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

async function currentFieldInstructions(
  versionId: string | null,
): Promise<Map<string, { label: string; instruction: string }>> {
  const map = new Map<string, { label: string; instruction: string }>();
  if (!versionId) return map;
  const service = getServiceClient();
  const { data } = await service
    .from('preset_generated_fields')
    .select('field_key, label, config_json')
    .eq('preset_version_id', versionId);
  for (const f of data ?? []) {
    const cfg = (f.config_json ?? {}) as { instruction?: unknown };
    map.set(f.field_key, {
      label: f.label ?? labelByFieldKey.get(f.field_key) ?? f.field_key,
      instruction: typeof cfg.instruction === 'string' ? cfg.instruction : '',
    });
  }
  return map;
}

/**
 * Genera un miglioramento del prompt a partire dalle correzioni in sospeso.
 * Crea una BOZZA di preset con le istruzioni migliorate e restituisce il diff
 * PRIMA/DOPO. NON pubblica: l'utente rivede e pubblica dalla pagina preset.
 */
export async function improvePromptFromCorrections(input: {
  presetId: string;
}): Promise<ActionResult<ImprovementResult>> {
  const ctx = await assertPresetAccess(input.presetId);
  if (!ctx) return fail('Preset non accessibile');
  const service = getServiceClient();

  const { data: pending } = await service
    .from('output_corrections')
    .select('id, field_key, original_value, corrected_value, reason')
    .eq('preset_id', input.presetId)
    .eq('applied_to_prompt', false)
    .order('created_at', { ascending: true })
    .limit(MAX_CORRECTIONS_PER_RUN);

  const list = pending ?? [];
  if (list.length === 0) return fail('Nessuna correzione in sospeso da apprendere');

  // Contesto: settore, istruzioni attuali, tono del brand.
  let sectorName = '';
  if (ctx.sectorId) {
    const { data: sector } = await service
      .from('sectors')
      .select('name')
      .eq('id', ctx.sectorId)
      .maybeSingle();
    sectorName = sector?.name ?? '';
  }
  const currentInstr = await currentFieldInstructions(ctx.activeVersionId);
  const currentInstructions: FieldInstruction[] = [...currentInstr.entries()].map(([fieldKey, v]) => ({
    fieldKey,
    fieldLabel: v.label,
    instruction: v.instruction,
  }));

  const corrections: PromptCorrection[] = list.map((c) => ({
    fieldKey: c.field_key,
    fieldLabel: labelByFieldKey.get(c.field_key) ?? c.field_key,
    original: c.original_value ?? '',
    corrected: c.corrected_value ?? '',
    reason: c.reason ?? '',
  }));

  // Chiamata AI (nessun addebito crediti).
  let improvement;
  try {
    const providers = createAiProviders(getServerEnv());
    improvement = await providers.promptImprove.improvePrompt({
      sectorName,
      presetName: ctx.presetName,
      brandTone: '',
      currentInstructions,
      corrections,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Errore AI';
    return fail(`Miglioramento non riuscito: ${msg}`);
  }

  const improved = improvement.data.fields.filter((f) => f.improvedInstruction.trim().length > 0);
  if (improved.length === 0) {
    return fail('Il modello non ha proposto miglioramenti applicabili');
  }

  // Crea/riusa una bozza del preset (clona la versione attiva).
  const { ensureDraftVersion } = await import('./catalog');
  const draftRes = await ensureDraftVersion({ presetId: input.presetId });
  if (!draftRes.ok) return fail(draftRes.error);
  const draftVersionId = draftRes.versionId;

  // Applica le istruzioni migliorate ai preset_generated_fields della bozza.
  const { data: draftFields } = await service
    .from('preset_generated_fields')
    .select('id, field_key, config_json')
    .eq('preset_version_id', draftVersionId);
  const draftByKey = new Map((draftFields ?? []).map((f) => [f.field_key, f]));

  const changes: FieldDiff[] = [];
  for (const f of improved) {
    const before = currentInstr.get(f.fieldKey)?.instruction ?? '';
    const label = labelByFieldKey.get(f.fieldKey) ?? f.fieldKey;
    const existing = draftByKey.get(f.fieldKey);
    if (existing) {
      const cfg = (existing.config_json ?? {}) as Record<string, unknown>;
      await service
        .from('preset_generated_fields')
        .update({ config_json: { ...cfg, instruction: f.improvedInstruction } as unknown as Json })
        .eq('id', existing.id);
    } else {
      await service.from('preset_generated_fields').insert({
        preset_version_id: draftVersionId,
        field_key: f.fieldKey,
        label,
        config_json: { instruction: f.improvedInstruction } as unknown as Json,
      });
    }
    changes.push({
      fieldKey: f.fieldKey,
      label,
      before,
      after: f.improvedInstruction,
      rationale: f.rationale,
    });
  }

  // NB: le correzioni NON vengono marcate qui. Restano "in sospeso" finché la
  // bozza non viene PUBBLICATA (publishImprovement): così, se l'utente scarta il
  // miglioramento, le correzioni sono ancora disponibili per un nuovo tentativo.

  return ok({
    presetId: input.presetId,
    draftVersionId,
    summary: improvement.data.summary,
    changes,
    correctionsUsed: list.length,
    usage: {
      inputTokens: improvement.usage.inputTokens,
      outputTokens: improvement.usage.outputTokens,
      model: improvement.usage.model,
    },
  });
}

/**
 * Pubblica la bozza migliorata del preset e marca come "assorbite" le correzioni
 * in sospeso (che diventano parte del prompt attivo). È il punto in cui i
 * miglioramenti hanno effetto sulla PROSSIMA generazione.
 */
export async function publishImprovement(input: {
  presetId: string;
}): Promise<ActionResult<{ published: boolean; correctionsApplied: number }>> {
  const ctx = await assertPresetAccess(input.presetId);
  if (!ctx) return fail('Preset non accessibile');
  const service = getServiceClient();

  const { publishPresetVersion } = await import('./catalog');
  const pubRes = await publishPresetVersion({ presetId: input.presetId });
  if (!pubRes.ok) return fail(pubRes.error);

  // La versione appena pubblicata è ora l'attiva: collega le correzioni a essa.
  const { data: preset } = await service
    .from('presets')
    .select('active_version_id')
    .eq('id', input.presetId)
    .maybeSingle();

  const { data: applied } = await service
    .from('output_corrections')
    .update({
      applied_to_prompt: true,
      applied_at: new Date().toISOString(),
      improvement_version_id: preset?.active_version_id ?? null,
    })
    .eq('preset_id', input.presetId)
    .eq('applied_to_prompt', false)
    .select('id');

  return ok({ published: true, correctionsApplied: (applied ?? []).length });
}
