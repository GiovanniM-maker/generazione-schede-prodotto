'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import type { ImportIssues } from '@/lib/import-issues';

// Card riepilogo "Problemi di importazione". Sola lettura (dismissible-looking):
// l'utente può chiuderla ma la risoluzione dei conflitti arriverà più avanti.
export function ImportIssuesBanner({
  batchId,
  issues,
}: {
  batchId: string;
  issues: ImportIssues;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (issues.total <= 0 || dismissed) return null;

  const lines: { label: string; count: number }[] = [
    { label: 'Righe/file senza SKU', count: issues.missingSku },
    { label: 'SKU duplicati', count: issues.duplicateFile },
    { label: 'Immagini non associate', count: issues.unmatched },
    { label: 'File vuoti', count: issues.emptyFile },
    { label: 'Formati non supportati', count: issues.unsupportedFormat },
    { label: 'Prodotti esclusi', count: issues.excludedProducts },
  ].filter((l) => l.count > 0);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">Problemi di importazione</p>
            <p className="mt-0.5 text-amber-800">
              Alcune righe o file non sono stati importati correttamente.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Nascondi"
          className="rounded p-1 text-amber-700 hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {lines.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span className="inline-flex min-w-[1.5rem] justify-center rounded-full bg-amber-200 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
              {l.count}
            </span>
            <span>{l.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <Link
          href={`/app/batches/${batchId}/results`}
          className="font-medium text-amber-900 underline underline-offset-2"
        >
          Rivedi i dettagli nei risultati
        </Link>
      </div>
    </div>
  );
}
