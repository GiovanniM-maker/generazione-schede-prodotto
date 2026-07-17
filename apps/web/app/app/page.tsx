import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, PackageOpen, ArrowRight, Download } from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { getCreditBalance } from '@/lib/credits';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';

export const dynamic = 'force-dynamic';

interface BatchRow {
  id: string;
  name: string;
  status: string;
  total_products: number | null;
  processed_products: number | null;
  created_at: string;
}

function batchHref(id: string, status: string): string {
  switch (status) {
    case 'mapping':
      return `/app/batches/${id}/mapping`;
    case 'input_review':
      return `/app/batches/${id}/input`;
    case 'tone_setup':
    case 'sample_pending':
    case 'sample_ready':
      return `/app/batches/${id}/sample`;
    case 'approved':
    case 'queued':
    case 'processing':
      return `/app/batches/${id}/processing`;
    case 'completed':
    case 'partial_failed':
    case 'failed':
      return `/app/batches/${id}/results`;
    default:
      return `/app/batches/${id}/input`;
  }
}

export default async function DashboardPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  const credits = await getCreditBalance(org.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('batches')
    .select('id, name, status, total_products, processed_products, created_at')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .limit(10);

  const batches = (data ?? []) as BatchRow[];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            I tuoi batch
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Hai {credits} crediti disponibili.
          </p>
        </div>
        <Link href="/app/batches/new">
          <Button size="lg">
            <Plus className="h-4 w-4" />
            Nuovo batch
          </Button>
        </Link>
      </div>

      {batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
              <PackageOpen className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Nessun batch ancora
              </h2>
              <p className="mt-1 max-w-sm text-sm text-gray-500">
                Crea il tuo primo batch caricando un file CSV o Excel con il tuo
                catalogo.
              </p>
            </div>
            <Link href="/app/batches/new">
              <Button>
                <Plus className="h-4 w-4" />
                Crea il primo batch
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {batches.map((b) => {
            const total = b.total_products ?? 0;
            const processed = b.processed_products ?? 0;
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
            const isCompleted =
              b.status === 'completed' || b.status === 'partial_failed';
            return (
              <Card key={b.id}>
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-gray-900">
                        {b.name}
                      </h3>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                      <span>{total} prodotti</span>
                      {total > 0 && (
                        <span>
                          {processed}/{total} elaborati ({pct}%)
                        </span>
                      )}
                      <span>Creato il {formatDate(b.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isCompleted && (
                      <Link href={`/app/batches/${b.id}/results`}>
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4" />
                          Esporta
                        </Button>
                      </Link>
                    )}
                    <Link href={batchHref(b.id, b.status)}>
                      <Button variant="secondary" size="sm">
                        Apri
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
