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
    .select('id, external_id, name, category, canonical_attributes_json')
    .eq('batch_id', batchId);

  const rows: Array<Record<string, string>> = [];
  const items: ExportItem[] = [];
  const usedLangs = new Set<string>();
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
  const columns = [...exportColumns(EXTRA_FACT_COLUMNS), ...langCols];

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
