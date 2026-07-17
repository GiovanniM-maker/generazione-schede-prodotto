import {
  computeInputHash,
  deterministicAudit,
  mergeAudits,
  statusFromAudit,
  NON_ADDITIONAL_FIELDS,
  MODA_PRESET_VERSION,
  PRODUCT_COPY_PROMPT_VERSION,
  computeCompleteness,
  type BrandProfile,
  type FactAttribute,
  type ProductCopy,
  type FactAuditResult,
  type Completeness,
} from '@app/core';
import type { AiProviders } from '@app/ai';
import { sectorSafetyRules, sectorSensitiveClaims, type ServerEnv } from '@app/config';
import type { TypedClient, Json, Database } from '@app/database';
import { loadProductFactsV2 } from './facts.js';

// Spec di generazione derivata dal preset: settore + istruzioni per attributo.
export interface PresetGenerationSpec {
  presetVersionId: string;
  sectorKey: string;
  sectorName: string;
  instructions: string[];
  /** Attributi del preset con chiave/nome e obbligatorietà. */
  attributes: { key: string; name: string; isRequired: boolean }[];
}

/** Carica settore + istruzioni di generazione effettive dagli attributi del preset. */
export async function loadPresetGenerationSpec(
  client: TypedClient,
  presetVersionId: string | null,
): Promise<PresetGenerationSpec | null> {
  if (!presetVersionId) return null;
  const { data: pv } = await client
    .from('preset_versions')
    .select('id, preset_id')
    .eq('id', presetVersionId)
    .maybeSingle();
  if (!pv) return null;
  const { data: preset } = await client
    .from('presets')
    .select('id, sector_id')
    .eq('id', pv.preset_id)
    .maybeSingle();
  const { data: sector } = preset?.sector_id
    ? await client.from('sectors').select('key, name').eq('id', preset.sector_id).maybeSingle()
    : { data: null };

  // Istruzioni di generazione effettive per attributo (override o default).
  const { data: pas } = await client
    .from('preset_attributes')
    .select('attribute_id, generation_instruction_override, enabled, is_required')
    .eq('preset_version_id', presetVersionId);
  const attrIds = [...new Set((pas ?? []).map((p) => p.attribute_id))];
  const { data: attrs } = attrIds.length
    ? await client
        .from('attributes')
        .select('id, key, name, attribute_kind, default_generation_instruction')
        .in('id', attrIds)
    : { data: [] };
  const attrMap = new Map((attrs ?? []).map((a) => [a.id, a]));

  const instructions: string[] = [];
  const attributes: PresetGenerationSpec['attributes'] = [];
  const seenKeys = new Set<string>();
  for (const p of pas ?? []) {
    if (p.enabled === false) continue;
    const a = attrMap.get(p.attribute_id);
    const instr = p.generation_instruction_override ?? a?.default_generation_instruction ?? null;
    if (instr && instr.trim()) instructions.push(`${a?.name ?? ''}: ${instr}`.trim());
    const key = a?.key ?? a?.name;
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      // Solo gli attributi FATTUALI possono essere "obbligatori" ai fini della
      // completezza: derived/generative non arrivano dall'input, non vanno
      // contati come mancanti.
      const isFactual = (a?.attribute_kind ?? 'factual') === 'factual';
      attributes.push({ key, name: a?.name ?? key, isRequired: p.is_required === true && isFactual });
    }
  }

  return {
    presetVersionId,
    sectorKey: sector?.key ?? '',
    sectorName: sector?.name ?? '',
    instructions,
    attributes,
  };
}

// ---------------------------------------------------------------------------
// Orchestrazione della generazione di un singolo prodotto. Usata dal worker
// (async) e, per il campione, in modo sincrono dal web.
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE: BrandProfile = {
  style: 'elegante e concreto',
  formality: 'media',
  sentenceLength: 'media',
  person: 'impersonale',
  preferredWords: [],
  forbiddenWords: [],
  structure: {
    shortDescriptionSentences: 2,
    longDescriptionMinWords: 80,
    longDescriptionMaxWords: 120,
    bulletCount: 4,
  },
  ctaPolicy: 'none',
  seoPolicy: 'naturale',
};

