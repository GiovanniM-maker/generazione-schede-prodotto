'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
  Sparkles,
  Wand2,
  ArrowRight,
  Globe,
} from 'lucide-react';
import {
  acceptGenerationAction,
  rejectGenerationAction,
  regenerateProductAction,
  getProductAttributesAction,
  confirmProductFactAction,
  type ProductAttributeView,
} from '@/lib/actions/results';
import {
  saveOutputEdit,
  saveAttributeFeedbackAction,
  getCorrectionsStatus,
  improvePromptFromCorrections,
  publishImprovement,
  type CorrectionsStatus,
  type OutputChange,
  type FieldDiff,
} from '@/lib/actions/corrections';
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
  faq: { question: string; answer: string }[];
  altText: string;
  warnings: string[];
}

/** Copy tradotta in una lingua (come GenContent, senza warnings). */
export type TranslatedContent = Omit<GenContent, 'warnings'>;

export interface ResultRow {
  id: string;
  externalId: string;
  name: string;
  category: string | null;
  status: string;
  jobFailed: boolean;
  hasEdited: boolean;
  generated: GenContent | null;
  edited: GenContent | null;
  completeness: Completeness | null;
  /** lingua ('en', 'fr', …) → copy tradotta. */
  translations: Partial<Record<string, TranslatedContent>>;
}

const LANGS: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'Inglese' },
  { code: 'fr', label: 'Francese' },
  { code: 'de', label: 'Tedesco' },
  { code: 'es', label: 'Spagnolo' },
  { code: 'pt', label: 'Portoghese' },
  { code: 'nl', label: 'Olandese' },
];

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

// Campi di output modificabili (per la cattura delle correzioni). copyKey deve
// combaciare con OUTPUT_COPY_FIELDS in @app/core.
type EditKey = 'title' | 'shortDescription' | 'longDescription' | 'bullets' | 'metaDescription';
const EDIT_FIELDS: { copyKey: EditKey; label: string }[] = [
  { copyKey: 'title', label: 'Titolo' },
  { copyKey: 'shortDescription', label: 'Descrizione breve' },
  { copyKey: 'longDescription', label: 'Descrizione lunga' },
  { copyKey: 'bullets', label: 'Punti elenco' },
  { copyKey: 'metaDescription', label: 'Meta description' },
];

function asText(v: string | string[]): string {
  return Array.isArray(v) ? v.join('\n') : v;
}

