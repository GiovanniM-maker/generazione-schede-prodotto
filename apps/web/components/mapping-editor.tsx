'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { confirmMappingAndImportAction } from '@/lib/actions/batches';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

interface ParsePreview {
  sourceFileId: string;
  headers: string[];
  previewRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>;
  duplicateFields: string[];
  totalRows: number;
}

const FIELDS: { key: string; label: string }[] = [
  { key: 'external_id', label: 'ID esterno' },
  { key: 'parent_external_id', label: 'ID padre' },
  { key: 'sku', label: 'SKU' },
  { key: 'product_name', label: 'Nome prodotto' },
  { key: 'product_type', label: 'Tipologia' },
  { key: 'category', label: 'Categoria' },
  { key: 'brand', label: 'Brand' },
  { key: 'gender', label: 'Genere' },
  { key: 'collection', label: 'Collezione' },
  { key: 'season', label: 'Stagione' },
  { key: 'color', label: 'Colore' },
  { key: 'secondary_color', label: 'Colore secondario' },
  { key: 'pattern', label: 'Fantasia' },
  { key: 'material', label: 'Materiale' },
  { key: 'composition', label: 'Composizione' },
  { key: 'fit', label: 'Vestibilità' },
  { key: 'neckline', label: 'Scollo' },
  { key: 'sleeve_length', label: 'Maniche' },
  { key: 'closure', label: 'Chiusura' },
  { key: 'length', label: 'Lunghezza' },
  { key: 'details', label: 'Dettagli' },
  { key: 'sizes', label: 'Taglie' },
  { key: 'measurements', label: 'Misure' },
  { key: 'care_instructions', label: 'Lavaggio' },
  { key: 'country_of_origin', label: 'Origine' },
  { key: 'sustainability_claims', label: 'Sostenibilità' },
  { key: 'other_facts', label: 'Altri fatti' },
  { key: 'image_names', label: 'Immagini' },
];

const IGNORE = '';
// Campi identificativi che non contano come "fatti aggiuntivi".
const NON_FACT = new Set([
  'external_id',
  'parent_external_id',
  'sku',
  'product_name',
  'product_type',
]);

