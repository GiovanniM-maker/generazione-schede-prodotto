'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, Check, X, Info } from 'lucide-react';
import {
  runVisualExtractionForBatch,
  confirmAttributeValue,
  rejectAttributeValue,
  type InferredProductGroup,
} from '@/lib/actions/visual';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Sezione "Attributi suggeriti dalle immagini (da confermare)".
// I suggerimenti visivi NON sono fatti: diventano utilizzabili solo se
// l'utente li conferma. Materiali, composizione e dati tecnici non sono
// deducibili dalle immagini.
// ---------------------------------------------------------------------------

export function InferredAttributesSection({
  batchId,
  hasImages,
  initialProducts,
}: {
  batchId: string;
  hasImages: boolean;
  initialProducts: InferredProductGroup[];
}) {
  const router = useRouter();
  const [products, setProducts] = useState<InferredProductGroup[]>(initialProducts);
  const [analyzing, setAnalyzing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Niente immagini e nessun suggerimento: sezione nascosta.
  if (!hasImages && products.length === 0) return null;

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await runVisualExtractionForBatch({ batchId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        `${res.data.productsProcessed} prodotti analizzati, ${res.data.attributesSuggested} attributi suggeriti. Conferma i suggerimenti per usarli come fatti.`,
      );
      router.refresh();
    } catch {
      setError("Analisi immagini non riuscita. Riprova.");
    } finally {
      setAnalyzing(false);
    }
  }

  function removeValue(valueId: string) {
    setProducts((prev) =>
      prev
        .map((p) => ({ ...p, attributes: p.attributes.filter((a) => a.id !== valueId) }))
        .filter((p) => p.attributes.length > 0),
    );
  }

  async function confirm(valueId: string) {
    setBusyId(valueId);
    setError(null);
    try {
      const res = await confirmAttributeValue({ productAttributeValueId: valueId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      removeValue(valueId);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(valueId: string) {
    setBusyId(valueId);
    setError(null);
    try {
      const res = await rejectAttributeValue({ id: valueId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      removeValue(valueId);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Attributi suggeriti dalle immagini (da confermare)
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-500">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>
                Suggerimenti visivi: verranno usati come fatti solo se li confermi. Materiali,
                composizione e dati tecnici non sono deducibili dalle immagini.
              </span>
            </p>
          </div>
          {hasImages && (
            <Button onClick={analyze} disabled={analyzing} className="shrink-0">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analizza immagini
            </Button>
          )}
        </div>

        {message && (
          <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</p>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {products.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nessun suggerimento visivo. Avvia l&apos;analisi delle immagini per generare proposte da
            confermare.
          </p>
        ) : (
          <div className="space-y-3">
            {products.map((p) => (
              <div key={p.productId} className="rounded-lg border border-gray-100 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{p.name ?? p.sku ?? '—'}</span>
                  {p.sku && <span className="text-xs text-gray-400">{p.sku}</span>}
                </div>
                <ul className="space-y-2">
                  {p.attributes.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-col gap-2 rounded-md bg-gray-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                        <span className="font-medium text-gray-900">{a.attributeName}:</span>
                        <span>{a.value}</span>
                        {a.confidence != null && (
                          <Badge tone="gray">confidenza {Math.round(a.confidence * 100)}%</Badge>
                        )}
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => confirm(a.id)}
                          disabled={busyId === a.id}
                        >
                          <Check className="h-4 w-4" />
                          Conferma
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reject(a.id)}
                          disabled={busyId === a.id}
                        >
                          <X className="h-4 w-4" />
                          Rifiuta
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
