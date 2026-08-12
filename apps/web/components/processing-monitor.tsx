'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, ArrowRight, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { getBatchProgressAction, type BatchProgress } from '@/lib/actions/ui';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { Avviso } from '@/components/ui/avviso';
import { esitoElaborazione, STATI_FINALI as DONE } from '@/lib/esito-elaborazione';

export function ProcessingMonitor({ batchId }: { batchId: string }) {
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await getBatchProgressAction(batchId);
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      setProgress(res.progress);
      setError(null);
      return res.progress.status;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore di aggiornamento');
      return null;
    }
  }, [batchId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const status = await poll();
      if (!active) return;
      if (status && DONE.has(status)) return;
      timer = setTimeout(tick, 3000);
    };
    void tick();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [poll]);

  // Motore di elaborazione lato serverless: finché la pagina è aperta, drena la
  // coda (fa il lavoro del worker). Ogni chiamata elabora fino a esaurire i job o
  // il tempo massimo, poi ricomincia finché la coda non è vuota.
  useEffect(() => {
    let active = true;
    async function drainLoop() {
      while (active) {
        let empty = false;
        try {
          const r = await fetch('/api/cron/drain', { method: 'POST' });
          const body = (await r.json().catch(() => ({}))) as { empty?: boolean };
          empty = body.empty === true;
        } catch {
          /* riprova dopo la pausa */
        }
        if (!active || empty) return;
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
    void drainLoop();
    return () => {
      active = false;
    };
  }, [batchId]);

  const total = progress?.total ?? 0;
  const processed = progress?.processed ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  // «Concluso» non vuol dire «riuscito»: la regola sta in `lib/esito-elaborazione`.
  const esito = esitoElaborazione(progress?.status, progress?.failed ?? 0);
  const finished = esito.finita;
  const fallito = esito.esito === 'fallita';

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {esito.esito === 'in-corso' ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-accent" />
              ) : esito.esito === 'fallita' ? (
                <XCircle className="h-5 w-5 shrink-0 text-red-600" />
              ) : esito.esito === 'con-errori' ? (
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              )}
              <span className="font-medium text-gray-900">{esito.titolo}</span>
            </div>
            <StatusBadge status={progress?.status} />
          </div>

          {/* Barra di progresso */}
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-sm text-gray-500">
              <span>
                {processed} / {total} prodotti
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-brand-accent transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Contatori */}
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <Stat label="Elaborati" value={processed} />
            <Stat
              label="Da verificare"
              value={progress?.needsReview ?? 0}
              tone="amber"
            />
            <Stat label="Falliti" value={progress?.failed ?? 0} tone="red" />
          </div>

          {/* Motivo del fallimento, chiaro e azionabile.
              La condizione chiedeva `failed > 0`: proprio nel caso peggiore —
              il batch fermato in blocco, con i contatori a zero — la
              spiegazione non compariva. */}
          {progress?.topError && (fallito || (progress?.failed ?? 0) > 0) && (
            <Avviso tono="errore" className="mt-5">{progress.topError}</Avviso>
          )}
        </CardContent>
      </Card>

      {!finished && (
        <p className="text-center text-sm text-gray-500">
          Aggiornamento automatico ogni 3 secondi.
        </p>
      )}

      {error && (
        <Avviso tono="attenzione">{error}</Avviso>
      )}

      {/* Le vie d'uscita.
          Prima ce n'era una sola, e solo a lavoro finito: durante
          l'elaborazione questa pagina non aveva NESSUN collegamento — né al
          batch, né all'elenco. Chi ci arrivava per sbaglio, o chi voleva
          controllare un altro lavoro mentre questo girava, aveva solo il tasto
          indietro. Ora l'uscita c'è sempre; l'azione principale cambia con
          l'esito, perché mandare ai risultati un batch fallito significa
          mandare a una pagina vuota. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {finished && !fallito && (
          <Link href={`/app/batches/${batchId}/results`}>
            <Button size="lg">
              Vai ai risultati
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
        {fallito && (
          <Link href={`/app/batches/${batchId}/sample`}>
            <Button size="lg">
              Riparti dal campione
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
        <Link href="/app/batches">
          <Button variant="outline" size={finished ? 'lg' : 'md'}>
            Tutti i lavori
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value: number;
  tone?: 'gray' | 'amber' | 'red';
}) {
  const color =
    tone === 'amber'
      ? 'text-amber-600'
      : tone === 'red'
        ? 'text-red-600'
        : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );
}
