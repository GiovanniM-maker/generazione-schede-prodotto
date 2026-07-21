'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Camera } from 'lucide-react';
import { getBatchImageQcAction, type ImageQcResult } from '@/lib/actions/image-qc';

/** Controllo Qualità immagini: avvisi SOFT (non blocca la generazione). */
export function ImageQcPanel({ batchId, reloadKey }: { batchId: string; reloadKey?: number }) {
  const [qc, setQc] = useState<ImageQcResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getBatchImageQcAction({ batchId })
      .then((res) => {
        if (active && res.ok) setQc(res.data);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [batchId, reloadKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Controllo qualità foto…
      </div>
    );
  }
  if (!qc || qc.total === 0) return null;

  if (qc.warnCount === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Foto ok: nessun problema di qualità rilevato ({qc.total}).
      </div>
    );
  }

  const warned = qc.items.filter((i) => i.level === 'warn');
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
        <Camera className="h-4 w-4" />
        Qualità foto: {qc.warnCount} prodotti con avvisi (su {qc.total})
      </p>
      <p className="mt-0.5 text-xs text-amber-700">
        Solo avvisi: puoi generare comunque, ma le schede potrebbero essere meno complete.
      </p>
      <ul className="mt-2 space-y-1.5">
        {warned.slice(0, 12).map((it) => (
          <li key={it.productId} className="text-xs text-amber-900">
            <span className="inline-flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3 w-3" />
              {it.sku ?? it.name ?? 'Prodotto'}
            </span>
            : {it.issues.join(' · ')}
            {it.suggestions.length > 0 && (
              <span className="block pl-4 text-amber-700">→ {it.suggestions.join(' ')}</span>
            )}
          </li>
        ))}
        {warned.length > 12 && (
          <li className="text-xs text-amber-700">…e altri {warned.length - 12} prodotti.</li>
        )}
      </ul>
    </div>
  );
}
