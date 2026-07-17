'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, Copy, Info, Save } from 'lucide-react';
import {
  addAttributeToCategory,
  removeAttributeFromCategory,
  setCategoryAttribute,
  duplicateSystemCategory,
  type CategoryDetail,
  type CategoryAttrRow,
} from '@/lib/actions/catalog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Modal, ConfirmDialog } from '@/components/settings/modal';

const KIND_LABELS: Record<string, string> = {
  factual: 'Fattuale',
  derived: 'Derivato',
  generative: 'Generativo',
};

export function CategoryDetailClient({ detail }: { detail: CategoryDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const editable = !detail.category.isSystem;

  function duplicate() {
    setError(null);
    startTransition(async () => {
      const res = await duplicateSystemCategory({
        categoryId: detail.category.id,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/app/settings/categories/${res.categoryId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-900">
              {detail.category.name}
            </h2>
            <Badge tone="blue">{detail.category.sectorName}</Badge>
            {detail.category.isSystem ? (
              <Badge tone="gray">Sistema</Badge>
            ) : (
              <Badge tone="violet">Personalizzata</Badge>
            )}
          </div>
          {detail.category.description && (
            <p className="mt-1 text-sm text-gray-500">
              {detail.category.description}
            </p>
          )}
        </div>
        {detail.category.isSystem && (
          <Button size="sm" onClick={duplicate} disabled={pending}>
            <Copy className="h-4 w-4" />
            Duplica per personalizzare
          </Button>
        )}
      </div>

      {detail.category.isSystem && (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Questa è una categoria di sistema in sola lettura. Duplicala per
            modificarne attributi e prompt.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Attributi</h3>
          {editable && (
            <Button
              variant="outline"
              size="sm"
              disabled={detail.availableAttributes.length === 0}
              onClick={() => {
                setError(null);
                setAddOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Aggiungi attributo
            </Button>
          )}
        </div>

        {detail.attributes.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            Nessun attributo collegato.
          </p>
        ) : (
          <div className="space-y-4">
            {detail.attributes.map((a) => (
              <CategoryAttributeRow
                key={a.id}
                attr={a}
                editable={editable}
                onError={setError}
              />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 text-base font-semibold text-gray-900">
          Preset che la usano
        </h3>
        {detail.usedByPresets.length === 0 ? (
          <p className="text-sm text-gray-400">Nessun preset la utilizza.</p>
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

      <AddAttributeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        available={detail.availableAttributes}
        categoryId={detail.category.id}
        onError={setError}
      />
    </div>
  );
}

function CategoryAttributeRow({
  attr,
  editable,
  onError,
}: {
  attr: CategoryAttrRow;
  editable: boolean;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [extraction, setExtraction] = useState(attr.extractionOverride ?? '');
  const [generation, setGeneration] = useState(attr.generationOverride ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const dirty =
    extraction !== (attr.extractionOverride ?? '') ||
    generation !== (attr.generationOverride ?? '');

  function persist(patch: Parameters<typeof setCategoryAttribute>[0]) {
    onError(null);
    startTransition(async () => {
      const res = await setCategoryAttribute(patch);
      if (!res.ok) {
        onError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{attr.name}</span>
          <Badge tone="violet">
            {KIND_LABELS[attr.attributeKind] ?? attr.attributeKind}
          </Badge>
          <span className="text-xs text-gray-400">{attr.dataType}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={attr.isRequired}
              disabled={!editable || pending}
              onChange={(e) =>
                persist({ id: attr.id, isRequired: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300"
            />
            Obbligatorio
          </label>
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmRemove(true)}
              title="Rimuovi attributo"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Prompt di estrazione
          </label>
          <Textarea
            rows={3}
            value={extraction}
            disabled={!editable}
            placeholder={attr.defaultExtraction ?? 'Istruzione predefinita'}
            onChange={(e) => setExtraction(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Prompt di generazione
          </label>
          <Textarea
            rows={3}
            value={generation}
            disabled={!editable}
            placeholder={attr.defaultGeneration ?? 'Istruzione predefinita'}
            onChange={(e) => setGeneration(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Le modifiche hanno effetto sulla prossima generazione.
        </p>
        {editable && dirty && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              persist({
                id: attr.id,
                extractionOverride: extraction,
                generationOverride: generation,
              })
            }
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salva prompt
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="Rimuovi attributo"
        message={`Rimuovere "${attr.name}" dalla categoria?`}
        confirmLabel="Rimuovi"
        busy={pending}
        onConfirm={() => {
          setConfirmRemove(false);
          onError(null);
          startTransition(async () => {
            const res = await removeAttributeFromCategory({ id: attr.id });
            if (!res.ok) {
              onError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}

function AddAttributeModal({
  open,
  onClose,
  available,
  categoryId,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  available: {
    id: string;
    name: string;
    attributeKind: string;
    dataType: string;
  }[];
  categoryId: string;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState('');

  function submit() {
    const attributeId = value || available[0]?.id;
    if (!attributeId) return;
    onError(null);
    startTransition(async () => {
      const res = await addAttributeToCategory({ categoryId, attributeId });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Aggiungi attributo">
      <div className="space-y-4">
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          {available.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.dataType}
            </option>
          ))}
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Annulla
          </Button>
          <Button size="sm" onClick={submit} disabled={pending}>
            Aggiungi
          </Button>
        </div>
      </div>
    </Modal>
  );
}
