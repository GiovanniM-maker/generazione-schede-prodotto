'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Info, Copy } from 'lucide-react';
import {
  updateAttribute,
  type AttributeDetail,
  type AttributePatch,
} from '@/lib/actions/catalog';
import type { Json } from '@app/database';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const KIND_LABELS: Record<string, string> = {
  factual: 'Fattuale',
  derived: 'Derivato',
  generative: 'Generativo',
};

export function AttributeDetailClient({ detail }: { detail: AttributeDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const a = detail.attribute;

  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description ?? '');
  const [unit, setUnit] = useState(a.unit ?? '');
  const [enumValues, setEnumValues] = useState(a.enumValues.join(', '));
  const [extraction, setExtraction] = useState(a.extractionInstruction ?? '');
  const [generation, setGeneration] = useState(a.generationInstruction ?? '');
  const [validation, setValidation] = useState(
    prettyJson(a.validationRules),
  );
  const [normalization, setNormalization] = useState(
    prettyJson(a.normalizationRules),
  );

  function buildPatch(): AttributePatch | null {
    let validationRules: Json | undefined;
    let normalizationRules: Json | undefined;
    try {
      validationRules = validation.trim() ? JSON.parse(validation) : {};
    } catch {
      setError('Le regole di validazione non sono JSON valido');
      return null;
    }
    try {
      normalizationRules = normalization.trim()
        ? JSON.parse(normalization)
        : {};
    } catch {
      setError('Le regole di normalizzazione non sono JSON valido');
      return null;
    }
    return {
      name,
      description: description || null,
      unit: unit || null,
      enumValues: enumValues
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      extractionInstruction: extraction || null,
      generationInstruction: generation || null,
      validationRules,
      normalizationRules,
    };
  }

  function save() {
    setError(null);
    const patch = buildPatch();
    if (!patch) return;
    startTransition(async () => {
      const res = await updateAttribute({ attributeId: a.id, patch });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.forked) {
        router.push(`/app/settings/attributes/${res.attributeId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-900">{a.name}</h2>
            <Badge tone="blue">{a.sectorName}</Badge>
            <Badge tone="violet">
              {KIND_LABELS[a.attributeKind] ?? a.attributeKind}
            </Badge>
            {a.isSystem ? (
              <Badge tone="gray">Sistema</Badge>
            ) : (
              <Badge tone="green">Custom v{a.version}</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Tipo di dato: {a.dataType}
            {a.unit ? ` · unità ${a.unit}` : ''}
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : a.isSystem ? (
            <Copy className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {a.isSystem ? 'Modifica creando una copia personalizzata' : 'Salva'}
        </Button>
      </div>

      {a.isSystem && (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Attributo di sistema in sola lettura. Salvando le modifiche verrà
            creata una copia personalizzata della tua organizzazione, senza
            alterare l&apos;originale.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="d-name">Nome</Label>
            <Input
              id="d-name"
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="d-unit">Unità</Label>
            <Input
              id="d-unit"
              value={unit}
              disabled={pending}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="d-desc">Descrizione</Label>
          <Input
            id="d-desc"
            value={description}
            disabled={pending}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="d-enum">Esempi / valori enum (separati da virgola)</Label>
          <Input
            id="d-enum"
            value={enumValues}
            disabled={pending}
            onChange={(e) => setEnumValues(e.target.value)}
            placeholder="Es. rosso, blu, verde"
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="text-base font-semibold text-gray-900">Prompt</h3>
        <div>
          <Label htmlFor="d-extr">Prompt di estrazione</Label>
          <Textarea
            id="d-extr"
            rows={4}
            value={extraction}
            disabled={pending}
            onChange={(e) => setExtraction(e.target.value)}
            placeholder="Come estrarre il valore dai dati di input…"
          />
        </div>
        <div>
          <Label htmlFor="d-gen">Prompt di generazione</Label>
          <Textarea
            id="d-gen"
            rows={4}
            value={generation}
            disabled={pending}
            onChange={(e) => setGeneration(e.target.value)}
            placeholder="Come usare il valore nella copy generata…"
          />
        </div>
        <p className="text-xs text-gray-400">
          Le modifiche hanno effetto sulla prossima esecuzione.
        </p>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="text-base font-semibold text-gray-900">Regole</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="d-valid">Regole di validazione (JSON)</Label>
            <Textarea
              id="d-valid"
              rows={6}
              value={validation}
              disabled={pending}
              onChange={(e) => setValidation(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="d-norm">Regole di normalizzazione (JSON)</Label>
            <Textarea
              id="d-norm"
              rows={6}
              value={normalization}
              disabled={pending}
              onChange={(e) => setNormalization(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 text-base font-semibold text-gray-900">
            Categorie che lo usano
          </h3>
          {detail.usedByCategories.length === 0 ? (
            <p className="text-sm text-gray-400">Nessuna categoria.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {detail.usedByCategories.map((c) => (
                <a
                  key={c.id}
                  href={`/app/settings/categories/${c.id}`}
                  className="rounded-full border border-gray-200 px-3 py-1 text-sm text-brand-accent hover:bg-gray-50"
                >
                  {c.name}
                </a>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-base font-semibold text-gray-900">
            Preset che lo usano
          </h3>
          {detail.usedByPresets.length === 0 ? (
            <p className="text-sm text-gray-400">Nessun preset.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {detail.usedByPresets.map((p) => (
                <a
                  key={p.id}
                  href={`/app/settings/presets/${p.id}`}
                  className="rounded-full border border-gray-200 px-3 py-1 text-sm text-brand-accent hover:bg-gray-50"
                >
                  {p.name}
                </a>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function prettyJson(value: Json): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}
