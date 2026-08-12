import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { batchDiPagina } from '@/lib/batch-page';
import { PageShell } from '@/components/page-shell';
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
  // Prima di tutto: il batch esiste ed è tuo? Zero prodotti di un batch
  // inesistente e zero prodotti di un batch vuoto sono la stessa risposta.
  const batch = await batchDiPagina(batchId);
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from('products')
    .select(
      'id, external_id, name, product_type, canonical_attributes_json, data_quality_score, verification_status',
    )
    .eq('batch_id', batchId)
    // Un secondo criterio dopo la data: un import inserisce tutte le righe
    // nello stesso istante, e a parità di timestamp Postgres non promette
    // nessun ordine. Con l'elenco paginato vorrebbe dire vedere una scheda
    // su due pagine, o su nessuna, ricaricando.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

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
    <PageShell
      title="Revisione dei dati"
      subtitle={`${batch.name} — controlla i prodotti importati prima di generare le schede.`}
      actions={
        <Link href={`/app/batches/${batchId}/sample`}>
          <Button>
            Configura tono e campione
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      }
    >
      <ImportIssuesBanner batchId={batchId} issues={importIssues} />

      <InferredAttributesSection
        batchId={batchId}
        hasImages={hasImages}
        initialProducts={inferredProducts}
      />

      <InputTable products={rows} />
    </PageShell>
  );
}
