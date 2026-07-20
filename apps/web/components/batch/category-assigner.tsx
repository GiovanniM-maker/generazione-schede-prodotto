'use client';

import { useEffect, useState } from 'react';
import { Loader2, FolderTree } from 'lucide-react';
import {
  getBatchProductsV2,
  getBatchCategoryOptions,
  setProductsCategoryAction,
  type BatchProductRow,
} from '@/lib/actions/batch-wizard';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

// Mappatura manuale delle categorie per SKU: utile per i batch di sole foto,
// quando l'utente preferisce assegnare le categorie a mano invece di dedurle.
export function CategoryAssigner({ batchId }: { batchId: string }) {
  const [products, setProducts] = useState<BatchProductRow[] | null>(null);
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getBatchProductsV2({ batchId }), getBatchCategoryOptions({ batchId })]).then(
      ([p, c]) => {
        if (!active) return;
        if (p.ok) setProducts(p.data.products);
        if (c.ok) setCats(c.data.categories);
      },
    );
    return () => {
      active = false;
    };
  }, [batchId]);

  const catIdByName = new Map(cats.map((c) => [c.name, c.id] as const));
  const withoutCategory = (products ?? []).filter((p) => !p.category).length;

  async function assignOne(productId: string, categoryId: string) {
    setBusyId(productId);
    setError(null);
    const res = await setProductsCategoryAction({
      batchId,
      productIds: [productId],
      categoryId: categoryId || null,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const name = cats.find((c) => c.id === categoryId)?.name ?? null;
    setProducts((prev) =>
      (prev ?? []).map((p) => (p.id === productId ? { ...p, category: name } : p)),
    );
  }

  async function assignBulk() {
    if (!bulk) return;
    const targets = (products ?? []).filter((p) => !p.category).map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setError(null);
    const res = await setProductsCategoryAction({ batchId, productIds: targets, categoryId: bulk });
    setBulkBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const name = cats.find((c) => c.id === bulk)?.name ?? null;
    setProducts((prev) =>
      (prev ?? []).map((p) => (targets.includes(p.id) ? { ...p, category: name } : p)),
    );
    setBulk('');
  }

  if (products !== null && cats.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <FolderTree className="h-4 w-4 text-brand-accent" />
          Assegna le categorie a mano
          {withoutCategory > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              {withoutCategory} senza categoria
            </span>
          )}
        </span>
        <span className="text-xs text-gray-400">{open ? 'nascondi' : 'apri'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4">
          {products === null ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Carico i prodotti…
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-gray-500">
                Utile per i batch di sole foto: assegna la categoria per SKU. La categoria decide gli
                attributi usati in generazione (poi puoi rigenerare le schede).
              </p>

              {/* Bulk sui senza categoria */}
              {withoutCategory > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2">
                  <span className="text-xs text-gray-600">
                    Assegna a tutti i {withoutCategory} senza categoria:
                  </span>
                  <Select value={bulk} onChange={(e) => setBulk(e.target.value)} className="max-w-[220px]">
                    <option value="">— scegli categoria —</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" onClick={assignBulk} disabled={!bulk || bulkBusy}>
                    {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Applica'}
                  </Button>
                </div>
              )}

              {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

              <div className="max-h-[46vh] space-y-1.5 overflow-y-auto">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="grid grid-cols-1 items-center gap-2 rounded-md border border-gray-100 p-2 sm:grid-cols-[1fr_1.2fr]"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-gray-600">{p.sku ?? '—'}</span>
                      <span className="ml-2 truncate text-sm text-gray-800">{p.name ?? ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={p.category ? (catIdByName.get(p.category) ?? '') : ''}
                        onChange={(e) => assignOne(p.id, e.target.value)}
                        disabled={busyId === p.id}
                      >
                        <option value="">— nessuna (dedotta dall’AI) —</option>
                        {cats.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                      {busyId === p.id && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
