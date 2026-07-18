import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ResultsTable, type ResultRow, type GenContent } from '@/components/results-table';
import { ImportIssuesBanner } from '@/components/import-issues-banner';
import { computeImportIssues } from '@/lib/import-issues';
import { normalizeCompleteness } from '@/lib/completeness';

export const dynamic = 'force-dynamic';

interface GenRow {
  product_id: string;
  generated_content_json: unknown;
  edited_content_json: unknown;
  completeness_json: unknown;
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
    .select('id, external_id, name, verification_status')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  const productIds = (products ?? []).map((p) => p.id);

  const { data: generations } = productIds.length
    ? await supabase
        .from('product_generations')
        .select(
          'product_id, generated_content_json, edited_content_json, completeness_json, status, created_at',
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
      status: latest?.status ?? 'pending',
      jobFailed: jobStatusByProduct.get(p.id) === 'failed',
      hasEdited,
      generated,
      edited,
      completeness: normalizeCompleteness(latest?.completeness_json ?? null),
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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Risultati</h1>
        <p className="mt-1 text-sm text-gray-500">
          Rivedi, modifica e approva le schede generate, poi esporta il
          catalogo.
        </p>
      </div>
      <ImportIssuesBanner batchId={batchId} issues={importIssues} />
      <ResultsTable batchId={batchId} presetId={presetId} rows={rows} />
    </div>
  );
}
