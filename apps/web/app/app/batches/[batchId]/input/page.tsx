import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { InputTable, type InputProduct } from '@/components/input-table';
import { ImportIssuesBanner } from '@/components/import-issues-banner';
import { computeImportIssues } from '@/lib/import-issues';
import { InferredAttributesSection } from '@/components/batch/inferred-attributes';
import { listInferredAttributes } from '@/lib/actions/visual';

export const dynamic = 'force-dynamic';

const NON_FACT = new Set([
  'external_id',
  'parent_external_id',
  'sku',
  'product_name',
  'name',
  'product_type',
]);

function level(score: number): 'buono' | 'parziale' | 'insufficiente' {
  if (score >= 80) return 'buono';
  if (score >= 60) return 'parziale';
  return 'insufficiente';
}

export default async function InputPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireUser();
  const { batchId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from('products')
    .select(
      'id, external_id, name, product_type, canonical_attributes_json, data_quality_score, verification_status',
    )
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  const rows: InputProduct[] = (data ?? []).map((p) => {
    const canonical = (p.canonical_attributes_json ?? {}) as Record<
      string,
      string
    >;
    const factCount = Object.entries(canonical).filter(
      ([k, v]) => !NON_FACT.has(k) && typeof v === 'string' && v.trim() !== '',
    ).length;
    const score = Number(p.data_quality_score ?? 0);
    return {
      id: p.id,
      identifier: p.external_id ?? canonical['sku'] ?? '—',
      name: p.name ?? canonical['product_name'] ?? '—',
      type: p.product_type ?? canonical['product_type'] ?? '—',
      factCount,
      score,
      level: level(score),
      verificationStatus: p.verification_status ?? 'pending',
    };
  });

  const importIssues = await computeImportIssues(supabase, batchId);

  // Attributi suggeriti dalle immagini (inferred_visual, da confermare).
  const inferred = await listInferredAttributes({ batchId });
  const inferredProducts = inferred.ok ? inferred.data.products : [];

  // Il batch ha immagini collegate ai prodotti?
  const productIds = (data ?? []).map((p) => p.id);
  let hasImages = false;
  if (productIds.length > 0) {
    const { data: links } = await supabase
      .from('product_source_links')
      .select('source_item_id')
      .in('product_id', productIds)
      .limit(500);
    const sourceItemIds = [...new Set((links ?? []).map((l) => l.source_item_id))];
    if (sourceItemIds.length > 0) {
      const { data: items } = await supabase
        .from('source_items')
        .select('mime_type, filename')
        .in('id', sourceItemIds);
      hasImages = (items ?? []).some(
        (item) =>
          (item.mime_type?.toLowerCase().startsWith('image/') ?? false) ||
          /\.(jpe?g|png|webp)$/i.test(item.filename),
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Revisione dei dati
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Controlla i prodotti importati prima di generare le schede.
          </p>
        </div>
        <Link href={`/app/batches/${batchId}/sample`}>
          <Button size="lg">
            Configura tono e campione
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <ImportIssuesBanner batchId={batchId} issues={importIssues} />

      <InferredAttributesSection
        batchId={batchId}
        hasImages={hasImages}
        initialProducts={inferredProducts}
      />

      <InputTable products={rows} />
    </div>
  );
}
