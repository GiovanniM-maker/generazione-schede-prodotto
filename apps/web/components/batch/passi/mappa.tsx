'use client';

import { Loader2 } from 'lucide-react';
import { getBatchCategoryOptions, type PresetAttributeOption } from '@/lib/actions/batch-wizard';
import { HelpBubble } from '@/components/onboarding/help-bubble';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { AnalyzeData } from '@/components/batch/passi/tipi';
import { Metric, SkuList, OptionRow } from '@/components/batch/passi/pezzi';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// MAPPA — far combaciare quello che è arrivato con quello che serve.
//
// Passi 6, 7 e 8: l'analisi dei file, l'associazione degli SKU e
// l'accostamento fra colonne e attributi del preset.
// ---------------------------------------------------------------------------

export function Step6({ analysis, hasImages, hasSpreadsheet }: { analysis: AnalyzeData | null; hasImages: boolean; hasSpreadsheet: boolean }) {
  if (analysis === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Analisi in corso…
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">Risultato del confronto tra le sorgenti (unione tramite SKU esatto).</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="SKU totali unici" value={analysis.totalUniqueSkus} tone="gray" />
        {hasSpreadsheet && hasImages && <Metric label="SKU in entrambe le fonti" value={analysis.inBoth.length} tone="gray" />}
        {hasSpreadsheet && <Metric label="Solo nel file" value={analysis.onlyFile.length} tone={analysis.onlyFile.length > 0 ? 'amber' : 'gray'} />}
        {hasImages && <Metric label="Solo nelle immagini" value={analysis.onlyImages.length} tone={analysis.onlyImages.length > 0 ? 'amber' : 'gray'} />}
        {hasSpreadsheet && <Metric label="SKU duplicati nel file" value={analysis.duplicateFileSkus.length} tone={analysis.duplicateFileSkus.length > 0 ? 'red' : 'gray'} />}
        {hasSpreadsheet && <Metric label="Righe senza SKU" value={analysis.rowsWithoutSku} tone={analysis.rowsWithoutSku > 0 ? 'red' : 'gray'} />}
        {hasImages && <Metric label="Immagini senza SKU" value={analysis.filesWithoutSku.length} tone={analysis.filesWithoutSku.length > 0 ? 'amber' : 'gray'} />}
      </div>
      {/* Il numero rosso diceva che c'era un problema e si fermava lì. Questo
          dice cosa succederà, e dove si vedrà a chi è successo. */}
      {hasSpreadsheet && analysis.duplicateFileSkus.length > 0 && (
        <p className="text-sm text-amber-800">
          Con lo stesso codice ripetuto entra <strong>la prima riga</strong>: le altre vengono
          scartate. Dopo l’importazione trovi l’elenco di quali, riga per riga.
        </p>
      )}
    </div>
  );
}

