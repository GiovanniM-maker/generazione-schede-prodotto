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
import { checkAiRateLimit } from '@/lib/rate-limit';

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

  // Limiti anti-abuso sul testo che poi confluisce nel prompt di miglioramento.
  const cap = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

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
        original_value: cap(c.original ?? '', 8000),
        corrected_value: cap(c.corrected ?? '', 8000),
        reason: c.reason?.trim() ? cap(c.reason.trim(), 1000) : null,
        created_by: user.id,
      };
    });

  if (rows.length > 0) {
    // Sostituisci eventuali correzioni ANCORA IN SOSPESO sullo stesso
    // (prodotto, campo): teniamo solo l'ultima, così ri-modifiche successive
    // non accumulano duplicati (BUG audit #1, difesa lato server).
    const fieldKeys = [...new Set(rows.map((r) => r.field_key))];
    await service
      .from('output_corrections')
      .delete()
      .eq('product_id', input.productId)
      .eq('applied_to_prompt', false)
      .in('field_key', fieldKeys);
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

  // Conteggio ESATTO delle correzioni in sospeso (non troncato a 100).
  const { count: pendingCount } = await service
    .from('output_corrections')
    .select('id', { count: 'exact', head: true })
    .eq('preset_id', input.presetId)
    .eq('applied_to_prompt', false);

  // Campione per la stima (fino al tetto per esecuzione).
  const { data: pending } = await service
    .from('output_corrections')
    .select('field_key, original_value, corrected_value, reason')
    .eq('preset_id', input.presetId)
    .eq('applied_to_prompt', false)
    .order('created_at', { ascending: true })
    .limit(MAX_CORRECTIONS_PER_RUN);

  const list = pending ?? [];
  const total = pendingCount ?? list.length;
  if (total === 0) {
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
    pending: total,
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
  const usedIds = list.map((c) => c.id);

  // Rate limit per org sui miglioramenti del prompt.
  const rl = await checkAiRateLimit(ctx.orgId, 'prompt_improve');
  if (!rl.allowed) return fail(rl.message);

  // Contesto: settore.
  let sectorName = '';
  if (ctx.sectorId) {
    const { data: sector } = await service
      .from('sectors')
      .select('name')
      .eq('id', ctx.sectorId)
      .maybeSingle();
    sectorName = sector?.name ?? '';
  }

  // Crea/riusa la BOZZA del preset PRIMA di chiamare l'AI: la baseline delle
  // istruzioni (e il diff "prima") deve venire dalla bozza, non dalla versione
  // attiva — così ri-eseguire "Migliora" parte dallo stato già staged (BUG #4).
  const { ensureDraftVersion } = await import('./catalog');
  const draftRes = await ensureDraftVersion({ presetId: input.presetId });
  if (!draftRes.ok) return fail(draftRes.error);
  const draftVersionId = draftRes.versionId;

  const draftInstr = await currentFieldInstructions(draftVersionId);
  const currentInstructions: FieldInstruction[] = [...draftInstr.entries()].map(([fieldKey, v]) => ({
    fieldKey,
    fieldLabel: v.label,
    instruction: v.instruction,
  }));

  // Budget totale di caratteri inviati all'AI (anti-abuso costo/latenza):
  // include solo le correzioni finché non si supera la soglia.
  const CHAR_BUDGET = 60_000;
  const corrections: PromptCorrection[] = [];
  let used = 0;
  for (const c of list) {
    const size =
      (c.original_value?.length ?? 0) + (c.corrected_value?.length ?? 0) + (c.reason?.length ?? 0);
    if (used + size > CHAR_BUDGET && corrections.length > 0) break;
    used += size;
    corrections.push({
      fieldKey: c.field_key,
      fieldLabel: labelByFieldKey.get(c.field_key) ?? c.field_key,
      original: c.original_value ?? '',
      corrected: c.corrected_value ?? '',
      reason: c.reason ?? '',
    });
  }

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

  // Controllo di sicurezza lato codice (oltre alla revisione umana): scarta le
  // istruzioni migliorate che tentano di ordinare l'invenzione di fatti o che
  // riflettono un'injection dal "reason" (es. "scrivi sempre che è biologico
  // anche se non nei dati"). Il principio "i dati posseggono i fatti" non è
  // negoziabile via prompt.
  const UNSAFE_PATTERNS: RegExp[] = [
    /invent/i,
    /\banche se non\b/i,
    /a prescindere dai (dati|fatti)/i,
    /ignora (le|queste|ogni|le regole|le istruzioni)/i,
    /scrivi sempre che/i,
    /dichiara sempre/i,
    /afferma sempre/i,
    /always (say|state|claim)/i,
    /even if (not|it'?s not|absent)/i,
    /regardless of the (data|facts)/i,
  ];
  const improved = improvement.data.fields.filter(
    (f) =>
      f.improvedInstruction.trim().length > 0 &&
      !UNSAFE_PATTERNS.some((re) => re.test(f.improvedInstruction)),
  );
  if (improved.length === 0) {
    return fail(
      'Il miglioramento proposto non è applicabile (vuoto o conteneva istruzioni non sicure che spingerebbero a inventare dati). Riprova affinando le motivazioni.',
    );
  }

  // Applica le istruzioni migliorate ai preset_generated_fields della bozza.
  const { data: draftFields } = await service
    .from('preset_generated_fields')
    .select('id, field_key, config_json')
    .eq('preset_version_id', draftVersionId);
  const draftByKey = new Map((draftFields ?? []).map((f) => [f.field_key, f]));

  const changes: FieldDiff[] = [];
  for (const f of improved) {
    const before = draftInstr.get(f.fieldKey)?.instruction ?? '';
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

  // "Prenota" le correzioni usate collegandole a questa bozza (SENZA marcarle
  // applied): solo QUESTE verranno assorbite alla pubblicazione, non quelle
  // create nel frattempo (BUG #2/#6). Se l'utente scarta, restano in sospeso.
  await service
    .from('output_corrections')
    .update({ improvement_version_id: draftVersionId })
    .in('id', usedIds);

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
  draftVersionId: string;
}): Promise<ActionResult<{ published: boolean; correctionsApplied: number }>> {
  const ctx = await assertPresetAccess(input.presetId);
  if (!ctx) return fail('Preset non accessibile');
  const service = getServiceClient();

  // Verifica che la bozza da pubblicare sia effettivamente quella del
  // miglioramento e appartenga al preset (evita di pubblicare bozze estranee).
  const { data: draftVer } = await service
    .from('preset_versions')
    .select('id, preset_id, published_at')
    .eq('id', input.draftVersionId)
    .maybeSingle();
  if (!draftVer || draftVer.preset_id !== input.presetId) {
    return fail('Bozza del miglioramento non trovata');
  }

  const { publishPresetVersion } = await import('./catalog');
  const pubRes = await publishPresetVersion({ presetId: input.presetId });
  if (!pubRes.ok) return fail(pubRes.error);

  // Marca applied SOLO le correzioni prenotate da QUESTO miglioramento
  // (improvement_version_id = bozza pubblicata). Le altre restano in sospeso.
  const { data: applied } = await service
    .from('output_corrections')
    .update({
      applied_to_prompt: true,
      applied_at: new Date().toISOString(),
    })
    .eq('preset_id', input.presetId)
    .eq('improvement_version_id', input.draftVersionId)
    .eq('applied_to_prompt', false)
    .select('id');
  const preset = { active_version_id: input.draftVersionId };

  // Storico: registra il miglioramento del prompt pubblicato.
  const user = await getSessionUser();
  try {
    await service.from('app_events').insert({
      organization_id: ctx.orgId,
      user_id: user?.id ?? null,
      event_name: 'prompt_improved',
      metadata_json: {
        presetId: input.presetId,
        presetName: ctx.presetName,
        correctionsApplied: (applied ?? []).length,
        versionId: preset?.active_version_id ?? null,
      } as unknown as Json,
    });
  } catch {
    // storico best-effort
  }

  return ok({ published: true, correctionsApplied: (applied ?? []).length });
}
