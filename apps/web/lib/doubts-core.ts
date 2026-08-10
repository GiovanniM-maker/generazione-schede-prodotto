// ---------------------------------------------------------------------------
// Generazione dei "dubbi" dell'AI. Modulo normale, NON "use server".
//
// Queste funzioni ricevono il client di servizio come parametro e non fanno
// controlli di sessione: sono pensate per il cron. Esportate da un file
// "use server" sarebbero diventate endpoint pubblici, cioe' l'esatto contrario
// di cio' che sono.
// ---------------------------------------------------------------------------

import type { Json } from '@app/database';
import { getServiceClient } from '@/lib/supabase/service';
import { mustWrite } from '@app/core';

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
  await mustWrite('ai_doubts.insert', service.from('ai_doubts').insert(rows));
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