const REQUESTED_OUTPUT = [
  'title',
  'shortDescription',
  'longDescription',
  'bullets',
  'metaDescription',
];

export interface GenerationContext {
  client: TypedClient;
  providers: AiProviders;
  env: ServerEnv;
}

async function loadBrandProfile(
  client: TypedClient,
  brandProfileVersionId: string | null,
): Promise<{ profile: BrandProfile; version: string }> {
  if (!brandProfileVersionId) return { profile: DEFAULT_PROFILE, version: 'default' };
  const { data } = await client
    .from('brand_profile_versions')
    .select('id, version, profile_json')
    .eq('id', brandProfileVersionId)
    .single();
  if (!data) return { profile: DEFAULT_PROFILE, version: 'default' };
  return {
    profile: { ...DEFAULT_PROFILE, ...(data.profile_json as unknown as BrandProfile) },
    version: `${data.id}:${data.version}`,
  };
}

/** Genera copy + audit per un insieme di fatti. Nessuna scrittura DB. */
export async function generateCopyWithAudit(
  ctx: GenerationContext,
  facts: FactAttribute[],
  profile: BrandProfile,
  spec?: PresetGenerationSpec | null,
): Promise<{
  content: ProductCopy;
  audit: FactAuditResult;
  completeness: Completeness;
  usage: { inputTokens: number; outputTokens: number; model: string; provider: string };
}> {
  const safetyRules = sectorSafetyRules(spec?.sectorKey);
  const copyResult = await ctx.providers.productCopy.generateCopy({
    presetVersion: spec?.presetVersionId ?? MODA_PRESET_VERSION,
    facts,
    brandProfile: profile,
    language: 'it',
    requestedOutput: REQUESTED_OUTPUT,
    sectorName: spec?.sectorName,
    presetInstructions: spec?.instructions,
    safetyRules,
  });

  // Audit deterministico + claim sensibili specifici del settore.
  const localAudit = deterministicAudit(facts, copyResult.data, sectorSensitiveClaims(spec?.sectorKey));
  let aiAudit: FactAuditResult | null = null;
  try {
    const auditResult = await ctx.providers.factAudit.auditCopy({
      facts,
      content: copyResult.data,
    });
    aiAudit = auditResult.data;
  } catch {
    // L'audit AI è best-effort: quello deterministico resta la garanzia minima.
    aiAudit = null;
  }
  const audit = mergeAudits(localAudit, aiAudit);

  // Completezza rispetto agli attributi obbligatori del preset.
  const presentKeys = facts.map((f) => f.fieldKey);
  const requiredKeys = (spec?.attributes ?? []).filter((a) => a.isRequired).map((a) => a.key);
  const optionalPresentCount = presentKeys.filter((k) => !requiredKeys.includes(k)).length;
  const completeness = computeCompleteness({
    hasSku: true,
    hasAnySource: facts.length > 0,
    requiredAttributeKeys: requiredKeys,
    presentKeys,
    optionalPresentCount,
    auditSeverity: audit.severity,
  });

  return { content: copyResult.data, audit, completeness, usage: copyResult.usage };
}

export interface SampleResult {
  productId: string;
  facts: FactAttribute[];
  content: ProductCopy;
  audit: FactAuditResult;
  completeness: Completeness;
}

