'use client';

import { Loader2 } from 'lucide-react';
import { type BatchProductRow, type ImportResultV2 } from '@/lib/actions/batch-wizard';
import { CategoryAssigner } from '@/components/batch/category-assigner';
import { ImageQcPanel } from '@/components/batch/image-qc-panel';
import { Avviso } from '@/components/ui/avviso';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

// RIPARA — quello che non torna, prima di spendere crediti.
//
// Passo 9: la verifica dei dati riga per riga. È l'unico passo che chiede di
// mettere le mani nei dati, ed è quello che salva i crediti.
// ---------------------------------------------------------------------------

export function Step9({
  products,
  importSummary,
  batchId,
  hasImages,
  analyzing,
  analyzeProgress,
  categoryFromFile,
}: {
  products: BatchProductRow[] | null;
  importSummary: ImportResultV2 | null;
  batchId: string;
  hasImages: boolean;
  analyzing: boolean;
  analyzeProgress: { done: number; total: number } | null;
  categoryFromFile: boolean;
}) {
  if (products === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Importazione dei prodotti…
      </div>
    );
  }
  const senzaCategoria = products.filter((p) => !p.category).length;
  const pct =
    analyzeProgress && analyzeProgress.total > 0
      ? Math.min(100, Math.round((analyzeProgress.done / analyzeProgress.total) * 100))
      : null;
  return (
    <div className="space-y-4">
      {hasImages && analyzing && (
        <div className="space-y-2 rounded-lg border border-brand-accent/20 bg-brand-soft/60 p-3" data-tour="analyze">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-accent">
            <Loader2 className="h-4 w-4 animate-spin" />
            {categoryFromFile
              ? 'Analisi foto: leggo le etichette per estrarre i dati (la categoria la prendo dal file)…'
              : 'Analisi automatica delle foto: leggo le etichette e deduco la categoria…'}
          </div>
          <div className="flex items-center justify-between text-xs text-brand-accent/80">
            <span>
              {analyzeProgress ? `${analyzeProgress.done} / ${analyzeProgress.total} prodotti` : 'Avvio…'}
            </span>
            <span>{pct !== null ? `${pct}%` : ''}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/60">
            <div
              className="h-full rounded-full bg-brand-accent transition-all duration-500"
              style={{ width: `${pct ?? 5}%` }}
            />
          </div>
          <p className="text-xs text-brand-accent/80">
            <strong>Puoi chiudere questa pagina</strong>: l&apos;analisi prosegue da sola e riprende
            da dove è arrivata. Resta qui solo se vuoi rivedere le categorie prima di generare.
          </p>
        </div>
      )}
      {hasImages && !analyzing && (
        <p className="rounded-lg border border-ink-100 bg-ink-50 p-3 text-sm text-ink-600">
          Foto analizzate: i dati leggibili sull’etichetta sono stati usati come fatti. Materiali,
          composizione e dati tecnici non deducibili dalle foto restano da inserire.
        </p>
      )}
      {!analyzing && senzaCategoria > 0 && (
        <Avviso tono="attenzione">
          <strong>{senzaCategoria} prodotti senza categoria.</strong> Senza categoria le schede
          escono generiche (mancano i campi specifici del prodotto). Assegna una categoria qui
          sotto prima di continuare.
        </Avviso>
      )}
      {importSummary && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="blue">{importSummary.imported} importati</Badge>
          <Badge tone="green">{importSummary.valid} validi</Badge>
          {/* Diceva «da rivedere»: una parola che promette una revisione che
              non esiste da nessuna parte. Sono righe **scartate**, e adesso si
              può anche vedere quali. */}
          <Badge tone="amber">{importSummary.invalid} righe scartate</Badge>
          {importSummary.imageOnly > 0 && <Badge tone="violet">{importSummary.imageOnly} solo-immagini</Badge>}
          {/* Prodotti entrati senza i loro dati: il database ha rifiutato la
              scrittura. Prima finiva solo nella telemetria e l'utente scopriva
              il buco a generazione fatta. */}
          {importSummary.factsInsertErrors > 0 && (
            <Badge tone="red">{importSummary.factsInsertErrors} senza dati (scrittura rifiutata)</Badge>
          )}
          {/* Era il caso di TUTTI i prodotti di ogni catalogo, e nessuno lo
              diceva: si scopriva guardando i risultati. */}
          {importSummary.senzaNome > 0 && (
            <Badge tone="amber">{importSummary.senzaNome} col codice al posto del nome</Badge>
          )}
          {importSummary.categoriesMatched > 0 && (
            <Badge tone="green">{importSummary.categoriesMatched} collegati a categoria</Badge>
          )}
          {importSummary.scartate.length > 0 && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm text-ink-600 underline underline-offset-2">
                Quali righe sono state scartate
              </summary>
              <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-ink-200 bg-white p-2 text-xs">
                {importSummary.scartate.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-1 py-0.5">
                    <span className="truncate font-mono text-ink-700">{r.sku ?? '(senza codice)'}</span>
                    <span className="shrink-0 text-ink-500">{r.motivo}</span>
                  </li>
                ))}
              </ul>
              {importSummary.invalid > importSummary.scartate.length && (
                <p className="mt-1 text-xs text-ink-500">
                  Elenco tagliato alle prime {importSummary.scartate.length}: serve a capire cosa è
                  successo, non a rifare l’import.
                </p>
              )}
            </details>
          )}
          {importSummary.unmatchedCategories.length > 0 && (
            <Badge tone="amber">
              {importSummary.unmatchedCategories.length} categorie non riconosciute
            </Badge>
          )}
        </div>
      )}
      {importSummary && importSummary.unmatchedCategories.length > 0 && (
        <p className="text-xs text-amber-700">
          Categorie nel file non presenti nel catalogo:{' '}
          {importSummary.unmatchedCategories.slice(0, 8).join(', ')}
          {importSummary.unmatchedCategories.length > 8 ? '…' : ''}. Puoi crearle da
          Impostazioni → Categorie (Importa lista) e reimportare.
        </p>
      )}
      {products.length > 0 && (
        <div data-tour="assign-categories">
          <CategoryAssigner batchId={batchId} reloadKey={analyzing ? (analyzeProgress?.done ?? 0) : -1} />
        </div>
      )}
      {products.length === 0 ? (
        <p className="text-sm text-ink-500">Nessun prodotto importato. Torna indietro e controlla la colonna SKU o le sorgenti.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>SKU</TH>
              <TH>Nome</TH>
              <TH>Categoria</TH>
              <TH>Qualità</TH>
              <TH>Attributi</TH>
              <TH>Immagini</TH>
              <TH>Stato</TH>
            </TR>
          </THead>
          <TBody>
            {products.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium text-ink-900">{p.sku ?? '—'}</TD>
                <TD>{p.name ?? '—'}</TD>
                <TD>{p.category ?? '—'}</TD>
                <TD>
                  <Badge tone={p.quality >= 80 ? 'green' : p.quality >= 60 ? 'amber' : 'red'}>{p.quality}</Badge>
                </TD>
                <TD>{p.attributesCount}</TD>
                <TD>{p.imagesCount}</TD>
                <TD>
                  <Badge tone={p.status === 'eligible' ? 'green' : 'gray'}>{p.status}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {hasImages && !analyzing && (
        <ImageQcPanel batchId={batchId} reloadKey={analyzeProgress?.done ?? 0} />
      )}
    </div>
  );
}
