'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Download, Trash2, Loader2 } from 'lucide-react';
import { deleteBatchAction } from '@/lib/actions/batches';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/settings/modal';
import { formatDate } from '@/lib/utils';

export interface RecentBatch {
  id: string;
  name: string;
  status: string;
  total: number;
  processed: number;
  createdAt: string;
  href: string;
  isCompleted: boolean;
}

export function RecentBatchCard({ batch }: { batch: RecentBatch }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pct = batch.total > 0 ? Math.round((batch.processed / batch.total) * 100) : 0;

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteBatchAction({ batchId: batch.id });
      if (!res.ok) {
        setError(res.error ?? 'Errore');
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-gray-900">{batch.name}</h3>
            <StatusBadge status={batch.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span>{batch.total} prodotti</span>
            {batch.total > 0 && (
              <span>
                {batch.processed}/{batch.total} elaborati ({pct}%)
              </span>
            )}
            <span>Creato il {formatDate(batch.createdAt)}</span>
          </div>
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {batch.isCompleted && (
            <Link href={`/app/batches/${batch.id}/results`}>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                Esporta
              </Button>
            </Link>
          )}
          <Link href={batch.href}>
            <Button variant="secondary" size="sm">
              Apri
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              setConfirmOpen(true);
            }}
            aria-label={`Elimina batch ${batch.name}`}
            title="Elimina batch"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        title="Eliminare il batch?"
        message={`Verrà eliminato "${batch.name}" con tutti i prodotti, le schede generate e i dati collegati. L'operazione è irreversibile.`}
        confirmLabel={pending ? 'Elimino…' : 'Elimina'}
        busy={pending}
        onConfirm={doDelete}
      />
      {pending && (
        <span className="sr-only">
          <Loader2 className="animate-spin" />
        </span>
      )}
    </Card>
  );
}