/** Genera un campione sincrono per un prodotto rappresentativo del batch. */
export async function generateSample(
  ctx: GenerationContext,
  batchId: string,
): Promise<SampleResult> {
  const { data: batch } = await ctx.client
    .from('batches')
    .select('id, organization_id, brand_profile_version_id, preset_version_id')
    .eq('id', batchId)
    .single();
  if (!batch) throw new Error('INVALID_PRODUCT_DATA: batch non trovato');

  // Sceglie il prodotto con il punteggio qualità più alto.
  const { data: products } = await ctx.client
    .from('products')
    .select('id, canonical_attributes_json, data_quality_score')
    .eq('batch_id', batchId)
    .order('data_quality_score', { ascending: false })
    .limit(5);

  const candidate = (products ?? [])[0];
  if (!candidate) throw new Error('INSUFFICIENT_FACTS: nessun prodotto disponibile');

  const facts = await loadProductFactsV2(ctx.client, candidate.id);
  // Stesso guard della generazione reale: senza ≥2 fatti il campione non è
  // rappresentativo (evita di generare solo dallo SKU dando falsa sicurezza).
  const additional = facts.filter((f) => !NON_ADDITIONAL_FIELDS.has(f.fieldKey)).length;
  if (additional < 2) {
    throw new Error('INSUFFICIENT_FACTS: dati insufficienti per generare un campione');
  }
  const { profile } = await loadBrandProfile(ctx.client, batch.brand_profile_version_id);
  const spec = await loadPresetGenerationSpec(ctx.client, batch.preset_version_id);
  const { content, audit, completeness } = await generateCopyWithAudit(ctx, facts, profile, spec);
  return { productId: candidate.id, facts, content, audit, completeness };
}

export type GenerationOutcome =
  | { outcome: 'completed'; status: string; creditConsumed: boolean }
  | { outcome: 'already_done' }
  | { outcome: 'cache_hit' };

/**
 * Elabora un job item: genera, esegue audit, salva, consuma il credito.
 * Idempotente: se il job è già completato ritorna 'already_done'.
 * Lancia errori normalizzati (prefisso CODICE:) in caso di fallimento.
 */
export async function runProductGeneration(
  ctx: GenerationContext,
  jobItemId: string,
): Promise<GenerationOutcome> {
  const { client } = ctx;

  const { data: job, error: jobErr } = await client
    .from('job_items')
    .select('id, organization_id, batch_id, product_id, status, attempts')
    .eq('id', jobItemId)
    .single();
  if (jobErr || !job) throw new Error(`DATABASE_ERROR: job ${jobItemId} non trovato`);

  if (job.status === 'completed' || job.status === 'needs_review') {
    return { outcome: 'already_done' };
  }

  // Claim ATOMICO: passa a 'processing' solo se il job è ancora accodabile.
  // Se un altro processo l'ha già preso (o completato), nessuna riga torna
  // indietro → evita doppia elaborazione dopo la scadenza del visibility timeout.
  const claimAt = new Date().toISOString();
  const { data: claimed } = await client
    .from('job_items')
    .update({ status: 'processing', started_at: claimAt, locked_at: claimAt })
    .eq('id', jobItemId)
    .in('status', ['queued', 'pending', 'failed'])
    .select('id');
  if (!claimed || claimed.length === 0) {
    return { outcome: 'already_done' };
  }

  const { data: batch } = await client
    .from('batches')
    .select('id, organization_id, brand_profile_version_id, preset_version_id')
    .eq('id', job.batch_id)
    .single();
  if (!batch) throw new Error('DATABASE_ERROR: batch non trovato');

  const facts = await loadProductFactsV2(client, job.product_id);
  // Verifica fatti minimi (terminale, non ritentabile).
  const additional = facts.filter((f) => !NON_ADDITIONAL_FIELDS.has(f.fieldKey)).length;
  if (additional < 2) {
    throw new Error('INSUFFICIENT_FACTS: fatti insufficienti per la generazione');
  }

  const { profile, version: profileVersion } = await loadBrandProfile(
    client,
    batch.brand_profile_version_id,
  );

  const spec = await loadPresetGenerationSpec(client, batch.preset_version_id);
  const model = ctx.env.OPENAI_MODEL_COPY;
  const inputHash = computeInputHash({
    facts,
    presetVersion: spec?.presetVersionId ?? MODA_PRESET_VERSION,
    brandProfileVersion: profileVersion,
    promptVersion: PRODUCT_COPY_PROMPT_VERSION,
    model,
    requestedOutput: REQUESTED_OUTPUT,
    presetInstructions: spec?.instructions,
  });

  // Cache: riusa una generazione esistente con lo stesso hash (0 crediti).
  const { data: cached } = await client
    .from('product_generations')
    .select('generated_content_json, audit_json, completeness_json, status')
    .eq('organization_id', job.organization_id)
    .eq('input_hash', inputHash)
    .in('status', ['generated', 'needs_review', 'accepted'])
    .limit(1)
    .maybeSingle();

  if (cached) {
    // Non ereditare uno stato 'accepted' altrui: questo prodotto non è stato
    // revisionato. Clampa a needs_review/generated.
    const cachedStatus = cached.status === 'accepted' ? 'generated' : cached.status;
    await client.from('product_generations').insert({
      organization_id: job.organization_id,
      product_id: job.product_id,
      generation_run_id: await createRun(ctx, job.organization_id, job.batch_id, model, 'cache', 0, 0),
      input_hash: inputHash,
      generated_content_json: cached.generated_content_json,
      audit_json: cached.audit_json,
      completeness_json: cached.completeness_json,
      status: cachedStatus,
    });
    await client
      .from('products')
      .update({ input_hash: inputHash, verification_status: cachedStatus })
      .eq('id', job.product_id);
    await client
      .from('job_items')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', jobItemId);
    // Cache hit: rilascia il credito riservato (nessun consumo).
    await client.rpc('release_credits', {
      org: job.organization_id,
      amt: 1,
      ref_type: 'cache_hit',
      ref_id: jobItemId,
    });
    await updateBatchProgress(client, job.batch_id);
    return { outcome: 'cache_hit' };
  }

  const { content, audit, completeness, usage } = await generateCopyWithAudit(ctx, facts, profile, spec);
  const genStatus = statusFromAudit(audit);

  const runId = await createRun(
    ctx,
    job.organization_id,
    job.batch_id,
    usage.model,
    usage.provider,
    usage.inputTokens,
    usage.outputTokens,
  );

  await client.from('product_generations').insert({
    organization_id: job.organization_id,
    product_id: job.product_id,
    generation_run_id: runId,
    input_hash: inputHash,
    generated_content_json: content as unknown as Json,
    audit_json: audit as unknown as Json,
    completeness_json: completeness as unknown as Json,
    status: genStatus,
  });

  await client
    .from('products')
    .update({ input_hash: inputHash, verification_status: genStatus })
    .eq('id', job.product_id);

  // Consuma definitivamente il credito riservato.
  await client.rpc('consume_reserved_credit', {
    org: job.organization_id,
    ref_type: 'job_item',
    ref_id: jobItemId,
  });

  const jobStatus = genStatus === 'needs_review' || genStatus === 'rejected' ? 'needs_review' : 'completed';
  await client
    .from('job_items')
    .update({ status: jobStatus, completed_at: new Date().toISOString() })
    .eq('id', jobItemId);

  await updateBatchProgress(client, job.batch_id);
  return { outcome: 'completed', status: genStatus, creditConsumed: true };
}

