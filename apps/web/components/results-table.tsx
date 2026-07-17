'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Search,
  Download,
  Check,
  X,
  RefreshCw,
  Pencil,
  Loader2,
  AlertCircle,
  PanelRightClose,
  PackageOpen,
} from 'lucide-react';
import {
  saveEditAction,
  acceptGenerationAction,
  rejectGenerationAction,
  regenerateProductAction,
} from '@/lib/actions/results';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  COMPLETENESS_LABELS,
  COMPLETENESS_TONES,
  type Completeness,
  type CompletenessStatus,
} from '@/lib/completeness';

export interface GenContent {
  title: string;
  shortDescription: string;
  longDescription: string;
  bullets: string[];
  metaDescription: string;
  warnings: string[];
}

export interface ResultRow {
  id: string;
  externalId: string;
  name: string;
  status: string;
  jobFailed: boolean;
  hasEdited: boolean;
  generated: GenContent | null;
  edited: GenContent | null;
  completeness: Completeness | null;
}

type Filter =
  | 'tutti'
  | 'complete'
  | 'parziali'
  | 'verifica'
  | 'insufficienti'
  | 'bloccati'
  | 'modificati'
  | 'falliti';

const TABS: { key: Filter; label: string }[] = [
  { key: 'tutti', label: 'Tutti' },
  { key: 'complete', label: 'Complete' },
  { key: 'parziali', label: 'Parziali' },
  { key: 'verifica', label: 'Da verificare' },
  { key: 'insufficienti', label: 'Insufficienti' },
  { key: 'bloccati', label: 'Bloccati' },
  { key: 'modificati', label: 'Modificati' },
  { key: 'falliti', label: 'Falliti' },
];

// Mappa una tab di completezza al relativo stato.
const COMPLETENESS_FILTER: Partial<Record<Filter, CompletenessStatus>> = {
  complete: 'complete',
  parziali: 'partial',
  verifica: 'needs_review',
  insufficienti: 'insufficient',
  bloccati: 'blocked',
};

function effective(row: ResultRow): GenContent | null {
  if (row.edited) return row.edited;
  return row.generated;
}

