import {
  computeInputHash,
  deterministicAudit,
  mergeAudits,
  statusFromAudit,
  NON_ADDITIONAL_FIELDS,
  MODA_PRESET_VERSION,
  PRODUCT_COPY_PROMPT_VERSION,
  type BrandProfile,
  type FactAttribute,
  type ProductCopy,
  type FactAuditResult,
} from '@app/core';
import type { AiProviders } from '@app/ai';
import type { ServerEnv } from '@app/config';
import type { TypedClient, Json, Database } from '@app/database';
import { loadProductFacts } from './facts.js';

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
): Promise<{
  content: ProductCopy;
  audit: FactAuditResult;
  usage: { inputTokens: number; outputTokens: number; model: string; provider: string };
}> {
  const copyResult = await ctx.providers.productCopy.generateCopy({
    presetVersion: MODA_PRESET_VERSION,
    facts,
    brandProfile: profile,
    language: 'it',
    requestedOutput: REQUESTED_OUTPUT,
  });

  const localAudit = deterministicAudit(facts, copyResult.data);
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
  return { content: copyResult.data, audit, usage: copyResult.usage };
}

export interface SampleResult {
  productId: string;
  facts: FactAttribute[];
  content: ProductCopy;
  audit: FactAuditResult;
}

/** Genera un campione sincrono per un prodotto rappresentativo del batch. */
export async function generateSample(
  ctx: GenerationContext,
  batchId: string,
): Promise<SampleResult> {
  const { data: batch } = await ctx.client
    .from('batches')
    .select('id, organization_id, brand_profile_version_id')
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

  const facts = await loadProductFacts(ctx.client, candidate.id);
  const { profile } = await loadBrandProfile(ctx.client, batch.brand_profile_version_id);
  const { content, audit } = await generateCopyWithAudit(ctx, facts, profile);
  return { productId: candidate.id, facts, content, audit };
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

  await client
    .from('job_items')
    .update({ status: 'processing', started_at: new Date().toISOString(), locked_at: new Date().toISOString() })
    .eq('id', jobItemId);

  const { data: batch } = await client
    .from('batches')
    .select('id, organization_id, brand_profile_version_id')
    .eq('id', job.batch_id)
    .single();
  if (!batch) throw new Error('DATABASE_ERROR: batch non trovato');

  const facts = await loadProductFacts(client, job.product_id);
  // Verifica fatti minimi (terminale, non ritentabile).
  const additional = facts.filter((f) => !NON_ADDITIONAL_FIELDS.has(f.fieldKey)).length;
  if (additional < 2) {
    throw new Error('INSUFFICIENT_FACTS: fatti insufficienti per la generazione');
  }

  const { profile, version: profileVersion } = await loadBrandProfile(
    client,
    batch.brand_profile_version_id,
  );

  const model = ctx.env.OPENAI_MODEL_COPY;
  const inputHash = computeInputHash({
    facts,
    presetVersion: MODA_PRESET_VERSION,
    brandProfileVersion: profileVersion,
    promptVersion: PRODUCT_COPY_PROMPT_VERSION,
    model,
    requestedOutput: REQUESTED_OUTPUT,
  });

  // Cache: riusa una generazione esistente con lo stesso hash (0 crediti).
  const { data: cached } = await client
    .from('product_generations')
    .select('generated_content_json, audit_json, status')
    .eq('organization_id', job.organization_id)
    .eq('input_hash', inputHash)
    .in('status', ['generated', 'needs_review', 'accepted'])
    .limit(1)
    .maybeSingle();

  if (cached) {
    await client.from('product_generations').insert({
      organization_id: job.organization_id,
      product_id: job.product_id,
      generation_run_id: await createRun(ctx, job.organization_id, job.batch_id, model, 'cache', 0, 0),
      input_hash: inputHash,
      generated_content_json: cached.generated_content_json,
      audit_json: cached.audit_json,
      status: cached.status,
    });
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

  const { content, audit, usage } = await generateCopyWithAudit(ctx, facts, profile);
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