export function ResultsTable({
  batchId,
  presetId = null,
  rows: initialRows,
}: {
  batchId: string;
  presetId?: string | null;
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

  // --- Apprendimento del prompt dalle correzioni ---
  const [corrStatus, setCorrStatus] = useState<CorrectionsStatus | null>(null);
  const [improving, setImproving] = useState(false);
  const [improveErr, setImproveErr] = useState<string | null>(null);
  const [improvement, setImprovement] = useState<{
    summary: string;
    changes: FieldDiff[];
    correctionsUsed: number;
    draftVersionId: string;
  } | null>(null);

  const refreshCorrections = useCallback(() => {
    if (!presetId) return;
    getCorrectionsStatus({ presetId })
      .then((res) => {
        if (res.ok) setCorrStatus(res.data);
      })
      .catch(() => {});
  }, [presetId]);

  useEffect(() => {
    refreshCorrections();
  }, [refreshCorrections]);

  function runImprovement() {
    if (!presetId) return;
    setImproving(true);
    setImproveErr(null);
    setImprovement(null);
    startTransition(async () => {
      try {
        const res = await improvePromptFromCorrections({ presetId });
        if (!res.ok) {
          setImproveErr(res.error);
          return;
        }
        setImprovement({
          summary: res.data.summary,
          changes: res.data.changes,
          correctionsUsed: res.data.correctionsUsed,
          draftVersionId: res.data.draftVersionId,
        });
      } catch (e) {
        setImproveErr(e instanceof Error ? e.message : 'Errore');
      } finally {
        setImproving(false);
      }
    });
  }

  function applyImprovement() {
    if (!presetId || !improvement) return;
    const draftVersionId = improvement.draftVersionId;
    setImproving(true);
    setImproveErr(null);
    startTransition(async () => {
      try {
        const res = await publishImprovement({ presetId, draftVersionId });
        if (!res.ok) {
          setImproveErr(res.error);
          return;
        }
        setImprovement(null);
        refreshCorrections();
      } catch (e) {
        setImproveErr(e instanceof Error ? e.message : 'Errore');
      } finally {
        setImproving(false);
      }
    });
  }

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

  async function exportBatch(
    format: 'csv' | 'xlsx' | 'shopify' | 'woocommerce' | 'prestashop',
  ) {
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

  function saveEdit(id: string, content: GenContent, changes: OutputChange[]) {
    startTransition(async () => {
      setError(null);
      try {
        const res = await saveOutputEdit({
          productId: id,
          edited: {
            title: content.title,
            shortDescription: content.shortDescription,
            longDescription: content.longDescription,
            bullets: content.bullets,
            metaDescription: content.metaDescription,
          },
          changes,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        patchRow(id, { edited: content, hasEdited: true });
        setOpenId(null);
        // Correzioni e feedback puri alimentano il miglioramento del prompt.
        if (changes.some((c) => c.corrected !== c.original || (c.reason ?? '').trim() !== '')) {
          refreshCorrections();
        }
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
            aria-label="Cerca"
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
          <select
            value=""
            disabled={exporting !== null}
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = '';
              if (v === 'shopify' || v === 'woocommerce' || v === 'prestashop') exportBatch(v);
            }}
            aria-label="Esporta per piattaforma e-commerce"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
          >
            <option value="">
              {exporting && ['shopify', 'woocommerce', 'prestashop'].includes(exporting)
                ? 'Esporto…'
                : 'Esporta per e-commerce…'}
            </option>
            <option value="shopify">Shopify (CSV)</option>
            <option value="woocommerce">WooCommerce (CSV)</option>
            <option value="prestashop">PrestaShop (CSV)</option>
          </select>
          <TranslatePanel batchId={batchId} productCount={rows.length} />
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
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                filter === t.key
                  ? 'border-brand-accent bg-brand-soft text-brand-accent'
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

      {/* Banner: impara dalle correzioni -> migliora il prompt */}
      {presetId && corrStatus && corrStatus.pending > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600">
              <Wand2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-violet-900">
                {corrStatus.pending} feedback/correzion{corrStatus.pending === 1 ? 'e' : 'i'} da cui imparare
                {corrStatus.pending >= 5 && ' — conviene migliorare la pipeline'}
              </p>
              <p className="mt-0.5 text-xs text-violet-700">
                Trasforma i tuoi feedback e le tue modifiche in istruzioni migliori per la prossima generazione.
                {corrStatus.estimate && (
                  <>
                    {' '}Costo AI stimato ~
                    {corrStatus.estimate.usdLow < 0.01
                      ? '<0,01'
                      : corrStatus.estimate.usdLow.toFixed(2)}
                    –{corrStatus.estimate.usdHigh.toFixed(2)} $ (nessun credito addebitato).
                  </>
                )}
              </p>
            </div>
          </div>
          <Button
            onClick={runImprovement}
            disabled={improving || pending}
            className="shrink-0"
          >
            {improving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Migliora la pipeline
          </Button>
        </div>
      )}

      {improveErr && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{improveErr}</span>
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
                      className="h-5 w-5 rounded border-gray-300"
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
                          className="h-5 w-5 rounded border-gray-300"
                        />
                      </TD>
                      <TD className="font-mono text-xs text-gray-600">
                        {r.externalId}
                      </TD>
                      <TD className="font-medium text-gray-900">
                        {r.name !== r.externalId ? (
                          r.name
                        ) : (
                          <span className="font-normal text-gray-300">—</span>
                        )}
                      </TD>
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
          onSave={(content, changes) => saveEdit(openRow.id, content, changes)}
          onAccept={() => accept(openRow.id)}
          onReject={() => reject(openRow.id)}
          onCorrectionsChanged={refreshCorrections}
        />
      )}

      {/* Modale revisione miglioramento prompt (before/after) */}
      {improvement && (
        <ImprovementModal
          summary={improvement.summary}
          changes={improvement.changes}
          correctionsUsed={improvement.correctionsUsed}
          pending={improving || pending}
          onApply={applyImprovement}
          onClose={() => setImprovement(null)}
        />
      )}
    </div>
  );
}

function ImprovementModal({
  summary,
  changes,
  correctionsUsed,
  pending,
  onApply,
  onClose,
}: {
  summary: string;
  changes: FieldDiff[];
  correctionsUsed: number;
  pending: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="relative my-4 w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between rounded-t-xl border-b border-gray-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" />
            <h2 className="font-semibold text-gray-900">Miglioramento del prompt</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Chiudi">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            {summary}
            <span className="mt-1 block text-xs text-violet-700">
              Basato su {correctionsUsed} correzion{correctionsUsed === 1 ? 'e' : 'i'}. Rivedi le
              modifiche: verranno applicate come BOZZA del preset, con effetto sulla prossima
              generazione solo dopo la pubblicazione.
            </span>
          </div>

          {changes.map((c) => (
            <div key={c.fieldKey} className="rounded-lg border border-gray-200">
              <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-800">
                {c.label}
              </div>
              <div className="grid gap-0 sm:grid-cols-2">
                <div className="border-b border-gray-100 p-3 sm:border-b-0 sm:border-r">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                    Prima
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-gray-500">
                    {c.before || <span className="italic text-gray-300">(nessuna istruzione)</span>}
                  </p>
                </div>
                <div className="bg-emerald-50/40 p-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-600">
                    Dopo
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-gray-800">{c.after}</p>
                </div>
              </div>
              {c.rationale && (
                <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-600">Perché:</span> {c.rationale}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-xl border-t border-gray-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Scarta
          </Button>
          <Button onClick={onApply} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Pubblica e applica
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Traduzione del batch: scegli le lingue → una chiamata AI per prodotto/lingua.
 * Idempotente lato server (le lingue già tradotte vengono saltate).
 */
function TranslatePanel({ batchId, productCount }: { batchId: string; productCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [langs, setLangs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(code: string) {
    setLangs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function run() {
    if (langs.size === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/batches/${batchId}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languages: [...langs] }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string;
        translated?: number;
        skipped?: number;
        remaining?: number;
      };
      if (!r.ok) {
        setMsg(body.error ?? 'Traduzione non riuscita');
        return;
      }
      const parts = [`${body.translated ?? 0} tradotte`];
      if (body.skipped) parts.push(`${body.skipped} già pronte`);
      if (body.remaining) parts.push(`${body.remaining} rimaste (rilancia)`);
      setMsg(parts.join(' · '));
      router.refresh();
    } catch {
      setMsg('Errore di rete. Riprova.');
    } finally {
      setBusy(false);
    }
  }

  const allSelected = langs.size === LANGS.length;

  return (
    <div className="relative">
      <Button
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="border border-brand-accent/30 bg-brand-soft text-brand-accent hover:bg-brand-accent hover:text-white"
        title="Traduci le schede in altre lingue"
      >
        <Globe className="h-4 w-4" />
        Traduci in 6 lingue
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-800">Traduci le schede</p>
            <button
              type="button"
              onClick={() => setLangs(allSelected ? new Set() : new Set(LANGS.map((l) => l.code)))}
              className="text-xs font-medium text-brand-accent hover:underline"
            >
              {allSelected ? 'Deseleziona tutte' : 'Seleziona tutte'}
            </button>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            Circa una chiamata AI per prodotto e lingua ({productCount} prodotti). Le traduzioni
            restano fedeli al testo verificato: nessun claim aggiunto.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {LANGS.map((l) => (
              <label
                key={l.code}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={langs.has(l.code)}
                  onChange={() => toggle(l.code)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {l.label}
              </label>
            ))}
          </div>
          {msg && <p className="mt-2 text-xs text-gray-600">{msg}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Chiudi
            </Button>
            <Button size="sm" onClick={run} disabled={busy || langs.size === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              {busy ? 'Traduco…' : `Avvia${langs.size ? ` (${langs.size})` : ''}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const SOURCE_TONE: Record<ProductAttributeView['source'], 'green' | 'blue' | 'gray' | 'violet'> = {
  foto: 'blue',
  excel: 'green',
  manuale: 'violet',
  derivato: 'gray',
  altro: 'gray',
};

// Un campo è un "dubbio" quando è letto dalle foto con bassa sicurezza o non è
// ancora usabile: l'AI chiede all'utente di confermarlo o correggerlo.
const CONFIDENCE_DOUBT = 0.8;
function isDoubt(a: ProductAttributeView): boolean {
  if (!a.usable) return true;
  return a.source === 'foto' && a.confidence != null && a.confidence < CONFIDENCE_DOUBT;
}
/** Affidabilità 0..1: i dati da Excel/manuale sono certi; le foto usano la confidenza letta. */
function reliability(a: ProductAttributeView): number {
  if (a.source === 'foto') return a.confidence ?? 0;
  return a.usable ? 1 : (a.confidence ?? 0);
}

/**
 * Tabella "Campi e affidabilità": ogni campo della scheda con la sua % di
 * affidabilità. I campi letti dalle foto con bassa sicurezza sono DUBBI:
 * l'utente li conferma o corregge qui, senza passare dall'inbox.
 */
function ProductAttributesPanel({
  productId,
  onFeedbackSaved,
}: {
  productId: string;
  onFeedbackSaved?: () => void;
}) {
  const [attrs, setAttrs] = useState<ProductAttributeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Feedback per attributo (migliora il prompt di estrazione via "Migliora la pipeline").
  const [fbOpen, setFbOpen] = useState<string | null>(null);
  const [fbValue, setFbValue] = useState('');
  const [fbBusy, setFbBusy] = useState(false);
  const [fbDone, setFbDone] = useState<Set<string>>(new Set());

  async function sendFeedback(attributeId: string) {
    const text = fbValue.trim();
    if (!text) return;
    setFbBusy(true);
    try {
      const res = await saveAttributeFeedbackAction({ productId, attributeId, feedback: text });
      if (res.ok) {
        setFbDone((prev) => new Set(prev).add(attributeId));
        setFbOpen(null);
        setFbValue('');
        onFeedbackSaved?.();
      } else {
        setError(res.error);
      }
    } finally {
      setFbBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    setAttrs(null);
    setError(null);
    getProductAttributesAction(productId)
      .then((res) => {
        if (!active) return;
        if (res.ok) setAttrs(res.data);
        else setError(res.error);
      })
      .catch(() => active && setError('Errore nel caricamento degli attributi'));
    return () => {
      active = false;
    };
  }, [productId]);

  async function resolve(a: ProductAttributeView, value?: string) {
    setBusyId(a.attributeId);
    try {
      const res = await confirmProductFactAction({
        productId,
        attributeId: a.attributeId,
        value,
      });
      if (res.ok) {
        setAttrs((prev) =>
          (prev ?? []).map((x) =>
            x.attributeId === a.attributeId
              ? { ...x, value: value ?? x.value, confidence: 1, usable: true, status: 'confirmed' }
              : x,
          ),
        );
        setEditing(null);
      } else {
        setError(res.error);
      }
    } finally {
      setBusyId(null);
    }
  }

  const doubtCount = (attrs ?? []).filter(isDoubt).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">Campi e affidabilità</p>
        {doubtCount > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {doubtCount} da confermare
          </span>
        )}
      </div>
      <p className="-mt-1 text-xs text-gray-500">
        I campi in <span className="font-semibold text-red-600">rosso</span> sono{' '}
        <strong>dubbi</strong> dell&apos;AI (letti dalle foto con bassa sicurezza): confermali o
        correggili.
      </p>
      {attrs === null && !error && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Carico i campi…
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {attrs && attrs.length === 0 && (
        <p className="text-sm text-gray-500">
          Nessun campo valorizzato. Con le sole foto vengono riempiti solo i dati leggibili sul
          pack; aggiungi un Excel per completare gli altri.
        </p>
      )}
      {attrs &&
        attrs.length > 0 &&
        attrs.map((a) => {
          const rel = reliability(a);
          const pct = Math.round(rel * 100);
          const doubt = isDoubt(a);
          const isEditing = editing === a.attributeId;
          const busy = busyId === a.attributeId;
          // Dubbio (confidence bassa) → rosso in grassetto. Altrimenti verde/ambra.
          const barColor = doubt ? 'bg-red-500' : rel >= 0.8 ? 'bg-emerald-500' : 'bg-amber-500';
          const pctColor = doubt ? 'text-red-600' : rel >= 0.8 ? 'text-emerald-700' : 'text-amber-700';
          return (
            <div
              key={a.attributeId}
              className={cn(
                'rounded-lg border p-3',
                doubt ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', doubt ? 'font-bold text-red-700' : 'text-gray-800')}>
                    <span className="font-medium">{a.name}:</span>{' '}
                    {isEditing ? null : a.value}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Barra di affidabilità + % */}
                  <div className="flex items-center gap-1.5" title={`Affidabilità ${pct}%`}>
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200">
                      <div className={cn('h-full rounded-full', barColor)} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={cn('w-9 text-right text-xs font-bold tabular-nums', pctColor)}>
                      {pct}%
                    </span>
                  </div>
                  <Badge tone={SOURCE_TONE[a.source]}>{a.source}</Badge>
                </div>
              </div>
                {isEditing && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Button size="sm" onClick={() => resolve(a, editValue)} disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Salva
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
                      Annulla
                    </Button>
                  </div>
                )}
                {doubt && !isEditing && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resolve(a)}
                      disabled={busy}
                      className="h-7 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Conferma
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(a.attributeId);
                        setEditValue(a.value);
                      }}
                      disabled={busy}
                      className="h-7"
                    >
                      <Pencil className="h-4 w-4" /> Correggi
                    </Button>
                  </div>
                )}
                {/* Feedback sull'ESTRAZIONE del campo (migliora il prompt di
                    estrazione via "Migliora la pipeline"). */}
                {!isEditing &&
                  (fbOpen === a.attributeId ? (
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <input
                        type="text"
                        value={fbValue}
                        onChange={(e) => setFbValue(e.target.value)}
                        placeholder="Come dovrebbe leggerlo meglio? (es. «guarda sul retro, non sul fronte»)"
                        className="h-8 flex-1 rounded-md border border-violet-200 bg-violet-50/40 px-2 text-xs text-violet-900 placeholder:text-violet-400 focus:border-violet-300 focus:outline-none"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => sendFeedback(a.attributeId)} disabled={fbBusy || !fbValue.trim()}>
                        {fbBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Invia
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setFbOpen(null); setFbValue(''); }} disabled={fbBusy}>
                        Annulla
                      </Button>
                    </div>
                  ) : fbDone.has(a.attributeId) ? (
                    <p className="mt-1 text-xs text-emerald-600">Feedback inviato ✓ — verrà usato in «Migliora la pipeline».</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setFbOpen(a.attributeId); setFbValue(''); }}
                      className="mt-1 text-xs text-violet-500 hover:text-violet-700 hover:underline"
                    >
                      💬 Feedback sull&apos;estrazione di questo campo
                    </button>
                  ))}
              </div>
            );
          })}
    </div>
  );
}

/** Mostra le traduzioni disponibili con selettore lingua (sola lettura). */
function TranslationsViewer({
  translations,
}: {
  translations: Partial<Record<string, TranslatedContent>>;
}) {
  const codes = LANGS.filter((l) => translations[l.code]).map((l) => l.code);
  const [lang, setLang] = useState<string | null>(null);
  if (codes.length === 0) return null;
  const active = lang && translations[lang] ? translations[lang] : null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Globe className="h-4 w-4 text-brand-accent" />
        <span className="text-sm font-medium text-gray-700">Traduzioni</span>
        {codes.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setLang((cur) => (cur === c ? null : c))}
            className={cn(
              'rounded-full border px-2 py-0.5 font-mono text-xs uppercase',
              lang === c
                ? 'border-brand-accent bg-brand-accent text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400',
            )}
          >
            {c}
          </button>
        ))}
      </div>
      {active && (
        <div className="mt-3 space-y-2 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">{active.title}</p>
          <p>{active.shortDescription}</p>
          <p className="whitespace-pre-line text-gray-600">{active.longDescription}</p>
          {active.bullets.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5">
              {active.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {active.metaDescription && (
            <p className="text-xs text-gray-500">meta: {active.metaDescription}</p>
          )}
          {active.altText && <p className="text-xs text-gray-500">alt: {active.altText}</p>}
          {active.faq.length > 0 && (
            <div className="space-y-1">
              {active.faq.map((f, i) => (
                <p key={i} className="text-xs text-gray-600">
                  <span className="font-medium text-gray-800">{f.question}</span> — {f.answer}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Micro-input di feedback su un singolo campo (alimenta "Migliora la pipeline"). */
function FieldFeedback({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="💬 Feedback su questo campo (facoltativo): cosa non va?"
      className="mt-1 w-full rounded-md border border-violet-100 bg-violet-50/40 px-2 py-1 text-xs text-violet-900 placeholder:text-violet-400 focus:border-violet-300 focus:outline-none"
    />
  );
}

function DetailDrawer({
  row,
  pending,
  onClose,
  onSave,
  onAccept,
  onReject,
  onCorrectionsChanged,
}: {
  row: ResultRow;
  pending: boolean;
  onClose: () => void;
  onSave: (content: GenContent, changes: OutputChange[]) => void;
  onAccept: () => void;
  onReject: () => void;
  onCorrectionsChanged?: () => void;
}) {
  const base = row.edited ?? row.generated;
  const [title, setTitle] = useState(base?.title ?? '');
  const [shortDescription, setShort] = useState(base?.shortDescription ?? '');
  const [longDescription, setLong] = useState(base?.longDescription ?? '');
  const [bullets, setBullets] = useState((base?.bullets ?? []).join('\n'));
  const [metaDescription, setMeta] = useState(base?.metaDescription ?? '');
  // Feedback PER CAMPO: alimenta il miglioramento del prompt. Un feedback vale
  // anche senza modificare il valore (segnale puro).
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const setReason = (key: string, val: string) => setReasons((r) => ({ ...r, [key]: val }));

  const original = row.generated;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function buildContentAndChanges(): { content: GenContent; changes: OutputChange[] } {
    const content: GenContent = {
      title,
      shortDescription,
      longDescription,
      bullets: bullets
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean),
      metaDescription,
      faq: base?.faq ?? [],
      altText: base?.altText ?? '',
      warnings: base?.warnings ?? [],
    };
    // Confronta con l'ULTIMO testo salvato (edited se presente, altrimenti
    // generato): così un ri-salvataggio senza modifiche non registra nulla e
    // non si accumulano correzioni duplicate (BUG audit #1).
    const baseline = row.edited ?? row.generated;
    const changes: OutputChange[] = EDIT_FIELDS.map((f) => {
      const before = baseline ? asText(baseline[f.copyKey]) : '';
      const after = asText(content[f.copyKey]);
      const fieldReason = (reasons[f.copyKey as string] ?? '').trim();
      return { copyKey: f.copyKey as string, original: before, corrected: after, reason: fieldReason };
    }).filter((c) => c.corrected !== c.original || c.reason !== '');
    return { content, changes };
  }

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
            <p className="font-mono text-xs text-gray-500">
              {row.externalId}
              {row.category && (
                <>
                  {' · '}
                  <span className="font-sans text-gray-600">{row.category}</span>
                </>
              )}
            </p>
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

          <ProductAttributesPanel productId={row.id} onFeedbackSaved={onCorrectionsChanged} />

          <TranslationsViewer translations={row.translations} />

          {base && (base.altText || (base.faq?.length ?? 0) > 0) && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
              {base.altText && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Alt text immagine
                  </p>
                  <p className="mt-0.5 text-sm text-gray-700">{base.altText}</p>
                </div>
              )}
              {(base.faq?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">FAQ</p>
                  <div className="mt-1 space-y-2">
                    {base.faq.map((f, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-gray-800">{f.question}</p>
                        <p className="text-sm text-gray-600">{f.answer}</p>
                      </div>
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
            <FieldFeedback value={reasons.title ?? ''} onChange={(v) => setReason('title', v)} />
          </div>
          <div>
            <Label htmlFor="d-short">Descrizione breve</Label>
            <Textarea
              id="d-short"
              rows={2}
              value={shortDescription}
              onChange={(e) => setShort(e.target.value)}
            />
            <FieldFeedback value={reasons.shortDescription ?? ''} onChange={(v) => setReason('shortDescription', v)} />
          </div>
          <div>
            <Label htmlFor="d-long">Descrizione completa</Label>
            <Textarea
              id="d-long"
              rows={5}
              value={longDescription}
              onChange={(e) => setLong(e.target.value)}
            />
            <FieldFeedback value={reasons.longDescription ?? ''} onChange={(v) => setReason('longDescription', v)} />
          </div>
          <div>
            <Label htmlFor="d-bullets">Bullet (uno per riga)</Label>
            <Textarea
              id="d-bullets"
              rows={4}
              value={bullets}
              onChange={(e) => setBullets(e.target.value)}
            />
            <FieldFeedback value={reasons.bullets ?? ''} onChange={(v) => setReason('bullets', v)} />
          </div>
          <div>
            <Label htmlFor="d-meta">Meta description</Label>
            <Textarea
              id="d-meta"
              rows={2}
              value={metaDescription}
              onChange={(e) => setMeta(e.target.value)}
            />
            <FieldFeedback value={reasons.metaDescription ?? ''} onChange={(v) => setReason('metaDescription', v)} />
          </div>

          {/* Come funziona la revisione: disclaimer a prova di scemo. */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-xs text-violet-800">
            <p className="flex items-center gap-1.5 font-medium text-violet-900">
              <Wand2 className="h-4 w-4" />
              Come funziona la revisione
            </p>
            <p className="mt-1">
              Correggi i campi e/o lascia un <strong>feedback</strong> dove serve (i riquadri viola
              sotto ogni campo). Quando salvi, i feedback vengono registrati; poi con
              <strong> «Migliora la pipeline»</strong> (in cima alla pagina) il sistema li usa per
              scrivere meglio la prossima volta. I dati mancanti non vengono mai inventati.
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-200 bg-white px-6 py-4">
          <Button
            onClick={() => {
              const { content, changes } = buildContentAndChanges();
              onSave(content, changes);
            }}
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