export function ResultsTable({
  batchId,
  rows: initialRows,
}: {
  batchId: string;
  rows: ResultRow[];
}) {
  const [rows, setRows] = useState<ResultRow[]>(initialRows);
  const [filter, setFilter] = useState<Filter>('tutti');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openRow = rows.find((r) => r.id === openId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const completenessStatus = COMPLETENESS_FILTER[filter];
      if (completenessStatus && r.completeness?.status !== completenessStatus)
        return false;
      if (filter === 'modificati' && !r.hasEdited) return false;
      if (filter === 'falliti' && !r.jobFailed && r.status !== 'failed')
        return false;
      if (q) {
        const eff = effective(r);
        const hay = `${r.name} ${r.externalId} ${eff?.title ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, query]);

  const counts = useMemo(() => {
    const byStatus = (s: CompletenessStatus) =>
      rows.filter((r) => r.completeness?.status === s).length;
    return {
      tutti: rows.length,
      complete: byStatus('complete'),
      parziali: byStatus('partial'),
      verifica: byStatus('needs_review'),
      insufficienti: byStatus('insufficient'),
      bloccati: byStatus('blocked'),
      modificati: rows.filter((r) => r.hasEdited).length,
      falliti: rows.filter((r) => r.jobFailed || r.status === 'failed').length,
    } satisfies Record<Filter, number>;
  }, [rows]);

  function patchRow(id: string, patch: Partial<ResultRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (filtered.every((r) => prev.has(r.id))) {
        const next = new Set(prev);
        filtered.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function accept(id: string) {
    startTransition(async () => {
      setError(null);
      try {
        await acceptGenerationAction(id);
        patchRow(id, { status: 'accepted' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore');
      }
    });
  }

  function reject(id: string) {
    if (!window.confirm('Rifiutare questa scheda? Potrai rigenerarla in seguito.'))
      return;
    startTransition(async () => {
      setError(null);
      try {
        await rejectGenerationAction(id);
        patchRow(id, { status: 'rejected' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore');
      }
    });
  }

  function regenerate(id: string) {
    if (
      !window.confirm(
        'Rigenerare questa scheda? Verrà consumato 1 credito.',
      )
    )
      return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await regenerateProductAction({ batchId, productId: id });
        if (!res.ok) {
          setError(
            res.error === 'INSUFFICIENT_CREDITS'
              ? 'Crediti insufficienti per la rigenerazione.'
              : (res.error ?? 'Errore'),
          );
          return;
        }
        patchRow(id, { status: 'queued' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore');
      }
    });
  }

  function acceptSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(async () => {
      setError(null);
      try {
        for (const id of ids) {
          await acceptGenerationAction(id);
          patchRow(id, { status: 'accepted' });
        }
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore');
      }
    });
  }

  async function exportBatch(format: 'csv' | 'xlsx') {
    setExporting(format);
    setError(null);
    try {
      const res = await fetch(`/api/batches/${batchId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) throw new Error('Export non riuscito');
      const body = (await res.json()) as { url?: string };
      if (body.url) window.open(body.url, '_blank');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setExporting(null);
    }
  }

  function saveEdit(id: string, content: GenContent) {
    startTransition(async () => {
      setError(null);
      try {
        await saveEditAction({
          productId: id,
          edited: {
            title: content.title,
            shortDescription: content.shortDescription,
            longDescription: content.longDescription,
            bullets: content.bullets,
            metaDescription: content.metaDescription,
          },
        });
        patchRow(id, { edited: content, hasEdited: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore');
      }
    });
  }

  const allSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      {/* Barra strumenti */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per nome, ID o titolo…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportBatch('csv')}
            disabled={exporting !== null}
          >
            {exporting === 'csv' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportBatch('xlsx')}
            disabled={exporting !== null}
          >
            {exporting === 'xlsx' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            XLSX
          </Button>
        </div>
      </div>

      {/* Tabs + azione multipla */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                filter === t.key
                  ? 'border-brand-accent bg-blue-50 text-brand-accent'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  filter === t.key
                    ? 'bg-brand-accent text-white'
                    : 'bg-gray-100 text-gray-500',
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <Button size="sm" onClick={acceptSelected} disabled={pending}>
            <Check className="h-4 w-4" />
            Accetta selezionati ({selected.size})
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <PackageOpen className="h-8 w-8 text-gray-400" />
            <p className="text-sm text-gray-500">
              Nessun risultato disponibile per questo batch.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Seleziona tutti"
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </TH>
                  <TH>ID</TH>
                  <TH>Nome</TH>
                  <TH>Titolo</TH>
                  <TH>Descrizione breve</TH>
                  <TH>Completezza</TH>
                  <TH>Stato</TH>
                  <TH className="text-right">Azioni</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const eff = effective(r);
                  return (
                    <TR key={r.id}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          aria-label={`Seleziona ${r.name}`}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </TD>
                      <TD className="font-mono text-xs text-gray-600">
                        {r.externalId}
                      </TD>
                      <TD className="font-medium text-gray-900">{r.name}</TD>
                      <TD className="max-w-[16rem] truncate text-gray-700">
                        {eff?.title || <span className="text-gray-300">—</span>}
                      </TD>
                      <TD className="max-w-[18rem] truncate text-gray-500">
                        {eff?.shortDescription || (
                          <span className="text-gray-300">—</span>
                        )}
                      </TD>
                      <TD>
                        {r.completeness ? (
                          <Badge tone={COMPLETENESS_TONES[r.completeness.status]}>
                            {COMPLETENESS_LABELS[r.completeness.status]}
                          </Badge>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge
                            status={r.jobFailed ? 'failed' : r.status}
                          />
                          {r.hasEdited && <Badge tone="violet">Modificato</Badge>}
                          {(eff?.warnings.length ?? 0) > 0 && (
                            <Badge tone="amber">
                              {eff?.warnings.length} avvisi
                            </Badge>
                          )}
                        </div>
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOpenId(r.id)}
                            aria-label="Dettaglio e modifica"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => accept(r.id)}
                            disabled={pending}
                            aria-label="Accetta"
                          >
                            <Check className="h-4 w-4 text-emerald-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => reject(r.id)}
                            disabled={pending}
                            aria-label="Rifiuta"
                          >
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => regenerate(r.id)}
                            disabled={pending}
                            aria-label="Rigenera"
                          >
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {filtered.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-gray-500">
                Nessun risultato in questa categoria.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Drawer dettaglio / modifica */}
      {openRow && (
        <DetailDrawer
          row={openRow}
          pending={pending}
          onClose={() => setOpenId(null)}
          onSave={(content) => saveEdit(openRow.id, content)}
          onAccept={() => accept(openRow.id)}
          onReject={() => reject(openRow.id)}
        />
      )}
    </div>
  );
}

function DetailDrawer({
  row,
  pending,
  onClose,
  onSave,
  onAccept,
  onReject,
}: {
  row: ResultRow;
  pending: boolean;
  onClose: () => void;
  onSave: (content: GenContent) => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const base = row.edited ?? row.generated;
  const [title, setTitle] = useState(base?.title ?? '');
  const [shortDescription, setShort] = useState(base?.shortDescription ?? '');
  const [longDescription, setLong] = useState(base?.longDescription ?? '');
  const [bullets, setBullets] = useState((base?.bullets ?? []).join('\n'));
  const [metaDescription, setMeta] = useState(base?.metaDescription ?? '');

  const original = row.generated;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-gray-900">{row.name}</h2>
            <p className="font-mono text-xs text-gray-500">{row.externalId}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Chiudi">
            <PanelRightClose className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 px-6 py-5">
          {row.completeness && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">
                  Completezza
                </span>
                <Badge tone={COMPLETENESS_TONES[row.completeness.status]}>
                  {COMPLETENESS_LABELS[row.completeness.status]}
                </Badge>
              </div>
              {(row.completeness.status === 'partial' ||
                row.completeness.status === 'insufficient') && (
                <p className="text-sm text-amber-700">
                  Generazione parziale: i dati mancanti non sono stati inventati.
                </p>
              )}
              {row.completeness.missingAttributes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Attributi mancanti
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.completeness.missingAttributes.map((a) => (
                      <span
                        key={a}
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {original && (
            <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-600">
                Testo originale generato
              </summary>
              <div className="mt-3 space-y-2 text-sm text-gray-600">
                <p>
                  <span className="font-medium text-gray-800">Titolo:</span>{' '}
                  {original.title}
                </p>
                <p>
                  <span className="font-medium text-gray-800">Breve:</span>{' '}
                  {original.shortDescription}
                </p>
                <p>
                  <span className="font-medium text-gray-800">Completa:</span>{' '}
                  {original.longDescription}
                </p>
                {original.bullets.length > 0 && (
                  <ul className="list-inside list-disc">
                    {original.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
                <p>
                  <span className="font-medium text-gray-800">Meta:</span>{' '}
                  {original.metaDescription}
                </p>
              </div>
            </details>
          )}

          <div>
            <Label htmlFor="d-title">Titolo</Label>
            <Input
              id="d-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="d-short">Descrizione breve</Label>
            <Textarea
              id="d-short"
              rows={2}
              value={shortDescription}
              onChange={(e) => setShort(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="d-long">Descrizione completa</Label>
            <Textarea
              id="d-long"
              rows={5}
              value={longDescription}
              onChange={(e) => setLong(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="d-bullets">Bullet (uno per riga)</Label>
            <Textarea
              id="d-bullets"
              rows={4}
              value={bullets}
              onChange={(e) => setBullets(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="d-meta">Meta description</Label>
            <Textarea
              id="d-meta"
              rows={2}
              value={metaDescription}
              onChange={(e) => setMeta(e.target.value)}
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-200 bg-white px-6 py-4">
          <Button
            onClick={() =>
              onSave({
                title,
                shortDescription,
                longDescription,
                bullets: bullets
                  .split('\n')
                  .map((b) => b.trim())
                  .filter(Boolean),
                metaDescription,
                warnings: base?.warnings ?? [],
              })
            }
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Salva modifiche'
            )}
          </Button>
          <Button variant="outline" onClick={onAccept} disabled={pending}>
            <Check className="h-4 w-4 text-emerald-600" />
            Accetta
          </Button>
          <Button variant="ghost" onClick={onReject} disabled={pending}>
            <X className="h-4 w-4 text-red-600" />
            Rifiuta
          </Button>
        </div>
      </aside>
    </div>
  );
}