async function createRun(
  ctx: GenerationContext,
  orgId: string,
  batchId: string,
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
): Promise<string> {
  const { data } = await ctx.client
    .from('generation_runs')
    .insert({
      organization_id: orgId,
      batch_id: batchId,
      run_type: 'product_copy',
      provider,
      model,
      prompt_version: PRODUCT_COPY_PROMPT_VERSION,
      status: 'completed',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost: estimateCost(inputTokens, outputTokens),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  return data!.id;
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  // Stima grezza (USD): tariffe modelli economici. Solo indicativo.
  return Number(((inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.6).toFixed(6));
}

/** Ricalcola i contatori del batch dai job_items e aggiorna lo stato. */
export async function updateBatchProgress(client: TypedClient, batchId: string): Promise<void> {
  const { data: jobs } = await client
    .from('job_items')
    .select('status')
    .eq('batch_id', batchId);
  const list = jobs ?? [];
  const total = list.length;
  const processed = list.filter((j) => j.status === 'completed' || j.status === 'needs_review').length;
  const failed = list.filter((j) => j.status === 'failed').length;

  let status: string | undefined;
  if (total > 0 && processed + failed >= total) {
    status = failed === 0 ? 'completed' : processed === 0 ? 'failed' : 'partial_failed';
  }

  const update: Database['public']['Tables']['batches']['Update'] = {
    processed_products: processed,
    failed_products: failed,
  };
  if (status) {
    update.status = status;
    update.completed_at = new Date().toISOString();
  }
  await client.from('batches').update(update).eq('id', batchId);
}
