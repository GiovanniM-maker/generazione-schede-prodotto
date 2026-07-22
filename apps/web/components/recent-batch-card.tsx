'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Download, Trash2, Loader2, Sparkles } from 'lucide-react';
import { deleteBatchAction } from '@/lib/actions/batches';
import { getBatchProgressAction } from '@/lib/actions/ui';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/settings/modal';
import { formatDate } from '@/lib/utils';

const IN_PROGRESS = new Set(['queued', 'processing']);

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
  const [removed, setRemoved] = useState(false);

  // Stato live: i batch in corso si aggiornano da soli sulla home (generazione
  // in background via cron), con barra animata. Al termine si ricarica la pagina.
  const [live, setLive] = useState({ status: batch.status, processed: batch.processed, total: batch.total });
  const inProgress = IN_PROGRESS.has(live.status);

  useEffect(() => {
    if (!IN_PROGRESS.has(batch.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await getBatchProgressAction(batch.id);
      if (!active) return;
      if (res.ok) {
        setLive({ status: res.progress.status, processed: res.progress.processed, total: res.progress.total });
        if (!IN_PROGRESS.has(res.progress.status)) {
          router.refresh(); // completato/fallito: aggiorna la card (mostra Esporta)
          return;
        }
      }
      timer = setTimeout(tick, 3500);
    };
    timer = setTimeout(tick, 3500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [batch.id, batch.status, router]);

  const total = live.total || batch.total;
  const processed = live.processed;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  function doDelete() {
    setError(null);
    // Ottimistico: nascondi subito la card, chiudi il dialog. Se il server
    // rifiuta, la ripristiniamo con il messaggio d'errore.
    setConfirmOpen(false);
    setRemoved(true);
    startTransition(async () => {
      const res = await deleteBatchAction({ batchId: batch.id });
      if (!res.ok) {
        setRemoved(false);
        setError(res.error ?? 'Errore');
        return;
      }
      router.refresh();
    });
  }

  if (removed) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-gray-900">{batch.name}</h3>
            <StatusBadge status={live.status} />
            {inProgress && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-accent">
                <Sparkles className="h-3 w-3 animate-pulse" />
                in corso
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span>{total} prodotti</span>
            {total > 0 && (
              <span>
                {processed}/{total} elaborati ({pct}%)
              </span>
            )}
            <span>Creato il {formatDate(batch.createdAt)}</span>
          </div>
          {inProgress && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-soft">
              <div
                className="h-full rounded-full bg-brand-accent transition-all duration-700"
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </div>
          )}
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
