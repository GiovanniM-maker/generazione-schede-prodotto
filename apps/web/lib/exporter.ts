import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import {
  buildExportRow,
  exportColumns,
  isCompletenessExportable,
  neutralizeCell,
  type TranslationsMap,
  type ProductCopy,
  type FactAuditResult,
  type ProductGenerationDecision,
} from '@app/core';
import type { TypedClient, Json } from '@app/database';
import {
  buildPlatformExport,
  type ExportItem,
  type ExportPlatform,
} from '@/lib/export-platforms';

export type ExportFormat = 'csv' | 'xlsx' | ExportPlatform;
const PLATFORMS: ExportPlatform[] = ['shopify', 'woocommerce', 'prestashop'];
function isPlatform(f: string): f is ExportPlatform {
  return (PLATFORMS as string[]).includes(f);
}

// Costruisce l'export (CSV/XLSX) di un batch: testo editato preferito al
// generato, protezione formula injection, esclusione severità high.

export interface ExportBuildResult {
  buffer: Buffer;
  contentType: string;
  rowCount: number;
  extension: string;
}

const EXTRA_FACT_COLUMNS = ['color', 'composition', 'material', 'fit', 'category', 'brand'];

export async function buildBatchExport(
  service: TypedClient,
  batchId: string,
  format: ExportFormat,
): Promise<ExportBuildResult> {
  // Ultima generazione per prodotto del batch.
  const { data: products } = await service
    .from('products')
    .select('id, external_id, name, category, parent_external_id, canonical_attributes_json')
    .eq('batch_id', batchId);

  // Attributi SPECIFICI di categoria (fatti estratti da foto/Excel): vanno
  // esportati come colonne dinamiche, una per attributo. Prende i valori usabili
  // (non rifiutati) dei prodotti del batch.
  const productIds = (products ?? []).map((p) => p.id);
  const { data: pavRows } = productIds.length
    ? await service
        .from('product_attribute_values')
        .select('product_id, attribute_id, value_json, status')
        .in('product_id', productIds)
    : { data: [] as Array<{ product_id: string; attribute_id: string; value_json: unknown; status: string }> };
  const pavAttrIds = [...new Set((pavRows ?? []).map((r) => r.attribute_id))];
  const { data: attrRows } = pavAttrIds.length
    ? await service.from('attributes').select('id, name').in('id', pavAttrIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const attrNameById = new Map((attrRows ?? []).map((a) => [a.id, a.name] as const));
  const pavValue = (v: unknown): string =>
    typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  // product_id → { nome attributo → valore }. Colonne = unione ordinata dei nomi.
  const factsByProduct = new Map<string, Record<string, string>>();
  const factColumnSet = new Set<string>();
  for (const r of pavRows ?? []) {
    if (r.status === 'rejected') continue;
    const name = attrNameById.get(r.attribute_id);
    const value = pavValue(r.value_json).trim();
    if (!name || value === '') continue;
    const rec = factsByProduct.get(r.product_id) ?? {};
    rec[name] = value;
    factsByProduct.set(r.product_id, rec);
    factColumnSet.add(name);
  }

  const rows: Array<Record<string, string>> = [];
  const items: ExportItem[] = [];
  const usedLangs = new Set<string>();
  let hasParents = false;
  for (const product of products ?? []) {
    const { data: gen } = await service
      .from('product_generations')
      .select('generated_content_json, edited_content_json, audit_json, completeness_json, translations_json, status')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!gen) continue;

    const audit = (gen.audit_json ?? null) as unknown as FactAuditResult | null;
    // Esclude i prodotti con severità high non risolti.
    if (audit?.severity === 'high') continue;

    // Esclude anche le schede non esportabili per completezza (blocked/insufficient):
    // dati troppo carenti per un export affidabile.
    const completeness = (gen.completeness_json ?? null) as {
      status?: ProductGenerationDecision;
    } | null;
    if (completeness?.status && !isCompletenessExportable(completeness.status))
      continue;

    const generated = gen.generated_content_json as unknown as ProductCopy;
    const edited = (gen.edited_content_json ?? null) as unknown as Partial<ProductCopy> | null;
    const canonical = (product.canonical_attributes_json ?? {}) as Record<string, string>;

    const baseRow = buildExportRow(
      {
        externalId: product.external_id,
        sku: canonical['sku'] ?? null,
        productName: product.name,
        canonicalAttributes: canonical,
        generated,
        edited,
        audit,
        verificationStatus: gen.status,
      },
      EXTRA_FACT_COLUMNS,
    );
    // Legame variante: codice padre condiviso da colore/taglia dello stesso prodotto.
    const parentId = product.parent_external_id ?? '';
    if (parentId) hasParents = true;
    baseRow['codice_padre'] = parentId;
    // Attributi specifici di categoria come colonne dedicate.
    const facts = factsByProduct.get(product.id);
    if (facts) {
      for (const [name, value] of Object.entries(facts)) {
        baseRow[name] = neutralizeCell(value);
      }
    }
    // Colonne per lingua dalle traduzioni salvate (title_en, ..., faq_en).
    const translations = ((gen.translations_json ?? {}) as TranslationsMap) || {};
    for (const [lang, t] of Object.entries(translations)) {
      if (!t) continue;
      usedLangs.add(lang);
      baseRow[`title_${lang}`] = neutralizeCell(t.title ?? '');
      baseRow[`short_description_${lang}`] = neutralizeCell(t.shortDescription ?? '');
      baseRow[`long_description_${lang}`] = neutralizeCell(t.longDescription ?? '');
      baseRow[`bullets_${lang}`] = neutralizeCell((t.bullets ?? []).join(' | '));
      baseRow[`meta_description_${lang}`] = neutralizeCell(t.metaDescription ?? '');
      baseRow[`alt_text_${lang}`] = neutralizeCell(t.altText ?? '');
      baseRow[`faq_${lang}`] = neutralizeCell(
        (t.faq ?? []).map((f) => `D: ${f.question} R: ${f.answer}`).join(' | '),
      );
    }
    rows.push(baseRow);

    // Versione normalizzata (testo editato preferito) per i mapper piattaforma.
    items.push({
      sku: canonical['sku'] ?? product.external_id ?? '',
      title: edited?.title ?? generated.title ?? '',
      shortDescription: edited?.shortDescription ?? generated.shortDescription ?? '',
      longDescription: edited?.longDescription ?? generated.longDescription ?? '',
      bullets: edited?.bullets ?? generated.bullets ?? [],
      metaDescription: edited?.metaDescription ?? generated.metaDescription ?? '',
      altText: edited?.altText ?? generated.altText ?? '',
      faq: edited?.faq ?? generated.faq ?? [],
      brand: canonical['brand'] ?? '',
      category: product.category ?? canonical['category'] ?? '',
    });
  }

  // Export verso una piattaforma e-commerce (Shopify/Woo/Presta): CSV con le
  // colonne attese dall'importer nativo.
  if (isPlatform(format)) {
    const pe = buildPlatformExport(format, items);
    const csv = stringify(pe.rows, { header: true, columns: pe.columns, bom: true });
    return {
      buffer: Buffer.from(csv, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      rowCount: pe.rows.length,
      extension: 'csv',
    };
  }

  const langCols = [...usedLangs].sort().flatMap((lang) => [
    `title_${lang}`,
    `short_description_${lang}`,
    `long_description_${lang}`,
    `bullets_${lang}`,
    `meta_description_${lang}`,
    `alt_text_${lang}`,
    `faq_${lang}`,
  ]);
  // Colonne base: elimina le colonne-fatto FISSE (color, composition, material,
  // fit, category, brand) che restano VUOTE su tutto il batch — così un export
  // Food non mostra colonne moda (colore/taglia) senza valori.
  const baseColSet = new Set(exportColumns(EXTRA_FACT_COLUMNS));
  const extraFactSet = new Set(EXTRA_FACT_COLUMNS);
  const nonEmpty = (col: string) => rows.some((r) => (r[col] ?? '').trim() !== '');
  const baseCols = exportColumns(EXTRA_FACT_COLUMNS).filter(
    (c) => !extraFactSet.has(c) || nonEmpty(c),
  );
  // Colonne attributi di categoria: unione ordinata, escluse quelle già presenti
  // tra le colonne base (evita doppioni tipo marca/categoria).
  const factCols = [...factColumnSet].filter((c) => !baseColSet.has(c)).sort();
  const columns = [
    ...baseCols,
    ...(hasParents ? ['codice_padre'] : []),
    ...factCols,
    ...langCols,
  ];

  if (format === 'csv') {
    const csv = stringify(rows, { header: true, columns, bom: true });
    return {
      buffer: Buffer.from(csv, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      rowCount: rows.length,
      extension: 'csv',
    };
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Schede');
  ws.columns = columns.map((c) => ({ header: c, key: c }));
  for (const row of rows) ws.addRow(row);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rowCount: rows.length,
    extension: 'xlsx',
  };
}

// helper riesportato per comodità
export type { Json };
