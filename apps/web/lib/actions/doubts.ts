'use server';

import type { Json } from '@app/database';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { mustWrite } from '@app/core';

// Inbox dei "dubbi" dell'AI. Un dubbio nasce da un dato letto dalle foto con
// bassa confidenza: l'AI chiede conferma all'utente, che risponde (conferma /
// correzione), e il dato del prodotto viene aggiornato.





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
    // E' la risposta dell'utente al dubbio: se non arriva a database, il
    // dubbio risulta risolto e il valore resta quello sbagliato.
    const corretto = await mustWrite('product_attribute_values.update', service
      .from('product_attribute_values')
      .update({ value_json: newValue as unknown as Json, status: 'confirmed', confidence: 1 })
      .eq('product_id', doubt.product_id)
      .eq('attribute_id', doubt.attribute_id));
    if (!corretto.ok) return { ok: false, error: `Valore non aggiornato: ${corretto.error}` };
  }

  const chiuso = await mustWrite('ai_doubts.update', service
    .from('ai_doubts')
    .update({
      status: input.action === 'dismiss' ? 'dismissed' : 'answered',
      answer: input.action === 'correct' ? (input.value ?? '').trim() : input.action,
      answered_at: now,
      answered_by: user.id,
    })
    .eq('id', input.doubtId));
  if (!chiuso.ok) return { ok: false, error: `Dubbio non chiuso: ${chiuso.error}` };

  return { ok: true };
}
