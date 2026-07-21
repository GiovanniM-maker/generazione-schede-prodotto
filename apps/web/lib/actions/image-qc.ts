'use server';

import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';

// Controllo Qualità immagini — AVVISI SOFT (non blocca). Derivato dai dati che
// abbiamo già (sha256, dimensioni file, confidenza/copertura dell'estrazione):
// nessuna chiamata AI extra. Segnala foto duplicate, a bassa risoluzione, poco
// leggibili, e suggerisce dati/foto mancanti.

const LOW_RES_BYTES = 45_000; // < ~45KB: quasi sempre miniatura/bassa risoluzione
const MIN_IMAGE_FACTS = 2; // meno di 2 fatti letti da foto = poco leggibile
const LOW_CONFIDENCE = 0.6;

export interface ProductQc {
  productId: string;
  sku: string | null;
  name: string | null;
  imagesCount: number;
  level: 'ok' | 'warn';
  issues: string[];
  suggestions: string[];
}

export interface ImageQcResult {
  items: ProductQc[];
  warnCount: number;
  total: number;
}

export async function getBatchImageQcAction(
  input: { batchId: string },
): Promise<{ ok: true; data: ImageQcResult } | { ok: false; error: string }> {
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return { ok: false, error: 'Batch non accessibile' };
  const service = getServiceClient();

  const { data: products } = await service
    .from('products')
    .select('id, sku, name')
    .eq('batch_id', input.batchId);
  if (!products || products.length === 0) return { ok: true, data: { items: [], warnCount: 0, total: 0 } };
  const productIds = products.map((p) => p.id);

  // Catena immagini: product_source_links -> source_items -> source_files.
  const { data: links } = await service
    .from('product_source_links')
    .select('product_id, source_item_id')
    .in('product_id', productIds);
  const itemIds = [...new Set((links ?? []).map((l) => l.source_item_id).filter((x): x is string => !!x))];
  const { data: items } = itemIds.length
    ? await service.from('source_items').select('id, source_file_id').in('id', itemIds)
    : { data: [] as Array<{ id: string; source_file_id: string | null }> };
  const fileIdByItem = new Map((items ?? []).map((i) => [i.id, i.source_file_id] as const));
  const fileIds = [...new Set((items ?? []).map((i) => i.source_file_id).filter((x): x is string => !!x))];
  const { data: files } = fileIds.length
    ? await service.from('source_files').select('id, sha256, size_bytes').in('id', fileIds)
    : { data: [] as Array<{ id: string; sha256: string; size_bytes: number }> };
  const fileById = new Map((files ?? []).map((f) => [f.id, f] as const));

  // product -> immagini {sha256, size}
  const imagesByProduct = new Map<string, Array<{ sha256: string; size: number }>>();
  for (const l of links ?? []) {
    const fileId = l.source_item_id ? fileIdByItem.get(l.source_item_id) : null;
    const file = fileId ? fileById.get(fileId) : null;
    if (!file) continue;
    const arr = imagesByProduct.get(l.product_id) ?? [];
    arr.push({ sha256: file.sha256, size: Number(file.size_bytes) });
    imagesByProduct.set(l.product_id, arr);
  }

  // sha256 condiviso tra prodotti diversi = foto duplicata.
  const productsBySha = new Map<string, Set<string>>();
  for (const [pid, imgs] of imagesByProduct) {
    for (const img of imgs) {
      const s = productsBySha.get(img.sha256) ?? new Set();
      s.add(pid);
      productsBySha.set(img.sha256, s);
    }
  }

  // Fatti letti dalle foto per prodotto (conteggio usabili + confidenza media).
  const { data: pavs } = await service
    .from('product_attribute_values')
    .select('product_id, confidence, status, source_type')
    .in('product_id', productIds)
    .eq('source_type', 'image');
  const factStats = new Map<string, { count: number; confSum: number; confN: number }>();
  for (const p of pavs ?? []) {
    if (p.status === 'rejected') continue;
    const st = factStats.get(p.product_id) ?? { count: 0, confSum: 0, confN: 0 };
    st.count++;
    if (typeof p.confidence === 'number') {
      st.confSum += p.confidence;
      st.confN++;
    }
    factStats.set(p.product_id, st);
  }

  const items2: ProductQc[] = [];
  for (const prod of products) {
    const imgs = imagesByProduct.get(prod.id) ?? [];
    if (imgs.length === 0) continue; // QC solo per prodotti con foto
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (imgs.some((i) => productsBySha.get(i.sha256) && productsBySha.get(i.sha256)!.size > 1)) {
      issues.push('Foto duplicata con un altro prodotto');
    }
    if (imgs.every((i) => i.size > 0 && i.size < LOW_RES_BYTES)) {
      issues.push('Foto a bassa risoluzione');
      suggestions.push('Carica foto più grandi/nitide (l’e-commerce e l’AI leggono meglio).');
    }
    const st = factStats.get(prod.id);
    const facts = st?.count ?? 0;
    const avgConf = st && st.confN ? st.confSum / st.confN : 1;
    if (facts < MIN_IMAGE_FACTS) {
      issues.push('Foto poco leggibile: pochi dati estratti');
      suggestions.push('Aggiungi una foto ravvicinata dell’etichetta / del retro (ingredienti, tabella, dosi).');
    } else if (avgConf < LOW_CONFIDENCE) {
      issues.push('Alcuni dati letti con bassa sicurezza');
      suggestions.push('Una foto più nitida dell’etichetta migliora la precisione.');
    }

    items2.push({
      productId: prod.id,
      sku: prod.sku,
      name: prod.name,
      imagesCount: imgs.length,
      level: issues.length ? 'warn' : 'ok',
      issues,
      suggestions: [...new Set(suggestions)],
    });
  }

  const warnCount = items2.filter((i) => i.level === 'warn').length;
  return { ok: true, data: { items: items2, warnCount, total: items2.length } };
}
