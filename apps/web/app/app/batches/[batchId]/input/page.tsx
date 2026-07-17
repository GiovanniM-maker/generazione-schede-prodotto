import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { InputTable, type InputProduct } from '@/components/input-table';

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

      <InputTable products={rows} />
    </div>
  );
}
