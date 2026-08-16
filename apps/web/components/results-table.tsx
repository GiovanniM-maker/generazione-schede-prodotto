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
  PanelRightClose,
  PackageOpen,
  Sparkles,
  Wand2,
  ArrowRight,
  Globe,
  Rows3,
  BookOpen,
  ChevronDown,
  SlidersHorizontal,
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
import { Avviso } from '@/components/ui/avviso';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { fettaDiPagina } from '@/lib/paginazione';
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
  /** URL firmato della foto principale, se il prodotto ne ha una. */
  imageUrl?: string | null;
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

// ---------------------------------------------------------------------------
// Cosa vuol dire ogni giudizio.
//
// Otto etichette e nessuna spiegazione da nessuna parte: «Parziale» e
// «Insufficiente» sembrano la stessa cosa detta con due parole, «Bloccato» non
// dice da cosa, e chi deve decidere se una scheda si pubblica non ha modo di
// saperlo. La differenza però è netta, ed è tutta nei dati di partenza: una
// scheda parziale si pubblica, una insufficiente no.
// ---------------------------------------------------------------------------
const SPIEGAZIONI: Partial<Record<Filter, string>> = {
  complete: 'Tutti i dati previsti dalla categoria c’erano: la scheda si pubblica così.',
  parziali:
    'Mancava qualche dato: la scheda è scritta solo su quelli che c’erano, e non inventa il resto. Si pubblica, ma dice meno.',
  verifica:
    'Qualcosa nei dati non torna o è ambiguo. Guardala prima di pubblicarla: nel dettaglio trovi il perché.',
  insufficienti:
    'I dati non bastavano per scrivere una scheda che dica qualcosa. Non è un errore nostro: è il file di partenza. Aggiungi dati e rigenera.',
  bloccati:
    'La generazione si è fermata prima di scrivere — di solito un dato obbligatorio della categoria che manca del tutto.',
  modificati: 'L’hai riscritta a mano: quello che si esporta è la tua versione, non la nostra.',
  falliti:
    'La chiamata all’AI non è andata a buon fine. Il credito è stato restituito: puoi rigenerare.',
};

// Mappa una tab di completezza al relativo stato.
const COMPLETENESS_FILTER: Partial<Record<Filter, CompletenessStatus>> = {
  complete: 'complete',
  parziali: 'partial',
  verifica: 'needs_review',
  insufficienti: 'insufficient',
  bloccati: 'blocked',
};

/** I due modi di guardare i risultati. */
type Vista = 'tabella' | 'lettura';

