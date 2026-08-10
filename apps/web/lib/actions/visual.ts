'use server';

import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';
import { checkAiRateLimit } from '@/lib/rate-limit';
import { runVisualExtractionCore } from '@/lib/visual-core';
import type { ActionResult, VisualExtractionSummary } from '@/lib/visual-core';

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

export async function runVisualExtractionForBatch(input: {
  batchId: string;
  /** Se true, ri-analizza anche i prodotti già letti (default: salta i già fatti). */
  force?: boolean;
  /** Se valorizzato, limita l'estrazione a questi prodotti (es. il campione). */
  productIds?: string[];
  /** Se true, NON deduce la categoria dalle foto (quando è mappata dal file/a mano). */
  skipCategory?: boolean;
}): Promise<ActionResult<VisualExtractionSummary>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');

  const rl = await checkAiRateLimit(orgId, 'visual');
  if (!rl.allowed) return fail(rl.message);

  return runVisualExtractionCore(orgId, input);
}

async function assertPavAccess(
  service: ReturnType<typeof getServiceClient>,
  pavId: string,
): Promise<{ orgId: string; productId: string } | null> {
  const { data: pav } = await service
    .from('product_attribute_values')
    .select('product_id')
    .eq('id', pavId)
    .maybeSingle();
  if (!pav) return null;
  const { data: product } = await service
    .from('products')
    .select('batch_id')
    .eq('id', pav.product_id)
    .maybeSingle();
  if (!product) return null;
  const orgId = await assertBatchAccess(product.batch_id);
  if (!orgId) return null;
  return { orgId, productId: pav.product_id };
}

export async function confirmAttributeValue(input: {
  productAttributeValueId: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const service = getServiceClient();
  const access = await assertPavAccess(service, input.productAttributeValueId);
  if (!access) return fail('Valore non accessibile');

  const { error } = await service
    .from('product_attribute_values')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: user.id,
    })
    .eq('id', input.productAttributeValueId);
  if (error) return fail(error.message);
  return ok({ id: input.productAttributeValueId });
}

export async function rejectAttributeValue(input: {
  id: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const service = getServiceClient();
  const access = await assertPavAccess(service, input.id);
  if (!access) return fail('Valore non accessibile');

  const { error } = await service
    .from('product_attribute_values')
    .update({ status: 'rejected' })
    .eq('id', input.id);
  if (error) return fail(error.message);
  return ok({ id: input.id });
}

// ---------------------------------------------------------------------------
// Elenco dei valori inferred_visual per la UI di revisione.
// ---------------------------------------------------------------------------

export interface InferredAttributeRow {
  id: string;
  attributeName: string;
  value: string;
  confidence: number | null;
}

export interface InferredProductGroup {
  productId: string;
  sku: string | null;
  name: string | null;
  attributes: InferredAttributeRow[];
}

export async function listInferredAttributes(input: {
  batchId: string;
}): Promise<ActionResult<{ products: InferredProductGroup[] }>> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return fail('Batch non accessibile');
  const service = getServiceClient();

  const { data: products } = await service
    .from('products')
    .select('id, sku, name')
    .eq('batch_id', input.batchId)
    .order('created_at', { ascending: true });
  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) return ok({ products: [] });

  const { data: pav } = await service
    .from('product_attribute_values')
    .select('id, product_id, attribute_id, value_json, confidence')
    .eq('status', 'inferred_visual')
    .in('product_id', productIds);
  const rows = pav ?? [];
  if (rows.length === 0) return ok({ products: [] });

  const attrIds = [...new Set(rows.map((r) => r.attribute_id))];
  const { data: attrs } = await service
    .from('attributes')
    .select('id, name')
    .in('id', attrIds);
  const attrName = new Map((attrs ?? []).map((a) => [a.id, a.name]));

  const byProduct = new Map<string, InferredAttributeRow[]>();
  for (const r of rows) {
    const value =
      typeof r.value_json === 'string' ? r.value_json : r.value_json == null ? '' : String(r.value_json);
    const list = byProduct.get(r.product_id) ?? [];
    list.push({
      id: r.id,
      attributeName: attrName.get(r.attribute_id) ?? 'Attributo',
      value,
      confidence: r.confidence,
    });
    byProduct.set(r.product_id, list);
  }

  const groups: InferredProductGroup[] = (products ?? [])
    .filter((p) => byProduct.has(p.id))
    .map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      attributes: byProduct.get(p.id) ?? [],
    }));

  return ok({ products: groups });
}

