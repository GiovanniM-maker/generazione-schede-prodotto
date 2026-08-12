import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PackageOpen, Plus } from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fettaDiPagina } from '@/lib/paginazione';
import { batchHref } from '@/lib/batch-href';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RecentBatchCard } from '@/components/recent-batch-card';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Tutti i lavori.
//
// La dashboard si fermava a dieci, e non lo diceva: dal decimo in giù il lavoro
// spariva, e l'unico modo di ritrovarlo era ricordarsi l'indirizzo. Per chi
// genera cataloghi a ritmo, dieci sono due settimane.
//
// Venticinque per pagina: l'elenco si legge, e il conto in alto dice sempre
// quanti sono in tutto — così «non lo trovo» si distingue da «non c'è più».
// ---------------------------------------------------------------------------

const PER_PAGINA = 25;

interface BatchRow {
  id: string;
  name: string;
  status: string;
  total_products: number | null;
  processed_products: number | null;
  created_at: string;
}

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');
  const { p } = await searchParams;
  const chiesta = Math.max(0, (Number(p) || 1) - 1);

  const supabase = await createSupabaseServerClient();
  // Il totale arriva con la stessa richiesta: non serve una seconda lettura per
  // sapere quante pagine ci sono.
  const { data, count } = await supabase
    .from('batches')
    .select('id, name, status, total_products, processed_products, created_at', {
      count: 'exact',
    })
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(chiesta * PER_PAGINA, chiesta * PER_PAGINA + PER_PAGINA - 1);

  const totale = count ?? 0;
  const fetta = fettaDiPagina(totale, PER_PAGINA, chiesta);
  const batches = (data ?? []) as BatchRow[];

  return (
    <PageShell
      title="Tutti i lavori"
      subtitle={totale === 1 ? '1 batch' : `${totale} batch`}
      actions={
        <Link href="/app/batches/new">
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuovo batch
          </Button>
        </Link>
      }
    >
      {batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
              <PackageOpen className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="max-w-sm text-sm text-gray-500">
              {chiesta > 0
                ? 'Questa pagina è vuota: probabilmente l’elenco si è accorciato.'
                : 'Non c’è ancora nessun batch.'}
            </p>
            {chiesta > 0 && (
              <Link href="/app/batches">
                <Button variant="outline">Torna alla prima pagina</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
            {/* `grid-cols-1` e non solo `grid`: una traccia `auto` si
                dimensiona sul contenuto più largo, e basta il nome di un
                batch per allargare la pagina. `grid-cols-1` è
                `minmax(0,1fr)`: la traccia non supera mai il contenitore. */}
          {batches.map((b) => (
            <RecentBatchCard
              key={b.id}
              isOwner={org.role === 'owner'}
              batch={{
                id: b.id,
                name: b.name,
                status: b.status,
                total: b.total_products ?? 0,
                processed: b.processed_products ?? 0,
                createdAt: b.created_at,
                href: batchHref(b.id, b.status),
                isCompleted: b.status === 'completed' || b.status === 'partial_failed',
              }}
            />
          ))}
        </div>
      )}

      {fetta.pagine > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            {fetta.primo}–{fetta.ultimo} di {totale}
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={`/app/batches?p=${fetta.pagina}`}
              aria-disabled={fetta.pagina === 0}
              className={fetta.pagina === 0 ? 'pointer-events-none opacity-40' : ''}
            >
              <Button variant="outline" size="sm">
                Precedenti
              </Button>
            </Link>
            <span className="text-sm tabular-nums text-gray-600">
              {fetta.pagina + 1} / {fetta.pagine}
            </span>
            <Link
              href={`/app/batches?p=${fetta.pagina + 2}`}
              aria-disabled={fetta.pagina >= fetta.pagine - 1}
              className={
                fetta.pagina >= fetta.pagine - 1 ? 'pointer-events-none opacity-40' : ''
              }
            >
              <Button variant="outline" size="sm">
                Successive
              </Button>
            </Link>
          </div>
        </div>
      )}
    </PageShell>
  );
}
