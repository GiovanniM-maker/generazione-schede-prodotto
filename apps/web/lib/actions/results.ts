'use server';

import { queueSend, type Json } from '@app/database';
import type { ProductCopy } from '@app/core';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';

// Azioni sulla pagina risultati: edit (salvato separato), accetta, rifiuta, rigenera.

async function latestGenerationId(productId: string): Promise<string | null> {
  const service = getServiceClient();
  const { data } = await service
    .from('product_generations')
    .select('id')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function assertProductAccess(productId: string): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');
  const service = getServiceClient();
  const { data: product } = await service
    .from('products')
    .select('batch_id')
    .eq('id', productId)
    .single();
  if (!product) throw new Error('Prodotto non trovato');
  const orgId = await assertBatchAccess(product.batch_id);
  if (!orgId) throw new Error('Non accessibile');
  return orgId;
}

export interface ProductAttributeView {
  attributeId: string;
  name: string;
  value: string;
  /** Da dove arriva il dato. */
  source: 'foto' | 'excel' | 'manuale' | 'derivato' | 'altro';
  /** Stato del valore (usato/da confermare/…). */
  status: string;
  /** true = fatto usabile in generazione; false = da confermare. */
  usable: boolean;
  confidence: number | null;
}

const USABLE_PAV = new Set([
  'provided',
  'extracted_from_file',
  'extracted_from_image',
  'derived',
  'confirmed',
]);

/** Attributi (fatti) di un prodotto, con fonte e confidenza — per il dettaglio scheda. */
export async function getProductAttributesAction(
  productId: string,
): Promise<{ ok: true; data: ProductAttributeView[] } | { ok: false; error: string }> {
  try {
    await assertProductAccess(productId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Non accessibile' };
  }
  const service = getServiceClient();
  const { data: rows } = await service
    .from('product_attribute_values')
    .select('attribute_id, value_json, status, source_type, confidence')
    .eq('product_id', productId);
  const usableRows = (rows ?? []).filter((r) => r.status !== 'rejected');
  const attrIds = [...new Set(usableRows.map((r) => r.attribute_id))];
  const { data: attrs } = attrIds.length
    ? await service.from('attributes').select('id, name').in('id', attrIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const nameById = new Map((attrs ?? []).map((a) => [a.id, a.name] as const));

  function sourceLabel(s: string | null, status: string): ProductAttributeView['source'] {
    if (s === 'image') return 'foto';
    if (s === 'manual') return 'manuale';
    if (s === 'derived' || status === 'derived') return 'derivato';
    if (s === 'file' || s === 'spreadsheet' || status === 'extracted_from_file' || status === 'provided')
      return 'excel';
    return 'altro';
  }

  const data: ProductAttributeView[] = usableRows
    .map((r) => ({
      attributeId: r.attribute_id,
      name: nameById.get(r.attribute_id) ?? 'attributo',
      value:
        typeof r.value_json === 'string'
          ? r.value_json
          : r.value_json == null
            ? ''
            : JSON.stringify(r.value_json),
      source: sourceLabel(r.source_type, r.status),
      status: r.status,
      usable: USABLE_PAV.has(r.status),
      confidence: typeof r.confidence === 'number' ? r.confidence : null,
    }))
    .filter((a) => a.value.trim() !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, data };
}

/**
 * Risolve un "dubbio" direttamente dalla tabella dei campi della scheda:
 * conferma il valore letto (affidabilità → 100%) oppure lo corregge. Aggiorna
 * il fatto del prodotto e chiude l'eventuale dubbio aperto nell'inbox.
 */
export async function confirmProductFactAction(input: {
  productId: string;
  attributeId: string;
  value?: string; // se presente → correzione; altrimenti → conferma del valore attuale
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertProductAccess(input.productId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Non accessibile' };
  }
  const service = getServiceClient();
  const patch: Record<string, unknown> = { status: 'confirmed', confidence: 1 };
  const corrected = input.value != null ? input.value.trim() : null;
  if (corrected !== null) patch.value_json = corrected as unknown as Json;
  await service
    .from('product_attribute_values')
    .update(patch)
    .eq('product_id', input.productId)
    .eq('attribute_id', input.attributeId);
  // Chiude il dubbio corrispondente (se presente) così non resta anche nell'inbox.
  await service
    .from('ai_doubts')
    .update({
      status: 'answered',
      answer: corrected ?? 'confirm',
      answered_at: new Date().toISOString(),
    })
    .eq('product_id', input.productId)
    .eq('attribute_id', input.attributeId)
    .eq('status', 'open');
  return { ok: true };
}

/** Salva il testo editato SEPARATAMENTE dall'output generato originale. */
export async function saveEditAction(input: {
  productId: string;
  edited: Partial<ProductCopy>;
}): Promise<void> {
  await assertProductAccess(input.productId);
  const genId = await latestGenerationId(input.productId);
  if (!genId) throw new Error('Nessuna generazione da modificare');
  const service = getServiceClient();
  await service
    .from('product_generations')
    .update({ edited_content_json: input.edited as unknown as Json })
    .eq('id', genId);
}

export async function acceptGenerationAction(productId: string): Promise<void> {
  await assertProductAccess(productId);
  const genId = await latestGenerationId(productId);
  if (!genId) throw new Error('Nessuna generazione');
  const service = getServiceClient();
  await service
    .from('product_generations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', genId);
}

export async function rejectGenerationAction(productId: string): Promise<void> {
  await assertProductAccess(productId);
  const genId = await latestGenerationId(productId);
  if (!genId) throw new Error('Nessuna generazione');
  const service = getServiceClient();
  await service.from('product_generations').update({ status: 'rejected' }).eq('id', genId);
}

/**
 * Rigenera un singolo prodotto: riserva 1 credito e accoda un nuovo job.
 * Per mantenere corrette le invarianti del ledger (una prenotazione per job,
 * consumata al successo o rimborsata a fallimento/cache), nell'MVP la
 * rigenerazione manuale consuma sempre 1 credito.
 */
export async function regenerateProductAction(input: {
  batchId: string;
  productId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return { ok: false, error: 'Non accessibile' };
  const service = getServiceClient();

  // IDOR guard: il prodotto deve appartenere a QUESTO batch (e quindi a questa
  // org). Senza questo, si potrebbe rigenerare il prodotto di un'altra org.
  const { data: product } = await service
    .from('products')
    .select('id')
    .eq('id', input.productId)
    .eq('batch_id', input.batchId)
    .maybeSingle();
  if (!product) return { ok: false, error: 'Prodotto non appartenente al batch' };

  const { data: reserved } = await service.rpc('reserve_credits', {
    org: orgId,
    amt: 1,
    ref_type: 'regen',
    ref_id: input.productId,
  });
  if (!reserved) return { ok: false, error: 'INSUFFICIENT_CREDITS' };

  const { data: job, error } = await service
    .from('job_items')
    .insert({
      organization_id: orgId,
      batch_id: input.batchId,
      product_id: input.productId,
      status: 'queued',
    })
    .select('id')
    .single();
  if (error || !job) {
    // L'insert può fallire se esiste già un job attivo per il prodotto
    // (unique index). Rilascia il credito riservato per non addebitarlo a vuoto.
    await service.rpc('release_credits', {
      org: orgId,
      amt: 1,
      ref_type: 'regen_failed',
      ref_id: input.productId,
    });
    return {
      ok: false,
      error: 'Rigenerazione già in corso per questo prodotto. Attendi il completamento.',
    };
  }
  await queueSend(service, { jobItemId: job.id });
  return { ok: true };
}
