'use server';

import type { Json } from '@app/database';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';

// Inbox dei "dubbi" dell'AI. Un dubbio nasce da un dato letto dalle foto con
// bassa confidenza: l'AI chiede conferma all'utente, che risponde (conferma /
// correzione), e il dato del prodotto viene aggiornato.

const CONFIDENCE_THRESHOLD = 0.8;
const FINAL_STATUSES = new Set(['confirmed', 'rejected']);

type Service = ReturnType<typeof getServiceClient>;

function asText(v: Json | null | undefined): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Genera i dubbi per un batch dai valori letti dalle foto con bassa confidenza.
 * Idempotente: salta i (prodotto, campo) che hanno già un dubbio aperto.
 */
export async function generateDoubtsForBatch(
  service: Service,
  batchId: string,
  orgId: string,
): Promise<number> {
  const { data: products } = await service
    .from('products')
    .select('id')
    .eq('batch_id', batchId);
  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) return 0;

  const { data: pavs } = await service
    .from('product_attribute_values')
    .select('product_id, attribute_id, value_json, confidence, status, source_type')
    .in('product_id', productIds)
    .eq('source_type', 'image');
  const candidates = (pavs ?? []).filter(
    (p) =>
      typeof p.confidence === 'number' &&
      p.confidence < CONFIDENCE_THRESHOLD &&
      !FINAL_STATUSES.has(p.status),
  );
  if (candidates.length === 0) return 0;

  // Etichette attributo.
  const attrIds = [...new Set(candidates.map((c) => c.attribute_id))];
  const { data: attrs } = await service.from('attributes').select('id, name').in('id', attrIds);
  const labelById = new Map((attrs ?? []).map((a) => [a.id, a.name] as const));

  // Evita doppioni: salta i (prodotto, campo) con dubbio già aperto.
  const { data: existing } = await service
    .from('ai_doubts')
    .select('product_id, field_key')
    .eq('batch_id', batchId)
    .eq('status', 'open');
  const seen = new Set((existing ?? []).map((e) => `${e.product_id}|${e.field_key}`));

  const rows = candidates
    .map((c) => {
      const label = labelById.get(c.attribute_id) ?? 'campo';
      const fieldKey = `attr:${c.attribute_id}`;
      if (seen.has(`${c.product_id}|${fieldKey}`)) return null;
      const value = asText(c.value_json);
      const pct = Math.round((c.confidence ?? 0) * 100);
      return {
        organization_id: orgId,
        batch_id: batchId,
        product_id: c.product_id,
        attribute_id: c.attribute_id,
        field_key: fieldKey,
        field_label: label,
        question: `Ho letto «${label}» come «${value}» dalla foto, ma non sono sicuro (${pct}%). È corretto?`,
        suggested_value: value,
        confidence: c.confidence,
        status: 'open',
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return 0;
  await service.from('ai_doubts').insert(rows);
  return rows.length;
}

/** Genera i dubbi una sola volta per i batch appena completati (chiamata dal drain). */
export async function finalizeDoubtsForCompletedBatches(service: Service): Promise<void> {
  let batches;
  try {
    const { data } = await service
      .from('batches')
      .select('id, organization_id')
      .in('status', ['completed', 'partial_failed'])
      .is('doubts_generated_at', null)
      .limit(20);
    batches = data;
  } catch {
    return;
  }
  for (const b of batches ?? []) {
    const { data: claimed } = await service
      .from('batches')
      .update({ doubts_generated_at: new Date().toISOString() })
      .eq('id', b.id)
      .is('doubts_generated_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    try {
      await generateDoubtsForBatch(service, b.id, b.organization_id);
    } catch {
      /* best-effort */
    }
  }
}

// --- Azioni per la UI (inbox) --------------------------------------------------

export interface DoubtView {
  id: string;
  batchId: string | null;
  productId: string | null;
  fieldLabel: string | null;
  question: string;
  suggestedValue: string | null;
  confidence: number | null;
  productName: string | null;
  createdAt: string;
}

export async function countOpenDoubtsAction(): Promise<number> {
  const user = await getSessionUser();
  if (!user) return 0;
  const org = await getUserOrg(user.id);
  if (!org) return 0;
  const service = getServiceClient();
  const { count } = await service
    .from('ai_doubts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.organizationId)
    .eq('status', 'open');
  return count ?? 0;
}

export async function listOpenDoubtsAction(): Promise<{ ok: true; data: DoubtView[] } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const org = await getUserOrg(user.id);
  if (!org) return { ok: false, error: 'Organizzazione non trovata' };
  const service = getServiceClient();
  const { data } = await service
    .from('ai_doubts')
    .select('id, batch_id, product_id, field_label, question, suggested_value, confidence, created_at')
    .eq('organization_id', org.organizationId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((p): p is string => !!p))];
  const nameById = new Map<string, string>();
  if (productIds.length) {
    const { data: prods } = await service.from('products').select('id, name, sku').in('id', productIds);
    for (const p of prods ?? []) nameById.set(p.id, p.name ?? p.sku ?? 'Prodotto');
  }
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      batchId: r.batch_id,
      productId: r.product_id,
      fieldLabel: r.field_label,
      question: r.question,
      suggestedValue: r.suggested_value,
      confidence: r.confidence,
      productName: r.product_id ? nameById.get(r.product_id) ?? null : null,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Risponde a un dubbio: conferma il valore letto, oppure lo corregge, oppure lo
 * ignora. Aggiorna anche il dato del prodotto (product_attribute_values).
 */
export async function answerDoubtAction(input: {
  doubtId: string;
  action: 'confirm' | 'correct' | 'dismiss';
  value?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const org = await getUserOrg(user.id);
  if (!org) return { ok: false, error: 'Organizzazione non trovata' };
  const service = getServiceClient();

  const { data: doubt } = await service
    .from('ai_doubts')
    .select('id, organization_id, product_id, attribute_id, suggested_value, status')
    .eq('id', input.doubtId)
    .maybeSingle();
  if (!doubt || doubt.organization_id !== org.organizationId) {
    return { ok: false, error: 'Dubbio non accessibile' };
  }
  if (doubt.status !== 'open') return { ok: true }; // già gestito

  const now = new Date().toISOString();

  if (input.action !== 'dismiss' && doubt.product_id && doubt.attribute_id) {
    const newValue = input.action === 'correct' ? (input.value ?? '').trim() : (doubt.suggested_value ?? '');
    await service
      .from('product_attribute_values')
      .update({ value_json: newValue as unknown as Json, status: 'confirmed', confidence: 1 })
      .eq('product_id', doubt.product_id)
      .eq('attribute_id', doubt.attribute_id);
  }

  await service
    .from('ai_doubts')
    .update({
      status: input.action === 'dismiss' ? 'dismissed' : 'answered',
      answer: input.action === 'correct' ? (input.value ?? '').trim() : input.action,
      answered_at: now,
      answered_by: user.id,
    })
    .eq('id', input.doubtId);

  return { ok: true };
}