export function Step7({
  analysis,
  hasImages,
  hasSpreadsheet,
  headers,
  skuHeader,
  setSkuHeader,
  nameHeader,
  setNameHeader,
  categoryHeader,
  setCategoryHeader,
  parentHeader,
  setParentHeader,
  importOption,
  setImportOption,
  batchId,
  previewRows,
  categoryOverrides,
  setCategoryOverrides,
}: {
  analysis: AnalyzeData | null;
  hasImages: boolean;
  hasSpreadsheet: boolean;
  headers: string[];
  skuHeader: string;
  setSkuHeader: (v: string) => void;
  nameHeader: string;
  setNameHeader: (v: string) => void;
  categoryHeader: string;
  setCategoryHeader: (v: string) => void;
  parentHeader: string;
  setParentHeader: (v: string) => void;
  importOption: 'complete' | 'includeImageOnly' | 'excludeIncomplete';
  setImportOption: (v: 'complete' | 'includeImageOnly' | 'excludeIncomplete') => void;
  batchId: string | null;
  previewRows: Array<Record<string, string>>;
  categoryOverrides: Record<string, string>;
  setCategoryOverrides: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  return (
    <div className="space-y-6">
      {hasSpreadsheet && (
        <div data-tour="sku-column">
          <Label htmlFor="sku-header">
            Colonna SKU{' '}
            <HelpBubble text="Lo SKU è il codice univoco del prodotto: collega righe del file, foto e schede generate. Le righe senza SKU vengono scartate." />
          </Label>
          <Select id="sku-header" value={skuHeader} onChange={(e) => setSkuHeader(e.target.value)}>
            <option value="">— Seleziona la colonna SKU —</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-ink-500">Le righe senza SKU in questa colonna verranno scartate.</p>
        </div>
      )}

      {hasSpreadsheet && (
        <div className="rounded-lg border border-ink-200 p-4">
          <Label htmlFor="name-header">
            Colonna Nome prodotto
            <HelpBubble text="Come si chiama il prodotto nel tuo file. È il titolo che vedrai nei risultati e il punto di partenza della scheda. Senza, il prodotto si chiama come il suo codice." />
          </Label>
          <Select id="name-header" value={nameHeader} onChange={(e) => setNameHeader(e.target.value)}>
            <option value="">— Nessuna colonna: userò il codice come nome —</option>
            {headers.map((h) => (
              <option key={h} value={h} disabled={h === skuHeader}>
                {h}
                {h === skuHeader ? ' (colonna SKU)' : ''}
              </option>
            ))}
          </Select>
          {nameHeader === '' && (
            <p className="mt-1.5 text-xs text-amber-700">
              Senza questa colonna i prodotti si chiameranno come il loro codice
              (es. <span className="font-mono">OLI-001</span>).
            </p>
          )}
        </div>
      )}

      {hasSpreadsheet && (
        <div className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 p-4" data-tour="category-column">
          <Label htmlFor="category-header">Colonna Categoria (consigliata)</Label>
          <Select
            id="category-header"
            value={categoryHeader}
            onChange={(e) => setCategoryHeader(e.target.value)}
          >
            <option value="">— Nessuna colonna: la categoria viene dedotta dall’AI dalle foto —</option>
            {headers.map((h) => (
              <option key={h} value={h} disabled={h === skuHeader}>
                {h}
                {h === skuHeader ? ' (colonna SKU)' : ''}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-ink-600">
            La categoria di ogni prodotto viene presa da questa colonna e agganciata in automatico al
            tuo catalogo (nessuna AI). <strong>Decide quali attributi e istruzioni del preset vengono
            usati in generazione</strong>: un Vino riceve gli attributi del vino, non quelli della
            carne. Se scegli una colonna, l&apos;AI <strong>non deduce la categoria dalle foto</strong>.
          </p>
          {categoryHeader && batchId && (
            <CategoryColumnValidator
              batchId={batchId}
              header={categoryHeader}
              previewRows={previewRows}
              overrides={categoryOverrides}
              setOverrides={setCategoryOverrides}
            />
          )}
        </div>
      )}

      {hasSpreadsheet && (
        <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
          <Label htmlFor="parent-header">Colonna «codice padre» — varianti colore/taglia (facoltativa)</Label>
          <Select
            id="parent-header"
            value={parentHeader}
            onChange={(e) => setParentHeader(e.target.value)}
          >
            <option value="">— Nessuna: ogni riga è un prodotto a sé —</option>
            {headers.map((h) => (
              <option key={h} value={h} disabled={h === skuHeader}>
                {h}
                {h === skuHeader ? ' (colonna SKU)' : ''}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-ink-600">
            Se il tuo file ha una colonna che indica il <strong>prodotto padre</strong> (es. il codice
            modello condiviso da tutte le taglie/colori), selezionala qui: le righe con lo stesso
            codice vengono <strong>raggruppate come varianti</strong> e nell’export mantengono il
            legame padre → varianti (utile per Shopify/Woo).
          </p>
        </div>
      )}

      {hasImages && hasSpreadsheet && analysis && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SkuList title="In entrambe le fonti" skus={analysis.inBoth} tone="green" />
          <SkuList title="Solo nel file" skus={analysis.onlyFile} tone="amber" />
          <SkuList title="Solo nelle immagini" skus={analysis.onlyImages} tone="amber" />
          <SkuList title="Duplicati nel file" skus={analysis.duplicateFileSkus} tone="red" />
          {analysis.filesWithoutSku.length > 0 && <SkuList title="Immagini senza SKU" skus={analysis.filesWithoutSku} tone="red" />}
        </div>
      )}

      <div>
        <Label>Come procedere</Label>
        <div className="space-y-2">
          <OptionRow checked={importOption === 'complete'} onSelect={() => setImportOption('complete')} title="Continua con i prodotti completi" description="Importa i prodotti con SKU valido; i solo-immagini restano esclusi." />
          {hasImages && (
            <OptionRow checked={importOption === 'includeImageOnly'} onSelect={() => setImportOption('includeImageOnly')} title="Includi anche i prodotti solo-immagini" description="Crea un prodotto anche per gli SKU presenti solo tra le immagini." />
          )}
          <OptionRow checked={importOption === 'excludeIncomplete'} onSelect={() => setImportOption('excludeIncomplete')} title="Escludi i prodotti incompleti" description="Scarta i prodotti che non raggiungono i requisiti minimi di qualità." />
        </div>
      </div>
    </div>
  );
}

export function Step8({
  attributes,
  headers,
  mapping,
  setMapping,
  skuHeader,
  nameHeader,
  categoryHeader,
  extraCols,
  setExtraCols,
}: {
  attributes: PresetAttributeOption[] | null;
  headers: string[];
  mapping: Record<string, string>;
  setMapping: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  skuHeader: string;
  nameHeader: string;
  categoryHeader: string;
  extraCols: Record<string, string>;
  setExtraCols: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  if (attributes === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Caricamento attributi…
      </div>
    );
  }
  // Colonne non ancora usate (né SKU, né Nome, né Categoria, né mappate).
  const usedHeaders = new Set<string>([skuHeader, nameHeader, categoryHeader, ...Object.values(mapping)].filter(Boolean));
  const importableAll = headers.filter((h) => !usedHeaders.has(h));
  const importedCount = importableAll.filter((h) => h in extraCols).length;
  function includeAll() {
    setExtraCols((prev) => {
      const next = { ...prev };
      for (const h of importableAll) if (!(h in next)) next[h] = h;
      return next;
    });
  }
  function excludeAll() {
    setExtraCols((prev) => {
      const next = { ...prev };
      for (const h of importableAll) delete next[h];
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Include/escludi: di default tutte le colonne sono dati; togli quelle inutili. */}
      <div className="rounded-lg border border-brand-accent/30 bg-brand-soft/50 p-4">
        <p className="text-sm font-semibold text-ink-900">Colonne importate come dati</p>
        <p className="mt-0.5 text-xs text-ink-600">
          Ogni colonna del file diventa un&apos;informazione per lo SKU (es. peso, descrizione): non
          devi mappare nulla. <strong>Escludi</strong> qui sotto solo le colonne che non ti servono
          (es. costo interno). L&apos;unica cosa da mappare è la <strong>Categoria</strong> (già
          scelta). Le info restano sotto l&apos;audit anti-invenzione.
        </p>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="text-ink-500">{importedCount}/{importableAll.length} colonne incluse</span>
          <button type="button" onClick={includeAll} className="font-medium text-brand-accent hover:underline">Includi tutte</button>
          <button type="button" onClick={excludeAll} className="font-medium text-ink-500 hover:underline">Escludi tutte</button>
        </div>
      </div>

      <details className="rounded-lg border border-ink-100">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink-700">
          Mappatura avanzata (facoltativa): abbina attributi del preset a colonne specifiche
        </summary>
        <div className="space-y-2 p-3" data-tour="mapping">
        {attributes.map((attr) => (
          <div key={attr.id} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-ink-100 p-3 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-800">{attr.name}</span>
              {attr.isRequired && <Badge tone="amber">obbligatorio</Badge>}
            </div>
            <Select
              aria-label={`Colonna del file per «${attr.name}»`}
              value={mapping[attr.id] ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setMapping((prev) => {
                  const next = { ...prev };
                  if (v) next[attr.id] = v;
                  else delete next[attr.id];
                  return next;
                });
              }}
            >
              <option value="">— Nessuna colonna —</option>
              {headers.map((h) => (
                <option
                  key={h}
                  value={h}
                  disabled={h === skuHeader || h === nameHeader || h === categoryHeader}
                >
                  {h}
                  {h === skuHeader ? ' (colonna SKU)' : ''}
                  {h === nameHeader ? ' (colonna Nome)' : ''}
                  {h === categoryHeader ? ' (colonna Categoria)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ))}
        </div>
      </details>

      <FreeColumnsSection
        headers={headers}
        mapping={mapping}
        skuHeader={skuHeader}
        categoryHeader={categoryHeader}
        extraCols={extraCols}
        setExtraCols={setExtraCols}
      />
    </div>
  );
}

/**
 * "Altre colonne del file": qualsiasi colonna non ancora usata può essere
 * importata come dato in più (fatto passato all'AI). Il nome è modificabile.
 */
export function FreeColumnsSection({
  headers,
  mapping,
  skuHeader,
  categoryHeader,
  extraCols,
  setExtraCols,
}: {
  headers: string[];
  mapping: Record<string, string>;
  skuHeader: string;
  categoryHeader: string;
  extraCols: Record<string, string>;
  setExtraCols: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const used = new Set<string>([skuHeader, categoryHeader, ...Object.values(mapping)].filter(Boolean));
  const available = headers.filter((h) => !used.has(h));
  if (available.length === 0) return null;
  return (
    <div className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 p-4" data-tour="extra-columns">
      <p className="text-sm font-medium text-ink-800">Colonne da importare (togli la spunta per escludere)</p>
      <p className="mt-0.5 text-xs text-ink-600">
        Di default vengono importate tutte come dato. <strong>Togli la spunta</strong> a quelle che
        non ti servono (es. «costo interno»). Puoi anche rinominare il campo. Ogni dato resta sotto
        l’audit anti-invenzione.
      </p>
      <div className="mt-3 space-y-2">
        {available.map((h) => {
          const checked = h in extraCols;
          return (
            <div key={h} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[auto_1fr_1fr]">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setExtraCols((prev) => {
                      const next = { ...prev };
                      if (on) next[h] = h;
                      else delete next[h];
                      return next;
                    });
                  }}
                  className="h-4 w-4 rounded border-ink-300"
                />
                <span className="font-mono text-xs text-ink-600">{h}</span>
              </label>
              {checked ? (
                <>
                  <span className="hidden text-center text-xs text-ink-500 sm:block">→</span>
                  <Input
                    value={extraCols[h] ?? h}
                    onChange={(e) =>
                      setExtraCols((prev) => ({ ...prev, [h]: e.target.value }))
                    }
                    placeholder="Nome del campo"
                    aria-label={`Nome del campo per ${h}`}
                  />
                </>
              ) : (
                <span className="text-xs text-ink-500 sm:col-span-2">non importata</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CategoryColumnValidator({
  batchId,
  header,
  previewRows,
  overrides,
  setOverrides,
}: {
  batchId: string;
  header: string;
  previewRows: Array<Record<string, string>>;
  overrides: Record<string, string>;
  setOverrides: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [fromPreset, setFromPreset] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getBatchCategoryOptions({ batchId })
      .then((r) => {
        if (!active) return;
        if (r.ok) {
          setCats(r.data.categories);
          setFromPreset(r.data.fromPreset);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [batchId]);

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  if (loading) return <p className="mt-2 text-xs text-ink-500">Verifico i valori della colonna…</p>;
  if (cats.length === 0) return null;

  const catByNorm = new Map(cats.map((c) => [norm(c.name), c] as const));
  const matchOf = (value: string) => {
    const n = norm(value);
    const exact = catByNorm.get(n);
    if (exact) return exact;
    return cats.find((c) => {
      const cn = norm(c.name);
      return cn && (n.includes(cn) || cn.includes(n));
    });
  };

  const values = [...new Set(previewRows.map((r) => (r[header] ?? '').trim()).filter(Boolean))];
  const rows = values.map((v) => ({ value: v, match: matchOf(v) }));
  const unresolved = rows.filter((r) => !r.match && !overrides[r.value]);
  const okCount = rows.length - unresolved.length;

  return (
    <div
      className={cn(
        'mt-3 rounded-lg border p-3',
        unresolved.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50',
      )}
    >
      <p className={cn('text-xs font-medium', unresolved.length > 0 ? 'text-amber-900' : 'text-emerald-800')}>
        {unresolved.length > 0
          ? `${unresolved.length} valore/i della colonna «${header}» non corrisponde a nessuna categoria: rimappalo qui sotto.`
          : `Tutti i valori della colonna «${header}» corrispondono a una categoria (${okCount}/${rows.length}).`}
      </p>
      {unresolved.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {unresolved.map((r) => (
            <div key={r.value} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-2">
              <span className="truncate text-sm text-amber-900" title={r.value}>
                «{r.value}»
              </span>
              <Select
                aria-label={`Categoria per «${r.value}»`}
                value={overrides[r.value] ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setOverrides((prev) => {
                    const next = { ...prev };
                    if (v) next[r.value] = v;
                    else delete next[r.value];
                    return next;
                  });
                }}
              >
                <option value="">— Scegli la categoria giusta —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-ink-500">
        Confronto con le {cats.length} categorie{' '}
        {fromPreset ? 'del preset scelto' : 'del settore (il preset non ne ha nessuna configurata)'}.
        Verifica basata sull&apos;anteprima ({previewRows.length} righe). I valori nuovi che compaiono
        oltre l&apos;anteprima potrai correggerli al passo «Verifica dati».
      </p>
    </div>
  );
}
