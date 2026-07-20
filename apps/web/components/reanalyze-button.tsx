'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Ri-analizza le immagini del batch: rilegge le etichette, assegna la categoria
// mancante e ricalcola l'eleggibilità. Utile per completare categoria/attributi
// su un batch già generato senza rifare tutto a mano.
export function ReanalyzeButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/batches/${batchId}/reanalyze`, { method: 'POST' });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string;
        productsProcessed?: number;
      };
      if (!r.ok) {
        setMsg(body.error ?? 'Ri-analisi non riuscita');
        return;
      }
      setMsg(`Ri-analisi completata: ${body.productsProcessed ?? 0} prodotti riletti.`);
      router.refresh();
    } catch {
      setMsg('Errore di rete. Riprova.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
        {busy ? 'Ri-analizzo le immagini…' : 'Ri-analizza immagini'}
      </Button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