/** La scelta della vista resta fra una visita e l'altra: e' una preferenza. */
const CHIAVE_VISTA = 'verificato:vista-risultati';

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
  // Due modi di guardare gli stessi risultati. La tabella serve a confrontare
  // in fretta molte righe; la lettura serve a chi la scheda la deve LEGGERE,
  // come apparira' sul sito, senza niente troncato.
  const [vista, setVista] = useState<Vista>('tabella');
  // Su telefono, prima del primo prodotto c'erano ricerca, quattro pulsanti di
  // export, traduzione e otto filtri: parecchio da scorrere per chi vuole solo
  // leggere e approvare. Ora sono chiusi, e si aprono a richiesta.
  const [strumentiAperti, setStrumentiAperti] = useState(false);
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

  // Ripristina la vista scelta l'ultima volta. Si legge dopo il montaggio:
  // il server non conosce le preferenze del browser.
  useEffect(() => {
    const salvata = window.localStorage.getItem(CHIAVE_VISTA);
    if (salvata === 'lettura' || salvata === 'tabella') setVista(salvata);
  }, []);

  function cambiaVista(v: Vista) {
    setVista(v);
    window.localStorage.setItem(CHIAVE_VISTA, v);
  }

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

  // ---------------------------------------------------------------------
  // Paginazione.
  //
  // Con 153 prodotti la pagina faceva 9.252 nodi, 33.519 px di altezza su
  // telefono e 974 ms di blocco: e sono numeri di un catalogo piccolo. Peggio,
  // ogni riga è nel documento **due volte** — la vista del telefono e quella
  // del desktop convivono e una delle due è nascosta dal CSS — quindi il costo
  // è doppio rispetto a quello che si vede.
  //
  // Cinquanta per volta: abbastanza da lavorare senza continuare a girare
  // pagina, poco abbastanza da non trasformare il documento in un muro.
  // ---------------------------------------------------------------------
  const PER_PAGINA = 50;
  const [pagina, setPagina] = useState(0);
  // Cambiando filtro o ricerca si torna in cima: restare a «pagina 4» di un
  // elenco che ora ne ha due mostrerebbe il vuoto.
  useEffect(() => {
    setPagina(0);
  }, [filter, query, vista]);
  const fetta = fettaDiPagina(filtered.length, PER_PAGINA, pagina);
  const visibili = useMemo(
    () => filtered.slice(fetta.da, fetta.a),
    [filtered, fetta.da, fetta.a],
  );

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
      {/* Su telefono la barra e' chiusa: si apre solo se serve. Da tablet in su
          c'e' spazio e resta sempre aperta. */}
      <button
        type="button"
        onClick={() => setStrumentiAperti((v) => !v)}
        aria-expanded={strumentiAperti}
        aria-controls="barra-strumenti-risultati"
        className="inline-flex w-full items-center justify-between rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm font-medium text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent sm:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-ink-500" />
          Cerca, filtra ed esporta
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-ink-500 transition-transform', strumentiAperti && 'rotate-180')}
        />
      </button>

      {/* Barra strumenti */}
      <div
        id="barra-strumenti-risultati"
        className={cn(
          'flex-col gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between',
          strumentiAperti ? 'flex' : 'hidden',
        )}
      >
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per nome, ID o titolo…"
            className="pl-9"
            aria-label="Cerca"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-700 disabled:opacity-50"
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

      {/* La spiegazione del giudizio che si sta guardando. Otto etichette e
          nessuna spiegazione: «Parziale» e «Insufficiente» sembravano la stessa
          cosa detta con due parole, e la differenza è quella che decide se una
          scheda si pubblica o no. */}
      {SPIEGAZIONI[filter] && (
        <p className="text-sm text-ink-600">{SPIEGAZIONI[filter]}</p>
      )}

      {/* Tabs + azione multipla */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={cn('flex-wrap gap-2 sm:flex', strumentiAperti ? 'flex' : 'hidden sm:flex')}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              title={SPIEGAZIONI[t.key]}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                filter === t.key
                  ? 'border-brand-accent bg-brand-soft text-brand-accent'
                  : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  filter === t.key
                    ? 'bg-brand-accent text-white'
                    : 'bg-ink-100 text-ink-500',
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <Button size="sm" onClick={acceptSelected} disabled={pending}>
              <Check className="h-4 w-4" />
              Accetta selezionati ({selected.size})
            </Button>
          )}
          <SelettoreVista vista={vista} onChange={cambiaVista} />
        </div>
      </div>

      {error && (
        <Avviso tono="errore">{error}</Avviso>
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
        <Avviso tono="errore">{improveErr}</Avviso>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <PackageOpen className="h-8 w-8 text-ink-400" />
            <p className="text-sm text-ink-500">
              Nessun risultato disponibile per questo batch.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* LETTURA: una colonna, niente troncato, uguale su ogni schermo. */}
            {vista === 'lettura' && (
              <div className="divide-y divide-ink-100">
                {visibili.map((r) => (
                  <SchedaLettura
                    key={r.id}
                    riga={r}
                    selezionata={selected.has(r.id)}
                    onSeleziona={() => toggleSelect(r.id)}
                    onRivedi={() => setOpenId(r.id)}
                    onAccetta={() => accept(r.id)}
                    onRifiuta={() => reject(r.id)}
                    onRigenera={() => regenerate(r.id)}
                    inCorso={pending}
                  />
                ))}
              </div>
            )}

            {/* MOBILE: schede al posto della tabella (8 colonne su un telefono
                sono illeggibili e costringono a scorrere in orizzontale). */}
            <div className={cn('divide-y divide-ink-100 sm:hidden', vista === 'lettura' && 'hidden')}>
              {visibili.map((r) => {
                const eff = effective(r);
                return (
                  <div key={r.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        aria-label={`Seleziona ${r.name}`}
                        className="mt-0.5 h-6 w-6 shrink-0 rounded border-ink-300"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-ink-500">{r.externalId}</p>
                        <p className="mt-0.5 font-medium text-ink-900">
                          {eff?.title || <span className="text-ink-300">— nessun titolo —</span>}
                        </p>
                        {eff?.shortDescription && (
                          <p className="mt-1 line-clamp-2 text-sm text-ink-500">
                            {eff.shortDescription}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {r.completeness && (
                            <Badge tone={COMPLETENESS_TONES[r.completeness.status]}>
                              {COMPLETENESS_LABELS[r.completeness.status]}
                            </Badge>
                          )}
                          <StatusBadge status={r.jobFailed ? 'failed' : r.status} />
                          {r.hasEdited && <Badge tone="violet">Modificato</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setOpenId(r.id)}>
                        <Pencil className="h-4 w-4" />
                        Rivedi
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => accept(r.id)} disabled={pending} aria-label="Accetta">
                        <Check className="h-4 w-4 text-emerald-600" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => reject(r.id)} disabled={pending} aria-label="Rifiuta">
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => regenerate(r.id)} disabled={pending} aria-label="Rigenera">
                        <RefreshCw className="h-4 w-4 text-ink-500" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* DESKTOP: tabella completa */}
            <div className={cn('hidden sm:block', vista === 'lettura' && 'sm:hidden')}>
            <Table scorrevole>
              <THead>
                <TR>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Seleziona tutte le schede che passano il filtro, anche nelle altre pagine"
                      className="h-6 w-6 rounded border-ink-300"
                    />
                  </TH>
                  <TH>ID</TH>
                  <TH>Nome</TH>
                  <TH>Titolo</TH>
                  <TH>Descrizione breve</TH>
                  <TH>Completezza</TH>
                  <TH>Stato</TH>
                  {/* Agganciata al bordo destro: la tabella è più larga del suo
                      contenitore (1225px contro 1102) e senza questo «Rifiuta» e
                      «Rigenera» finivano fuori vista a QUALSIASI larghezza di
                      schermo — il limite è il guscio, non il monitor. Una
                      tabella di dati può scorrere; i comandi per agire su una
                      riga no. */}
                  <TH className="sticky right-0 z-10 bg-ink-50 text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                    Azioni
                  </TH>
                </TR>
              </THead>
              <TBody>
                {visibili.map((r) => {
                  const eff = effective(r);
                  return (
                    <TR key={r.id}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          aria-label={`Seleziona ${r.name}`}
                          className="h-6 w-6 rounded border-ink-300"
                        />
                      </TD>
                      <TD className="font-mono text-xs text-ink-600">
                        {r.externalId}
                      </TD>
                      {/* Larghezza dichiarata e troncatura, come le due
                          colonne accanto: senza, un nome lungo andava a capo su
                          quattro righe e l'altezza delle righe ballava fra 73 e
                          105px.
                          I tre limiti crescono con lo schermo. Erano fissi, e
                          su un monitor largo restavano quelli di un portatile:
                          **tutti e sei** i nomi, titoli e descrizioni misurati
                          su dati veri erano troncati — il piu' stretto a 256px
                          per un testo che ne voleva 326. Il nome del prodotto e'
                          l'identita' della riga, quindi e' il primo a smettere
                          di essere tagliato; la descrizione breve e' un
                          paragrafo, e in una riga di tabella e' giusto che si
                          fermi. */}
                      <TD className="max-w-[14rem] truncate font-medium text-ink-900 xl:max-w-[22rem]" title={r.name}>
                        {r.name !== r.externalId ? (
                          r.name
                        ) : (
                          <span className="font-normal text-ink-300">—</span>
                        )}
                      </TD>
                      <TD className="max-w-[16rem] truncate text-ink-700 xl:max-w-[20rem]">
                        {eff?.title || <span className="text-ink-300">—</span>}
                      </TD>
                      <TD className="max-w-[18rem] truncate text-ink-500 xl:max-w-[20rem] 2xl:max-w-[24rem]">
                        {eff?.shortDescription || (
                          <span className="text-ink-300">—</span>
                        )}
                      </TD>
                      <TD>
                        {r.completeness ? (
                          <Badge tone={COMPLETENESS_TONES[r.completeness.status]}>
                            {COMPLETENESS_LABELS[r.completeness.status]}
                          </Badge>
                        ) : (
                          <span className="text-ink-300">—</span>
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
                      <TD className="sticky right-0 z-10 bg-white shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
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
                            <RefreshCw className="h-4 w-4 text-ink-500" />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            </div>
            {filtered.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-ink-500">
                Nessun risultato in questa categoria.
              </div>
            )}

            {/* I comandi compaiono solo quando servono davvero: sotto le 50
                schede una barra di paginazione è arredamento. */}
            {fetta.pagine > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-3">
                <p className="text-sm text-ink-600" aria-live="polite">
                  Schede {fetta.primo}–{fetta.ultimo} di {filtered.length}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPagina((p) => Math.max(0, p - 1))}
                    disabled={fetta.pagina === 0}
                  >
                    Precedenti
                  </Button>
                  <span className="text-sm tabular-nums text-ink-600">
                    {fetta.pagina + 1} / {fetta.pagine}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPagina((p) => Math.min(fetta.pagine - 1, p + 1))}
                    disabled={fetta.pagina >= fetta.pagine - 1}
                  >
                    Successive
                  </Button>
                </div>
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


/**
 * Scelta fra le due viste.
 *
 * Non e' una preferenza estetica: sono due mestieri diversi. La tabella serve a
 * scorrere in fretta cinquanta righe e trovare quella storta. La lettura serve
 * a chi la scheda la deve leggere davvero — come apparira' sul sito — e a chi
 * con le tabelle non se la cava.
 */
/**
 * Vista LETTURA: una scheda per prodotto, in colonna, niente troncato.
 *
 * La tabella e' fatta per confrontare; questa e' fatta per leggere. Il testo
 * appare come apparira' sul sito — titolo grande, descrizione respirata, punti
 * elenco veri — e la descrizione lunga e le domande frequenti si aprono solo se
 * servono, per non trasformare la pagina in un muro.
 *
 * Stessa forma su telefono e su schermo grande: una colonna di lettura non ha
 * bisogno di due versioni.
 */
function SchedaLettura({
  riga,
  selezionata,
  onSeleziona,
  onRivedi,
  onAccetta,
  onRifiuta,
  onRigenera,
  inCorso,
}: {
  riga: ResultRow;
  selezionata: boolean;
  onSeleziona: () => void;
  onRivedi: () => void;
  onAccetta: () => void;
  onRifiuta: () => void;
  onRigenera: () => void;
  inCorso: boolean;
}) {
  const [espansa, setEspansa] = useState(false);
  const eff = effective(riga);
  const haApprofondimento = Boolean(eff?.longDescription || eff?.faq?.length);

  return (
    <article className="px-4 py-6 sm:px-6">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selezionata}
          onChange={onSeleziona}
          aria-label={`Seleziona ${riga.name}`}
          className="mt-1 h-6 w-6 shrink-0 rounded border-ink-300"
        />

        {/* La foto del pack accanto al testo: rivedere una scheda guardando il
            prodotto e' molto piu' vicino a "come apparira'" che leggere solo le
            parole. Su telefono sta sopra, per non rubare larghezza alla lettura. */}
        {riga.imageUrl && (
          <a
            href={riga.imageUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent sm:block"
            aria-label={`Apri la foto di ${riga.name}`}
          >
            {/* Immagine da URL firmato di Supabase: next/image richiederebbe di
                dichiarare l'host, e l'URL cambia a ogni caricamento. */}
            <img
              src={riga.imageUrl}
              alt={effective(riga)?.altText || riga.name}
              className="h-28 w-28 object-cover"
              loading="lazy"
            />
          </a>
        )}

        <div className="min-w-0 flex-1">
          {riga.imageUrl && (
            <a
              href={riga.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="mb-3 block overflow-hidden rounded-lg border border-ink-200 bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent sm:hidden"
              aria-label={`Apri la foto di ${riga.name}`}
            >
              <img
                src={riga.imageUrl}
                alt={effective(riga)?.altText || riga.name}
                className="h-40 w-full object-cover"
                loading="lazy"
              />
            </a>
          )}
          {/* Occhiello discreto: identificativo e categoria non rubano la scena. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <span className="font-mono">{riga.externalId}</span>
            {riga.category && (
              <>
                <span aria-hidden>·</span>
                <span>{riga.category}</span>
              </>
            )}
          </p>

          {eff?.title ? (
            <h3 className="mt-1 text-lg font-semibold leading-snug text-ink-900 sm:text-xl">
              {eff.title}
            </h3>
          ) : (
            <h3 className="mt-1 text-lg font-semibold italic text-ink-300">
              nessun titolo generato
            </h3>
          )}

          {eff?.shortDescription && (
            <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-600">
              {eff.shortDescription}
            </p>
          )}

          {eff?.bullets && eff.bullets.length > 0 && (
            <ul className="mt-3 max-w-prose space-y-1.5">
              {eff.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink-700">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {haApprofondimento && (
            <>
              <button
                type="button"
                onClick={() => setEspansa((v) => !v)}
                aria-expanded={espansa}
                className="mt-3 inline-flex items-center gap-1 rounded py-1 text-sm font-medium text-brand-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', espansa && 'rotate-180')}
                />
                {espansa ? 'Mostra meno' : 'Leggi tutto'}
              </button>

              {espansa && (
                <div className="mt-3 space-y-4 border-l-2 border-ink-100 pl-4">
                  {eff?.longDescription && (
                    <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-ink-700">
                      {eff.longDescription}
                    </p>
                  )}
                  {eff?.faq && eff.faq.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        Domande frequenti
                      </p>
                      <dl className="mt-2 max-w-prose space-y-2">
                        {eff.faq.map((f, i) => (
                          <div key={i}>
                            <dt className="text-sm font-medium text-ink-900">{f.question}</dt>
                            <dd className="text-sm text-ink-600">{f.answer}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {riga.completeness && (
              <Badge tone={COMPLETENESS_TONES[riga.completeness.status]}>
                {COMPLETENESS_LABELS[riga.completeness.status]}
              </Badge>
            )}
            <StatusBadge status={riga.jobFailed ? 'failed' : riga.status} />
            {riga.hasEdited && <Badge tone="violet">Modificato</Badge>}
          </div>

          {/* Il motivo del blocco si legge qui: e' la domanda che uno si fa
              guardando una scheda che non va avanti. */}
          {riga.completeness?.reason && (
            <p className="mt-2 max-w-prose text-sm text-amber-700">
              {riga.completeness.reason}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onRivedi}>
              <Pencil className="h-4 w-4" />
              Rivedi
            </Button>
            <Button variant="outline" size="sm" onClick={onAccetta} disabled={inCorso}>
              <Check className="h-4 w-4 text-emerald-600" />
              Accetta
            </Button>
            <Button variant="outline" size="sm" onClick={onRifiuta} disabled={inCorso}>
              <X className="h-4 w-4 text-red-600" />
              Rifiuta
            </Button>
            <Button variant="outline" size="sm" onClick={onRigenera} disabled={inCorso}>
              <RefreshCw className="h-4 w-4 text-ink-500" />
              Rigenera
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function SelettoreVista({
  vista,
  onChange,
}: {
  vista: Vista;
  onChange: (v: Vista) => void;
}) {
  const opzioni: Array<{ chiave: Vista; etichetta: string; Icona: typeof Rows3 }> = [
    { chiave: 'tabella', etichetta: 'Tabella', Icona: Rows3 },
    { chiave: 'lettura', etichetta: 'Lettura', Icona: BookOpen },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Come guardare i risultati"
      className="inline-flex shrink-0 rounded-lg border border-ink-200 bg-white p-0.5"
    >
      {opzioni.map(({ chiave, etichetta, Icona }) => (
        <button
          key={chiave}
          type="button"
          role="radio"
          aria-checked={vista === chiave}
          onClick={() => onChange(chiave)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
            vista === chiave
              ? 'bg-brand-soft text-brand-accent'
              : 'text-ink-500 hover:text-ink-800',
          )}
        >
          <Icona className="h-4 w-4" />
          {etichetta}
        </button>
      ))}
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
        <div className="sticky top-0 flex items-center justify-between rounded-t-xl border-b border-ink-200 bg-white px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" />
            <h2 className="font-semibold text-ink-900">Miglioramento del prompt</h2>
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
            <div key={c.fieldKey} className="rounded-lg border border-ink-200">
              <div className="border-b border-ink-100 px-3 py-2 text-sm font-semibold text-ink-800">
                {c.label}
              </div>
              <div className="grid gap-0 sm:grid-cols-2">
                <div className="border-b border-ink-100 p-3 sm:border-b-0 sm:border-r">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-500">
                    Prima
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-ink-500">
                    {c.before || <span className="italic text-ink-300">(nessuna istruzione)</span>}
                  </p>
                </div>
                <div className="bg-emerald-50/40 p-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-600">
                    Dopo
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-ink-800">{c.after}</p>
                </div>
              </div>
              {c.rationale && (
                <div className="border-t border-ink-100 px-3 py-2 text-xs text-ink-500">
                  <span className="font-medium text-ink-600">Perché:</span> {c.rationale}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-xl border-t border-ink-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
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
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-ink-200 bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">Traduci le schede</p>
            <button
              type="button"
              onClick={() => setLangs(allSelected ? new Set() : new Set(LANGS.map((l) => l.code)))}
              className="text-xs font-medium text-brand-accent hover:underline"
            >
              {allSelected ? 'Deseleziona tutte' : 'Seleziona tutte'}
            </button>
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            Circa una chiamata AI per prodotto e lingua ({productCount} prodotti). Le traduzioni
            restano fedeli al testo verificato: nessun claim aggiunto.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {LANGS.map((l) => (
              <label
                key={l.code}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm text-ink-700 hover:bg-ink-50"
              >
                <input
                  type="checkbox"
                  checked={langs.has(l.code)}
                  onChange={() => toggle(l.code)}
                  className="h-4 w-4 rounded border-ink-300"
                />
                {l.label}
              </label>
            ))}
          </div>
          {msg && <p className="mt-2 text-xs text-ink-600">{msg}</p>}
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
        <p className="text-sm font-semibold text-ink-800">Campi e affidabilità</p>
        {doubtCount > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {doubtCount} da confermare
          </span>
        )}
      </div>
      <p className="-mt-1 text-xs text-ink-500">
        I campi in <span className="font-semibold text-red-600">rosso</span> sono{' '}
        <strong>dubbi</strong> dell&apos;AI (letti dalle foto con bassa sicurezza): confermali o
        correggili.
      </p>
      {attrs === null && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carico i campi…
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {attrs && attrs.length === 0 && (
        <p className="text-sm text-ink-500">
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
                doubt ? 'border-red-200 bg-red-50/50' : 'border-ink-200 bg-white',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', doubt ? 'font-bold text-red-700' : 'text-ink-800')}>
                    <span className="font-medium">{a.name}:</span>{' '}
                    {isEditing ? null : a.value}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Barra di affidabilità + % */}
                  <div className="flex items-center gap-1.5" title={`Affidabilità ${pct}%`}>
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-ink-200">
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
                      className="h-9 border-emerald-200 text-emerald-700 hover:bg-emerald-50 sm:h-7"
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
                      className="h-9 sm:h-7"
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
                        className="h-8 flex-1 rounded-lg border border-violet-200 bg-violet-50/40 px-2 text-xs text-violet-900 placeholder:text-violet-400 focus:border-violet-300 focus:outline-none"
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
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Globe className="h-4 w-4 text-brand-accent" />
        <span className="text-sm font-medium text-ink-700">Traduzioni</span>
        {codes.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setLang((cur) => (cur === c ? null : c))}
            className={cn(
              'rounded-full border px-2 py-0.5 font-mono text-xs uppercase',
              lang === c
                ? 'border-brand-accent bg-brand-accent text-white'
                : 'border-ink-300 bg-white text-ink-600 hover:border-ink-400',
            )}
          >
            {c}
          </button>
        ))}
      </div>
      {active && (
        <div className="mt-3 space-y-2 text-sm text-ink-700">
          <p className="font-semibold text-ink-900">{active.title}</p>
          <p>{active.shortDescription}</p>
          <p className="whitespace-pre-line text-ink-600">{active.longDescription}</p>
          {active.bullets.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5">
              {active.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {active.metaDescription && (
            <p className="text-xs text-ink-500">meta: {active.metaDescription}</p>
          )}
          {active.altText && <p className="text-xs text-ink-500">alt: {active.altText}</p>}
          {active.faq.length > 0 && (
            <div className="space-y-1">
              {active.faq.map((f, i) => (
                <p key={i} className="text-xs text-ink-600">
                  <span className="font-medium text-ink-800">{f.question}</span> — {f.answer}
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
      className="mt-1 w-full rounded-lg border border-violet-100 bg-violet-50/40 px-2 py-1 text-xs text-violet-900 placeholder:text-violet-400 focus:border-violet-300 focus:outline-none"
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
        <div className="sticky top-0 flex items-center justify-between border-b border-ink-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-ink-900">{row.name}</h2>
            <p className="font-mono text-xs text-ink-500">
              {row.externalId}
              {row.category && (
                <>
                  {' · '}
                  <span className="font-sans text-ink-600">{row.category}</span>
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
            <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink-700">
                  Completezza
                </span>
                <Badge tone={COMPLETENESS_TONES[row.completeness.status]}>
                  {COMPLETENESS_LABELS[row.completeness.status]}
                </Badge>
              </div>
              {(row.completeness.status === 'blocked' ||
                row.completeness.status === 'insufficient') && (
                <Avviso tono="errore" className="p-2.5 font-medium">
                  {row.completeness.status === 'blocked' ? 'Bloccata: ' : 'Insufficiente: '}
                  {row.completeness.reason ??
                    'dati non sufficienti o affermazione non supportata dai dati. Conferma/correggi i campi qui sotto e rigenera.'}
                </Avviso>
              )}
              {row.completeness.status === 'partial' && (
                <p className="text-sm text-amber-700">
                  Generazione parziale: i dati mancanti non sono stati inventati.
                </p>
              )}
              {row.completeness.missingAttributes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
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
            <div className="space-y-3 rounded-lg border border-ink-200 bg-white p-3">
              {base.altText && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Alt text immagine
                  </p>
                  <p className="mt-0.5 text-sm text-ink-700">{base.altText}</p>
                </div>
              )}
              {(base.faq?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">FAQ</p>
                  <div className="mt-1 space-y-2">
                    {base.faq.map((f, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-ink-800">{f.question}</p>
                        <p className="text-sm text-ink-600">{f.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {original && (
            <details className="rounded-lg border border-ink-200 bg-ink-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink-600">
                Testo originale generato
              </summary>
              <div className="mt-3 space-y-2 text-sm text-ink-600">
                <p>
                  <span className="font-medium text-ink-800">Titolo:</span>{' '}
                  {original.title}
                </p>
                <p>
                  <span className="font-medium text-ink-800">Breve:</span>{' '}
                  {original.shortDescription}
                </p>
                <p>
                  <span className="font-medium text-ink-800">Completa:</span>{' '}
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
                  <span className="font-medium text-ink-800">Meta:</span>{' '}
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

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-ink-200 bg-white px-6 py-4">
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
