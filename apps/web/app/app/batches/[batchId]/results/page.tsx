import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ResultsTable, type ResultRow, type GenContent } from '@/components/results-table';
import { ImportIssuesBanner } from '@/components/import-issues-banner';
import { ReanalyzeButton } from '@/components/reanalyze-button';
import { computeImportIssues } from '@/lib/import-issues';
import { normalizeCompleteness } from '@/lib/completeness';

export const dynamic = 'force-dynamic';

interface GenRow {
  product_id: string;
  generated_content_json: unknown;
  edited_content_json: unknown;
  completeness_json: unknown;
  translations_json: unknown;
  status: string;
  created_at: string;
}

function asContent(v: unknown): GenContent {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    title: typeof o.title === 'string' ? o.title : '',
    shortDescription:
      typeof o.shortDescription === 'string' ? o.shortDescription : '',
    longDescription:
      typeof o.longDescription === 'string' ? o.longDescription : '',
    bullets: Array.isArray(o.bullets)
      ? o.bullets.filter((b): b is string => typeof b === 'string')
      : [],
    metaDescription:
      typeof o.metaDescription === 'string' ? o.metaDescription : '',
    faq: Array.isArray(o.faq)
      ? o.faq
          .filter(
            (f): f is { question: string; answer: string } =>
              !!f &&
              typeof (f as { question?: unknown }).question === 'string' &&
              typeof (f as { answer?: unknown }).answer === 'string',
          )
          .map((f) => ({ question: f.question, answer: f.answer }))
      : [],
    altText: typeof o.altText === 'string' ? o.altText : '',
    warnings: Array.isArray(o.warnings)
      ? o.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  };
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireUser();
  const { batchId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: products } = await supabase
    .from('products')
    .select('id, external_id, name, category, verification_status')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  const productIds = (products ?? []).map((p) => p.id);

  const { data: generations } = productIds.length
    ? await supabase
        .from('product_generations')
        .select(
          'product_id, generated_content_json, edited_content_json, completeness_json, translations_json, status, created_at',
        )
        .in('product_id', productIds)
        .order('created_at', { ascending: false })
    : { data: [] as GenRow[] };

  // Ultima generazione per prodotto (già ordinate per data desc).
  const latestByProduct = new Map<string, GenRow>();
  for (const g of (generations ?? []) as GenRow[]) {
    if (g.product_id && !latestByProduct.has(g.product_id)) {
      latestByProduct.set(g.product_id, g);
    }
  }

  const { data: jobs } = await supabase
    .from('job_items')
    .select('product_id, status, created_at')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false });

  const jobStatusByProduct = new Map<string, string>();
  for (const j of jobs ?? []) {
    if (j.product_id && !jobStatusByProduct.has(j.product_id)) {
      jobStatusByProduct.set(j.product_id, j.status ?? '');
    }
  }

  // Immagine principale di ogni prodotto, per la vista in lettura: rivedere una
  // scheda guardando la foto del pack e' molto piu' vicino a "come apparira'"
  // che leggere solo il testo. Una sola query per il batch, poi gli URL firmati
  // in blocco: sono file privati, non si possono servire per percorso.
  const immaginePerProdotto = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: collegamenti } = await supabase
      .from('product_source_links')
      .select('product_id, source_item_id')
      .in('product_id', productIds);

    const itemIds = [...new Set((collegamenti ?? []).map((l) => l.source_item_id))].filter(
      (v): v is string => Boolean(v),
    );
    if (itemIds.length > 0) {
      const { data: items } = await supabase
        .from('source_items')
        .select('id, source_file_id, mime_type, filename')
        .in('id', itemIds);
      const fileIds = [...new Set((items ?? []).map((i) => i.source_file_id))].filter(
        (v): v is string => Boolean(v),
      );
      const { data: files } = fileIds.length
        ? await supabase
            .from('source_files')
            .select('id, storage_bucket, storage_path')
            .in('id', fileIds)
        : { data: [] as Array<{ id: string; storage_bucket: string; storage_path: string }> };

      const fileById = new Map((files ?? []).map((f) => [f.id, f]));
      // Un prodotto puo' avere piu' foto: in lettura ne basta una, la prima.
      const primoItemPerProdotto = new Map<string, string>();
      for (const l of collegamenti ?? []) {
        if (l.product_id && l.source_item_id && !primoItemPerProdotto.has(l.product_id)) {
          primoItemPerProdotto.set(l.product_id, l.source_item_id);
        }
      }
      const itemById = new Map((items ?? []).map((i) => [i.id, i]));
      const daFirmare: Array<{ productId: string; bucket: string; path: string }> = [];
      for (const [productId, itemId] of primoItemPerProdotto) {
        const item = itemById.get(itemId);
        const file = item?.source_file_id ? fileById.get(item.source_file_id) : null;
        if (file?.storage_bucket && file.storage_path) {
          daFirmare.push({ productId, bucket: file.storage_bucket, path: file.storage_path });
        }
      }
      // Un URL firmato per bucket, tutti insieme.
      const perBucket = new Map<string, typeof daFirmare>();
      for (const f of daFirmare) {
        const arr = perBucket.get(f.bucket) ?? [];
        arr.push(f);
        perBucket.set(f.bucket, arr);
      }
      for (const [bucket, elenco] of perBucket) {
        const { data: firmati } = await supabase.storage
          .from(bucket)
          .createSignedUrls(elenco.map((e) => e.path), 3600);
        (firmati ?? []).forEach((f, i) => {
          const voce = elenco[i];
          if (voce && f?.signedUrl && !f.error) immaginePerProdotto.set(voce.productId, f.signedUrl);
        });
      }
    }
  }

  const rows: ResultRow[] = (products ?? []).map((p) => {
    const latest = latestByProduct.get(p.id);
    const generated = latest ? asContent(latest.generated_content_json) : null;
    const editedRaw = latest?.edited_content_json ?? null;
    const hasEdited = Boolean(
      editedRaw && Object.keys(editedRaw as object).length > 0,
    );
    const edited = hasEdited ? asContent(editedRaw) : null;

    return {
      id: p.id,
      externalId: p.external_id ?? '—',
      name: p.name ?? '—',
      category: p.category ?? null,
      status: latest?.status ?? 'pending',
      jobFailed: jobStatusByProduct.get(p.id) === 'failed',
      hasEdited,
      generated,
      edited,
      completeness: normalizeCompleteness(latest?.completeness_json ?? null),
      translations: (latest?.translations_json ?? {}) as ResultRow['translations'],
      imageUrl: immaginePerProdotto.get(p.id) ?? null,
    };
  });

  // Preset del batch: serve per l'apprendimento del prompt dalle correzioni.
  let presetId: string | null = null;
  const { data: batchRow } = await supabase
    .from('batches')
    .select('preset_version_id')
    .eq('id', batchId)
    .maybeSingle();
  if (batchRow?.preset_version_id) {
    const { data: pv } = await supabase
      .from('preset_versions')
      .select('preset_id')
      .eq('id', batchRow.preset_version_id)
      .maybeSingle();
    presetId = pv?.preset_id ?? null;
  }

  const importIssues = await computeImportIssues(supabase, batchId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Risultati</h1>
          <p className="mt-1 text-sm text-gray-500">
            Rivedi, modifica e approva le schede generate, poi esporta il
            catalogo.
          </p>
        </div>
        <ReanalyzeButton batchId={batchId} />
      </div>
      <ImportIssuesBanner batchId={batchId} issues={importIssues} />
      <ResultsTable batchId={batchId} presetId={presetId} rows={rows} />
    </div>
  );
}