export function MappingEditor({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Assegnazione per colonna: header -> fieldKey ('' = ignora).
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(`preview:${batchId}`);
    if (raw) {
      try {
        const p = JSON.parse(raw) as ParsePreview;
        setPreview(p);
        // Precompila dai suggerimenti (suggestedMapping è fieldKey -> header).
        const initial: Record<string, string> = {};
        for (const h of p.headers) initial[h] = IGNORE;
        for (const [field, header] of Object.entries(p.suggestedMapping)) {
          if (header in initial) initial[header] = field;
        }
        setAssign(initial);
      } catch {
        setPreview(null);
      }
    }
    setLoaded(true);
  }, [batchId]);

  // Header suggerito per ogni fieldKey (per mostrare il badge "suggerito").
  const suggestedByHeader = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (preview) {
      for (const header of Object.values(preview.suggestedMapping)) {
        map[header] = true;
      }
    }
    return map;
  }, [preview]);

  // Conteggio utilizzi per fieldKey per rilevare duplicati.
  const usage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const field of Object.values(assign)) {
      if (field !== IGNORE) counts[field] = (counts[field] ?? 0) + 1;
    }
    return counts;
  }, [assign]);

  const mappedFields = useMemo(
    () => Object.values(assign).filter((f) => f !== IGNORE),
    [assign],
  );

  const hasId =
    mappedFields.includes('external_id') || mappedFields.includes('sku');
  const hasName =
    mappedFields.includes('product_name') ||
    mappedFields.includes('product_type');
  const extraFacts = mappedFields.filter((f) => !NON_FACT.has(f)).length;
  const duplicates = Object.entries(usage)
    .filter(([, n]) => n > 1)
    .map(([field]) => field);

  const canConfirm =
    hasId && hasName && extraFacts >= 2 && duplicates.length === 0;

  function setField(header: string, field: string) {
    setAssign((prev) => ({ ...prev, [header]: field }));
  }

  function examplesFor(header: string): string {
    if (!preview) return '';
    const vals = preview.previewRows
      .map((r) => r[header])
      .filter((v): v is string => Boolean(v && v.trim()))
      .slice(0, 3);
    return vals.join(' · ');
  }

  async function confirm() {
    if (!preview || !canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const mapping: Record<string, string> = {};
      for (const [header, field] of Object.entries(assign)) {
        if (field !== IGNORE) mapping[field] = header;
      }
      await confirmMappingAndImportAction({
        batchId,
        sourceFileId: preview.sourceFileId,
        mapping,
      });
      sessionStorage.removeItem(`preview:${batchId}`);
      router.push(`/app/batches/${batchId}/input`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Importazione non riuscita');
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento…
      </div>
    );
  }

  if (!preview) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <div>
            <h2 className="font-semibold text-gray-900">
              Dati di anteprima non disponibili
            </h2>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              L’anteprima del file non è più in memoria (probabilmente la pagina
              è stata ricaricata). Ricarica il file per rifare la mappatura.
            </p>
          </div>
          <Link href="/app/batches/new">
            <Button>Ricarica il file</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const ignoredCount = preview.headers.filter(
    (h) => (assign[h] ?? IGNORE) === IGNORE,
  ).length;

  return (
    <div className="space-y-6">
      {/* Checklist requisiti */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Requirement ok={hasId} label="Identificativo (ID esterno o SKU)" />
            <Requirement
              ok={hasName}
              label="Nome o tipologia prodotto"
            />
            <Requirement
              ok={extraFacts >= 2}
              label={`Almeno 2 fatti aggiuntivi (${extraFacts})`}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>{preview.totalRows} righe rilevate</span>
            <span>·</span>
            <span>{preview.headers.length} colonne</span>
            <span>·</span>
            <span>{ignoredCount} ignorate</span>
          </div>
        </CardContent>
      </Card>

      {duplicates.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Più colonne sono assegnate allo stesso campo. Correggi le
            duplicazioni prima di continuare.
          </span>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Colonna originale</TH>
                <TH>Esempi di valori</TH>
                <TH className="w-64">Campo destinazione</TH>
              </TR>
            </THead>
            <TBody>
              {preview.headers.map((header) => {
                const field = assign[header] ?? IGNORE;
                const isDup = field !== IGNORE && (usage[field] ?? 0) > 1;
                return (
                  <TR key={header}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {header}
                        </span>
                        {suggestedByHeader[header] && (
                          <Badge tone="blue">
                            <Sparkles className="h-3 w-3" />
                            Suggerito
                          </Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="max-w-xs truncate text-gray-500">
                      {examplesFor(header) || (
                        <span className="text-gray-300">—</span>
                      )}
                    </TD>
                    <TD>
                      <Select
                        value={field}
                        onChange={(e) => setField(header, e.target.value)}
                        className={isDup ? 'border-amber-400' : ''}
                        aria-label={`Campo destinazione per ${header}`}
                      >
                        <option value={IGNORE}>(ignora)</option>
                        {FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                      {isDup && (
                        <p className="mt-1 text-xs text-amber-700">
                          Campo già assegnato a un’altra colonna
                        </p>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={confirm}
          disabled={!canConfirm || submitting}
          size="lg"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Importazione…
            </>
          ) : (
            'Conferma e importa'
          )}
        </Button>
      </div>
    </div>
  );
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={ok ? 'inline-flex items-center gap-1.5 text-emerald-700' : 'inline-flex items-center gap-1.5 text-gray-500'}
    >
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <span className="h-4 w-4 rounded-full border-2 border-gray-300" />
      )}
      {label}
    </span>
  );
}
