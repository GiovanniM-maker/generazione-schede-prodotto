'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  Sparkles,
  Rocket,
  Info,
  Save,
  ClipboardList,
  Eraser,
} from 'lucide-react';
import {
  addCategoryToPreset,
  removeCategoryFromPreset,
  addAttributeToPreset,
  addAttributesFromListToPreset,
  addCategoriesFromListToPreset,
  removeAttributeFromPreset,
  setPresetAttribute,
  publishPresetVersion,
  clearPresetVersion,
  ensureDraftVersion,
  type PresetDetail,
  type PresetAttrRow,
} from '@/lib/actions/catalog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Modal, ConfirmDialog } from '@/components/settings/modal';
import { PresetCopilotPanel } from '@/components/settings/preset-copilot-panel';

const KIND_LABELS: Record<string, string> = {
  factual: 'Fattuale',
  derived: 'Derivato',
  generative: 'Generativo',
};

export function PresetDetailClient({ detail }: { detail: PresetDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedCat, setSelectedCat] = useState<string | null>(
    detail.categories[0]?.categoryId ?? null,
  );

  const editable = detail.isDraft;

  const [addCatOpen, setAddCatOpen] = useState(false);
  const [addAttrOpen, setAddAttrOpen] = useState(false);
  const [removeCatTarget, setRemoveCatTarget] = useState<string | null>(null);
  const [importAttrOpen, setImportAttrOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importDataType, setImportDataType] = useState('text');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importCatOpen, setImportCatOpen] = useState(false);
  const [importCatText, setImportCatText] = useState('');
  const [importCatMsg, setImportCatMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  function handleImportAttrs() {
    setError(null);
    setImportMsg(null);
    startTransition(async () => {
      const res = await addAttributesFromListToPreset({
        presetVersionId: detail.workingVersionId,
        text: importText,
        dataType: importDataType,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImportText('');
      setImportMsg(
        `${res.added} attributi aggiunti al preset (${res.created} nuovi creati).`,
      );
      router.refresh();
    });
  }

  function handleImportCats() {
    setError(null);
    setImportCatMsg(null);
    startTransition(async () => {
      const res = await addCategoriesFromListToPreset({
        presetVersionId: detail.workingVersionId,
        text: importCatText,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImportCatText('');
      setImportCatMsg(`${res.added} categorie aggiunte al preset (${res.created} nuove create).`);
      router.refresh();
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function createDraft() {
    setError(null);
    startTransition(async () => {
      const res = await ensureDraftVersion({ presetId: detail.preset.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const current = detail.categories.find((c) => c.categoryId === selectedCat);

  return (
    <div className="space-y-4">
      {/* Intestazione */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-900">
              {detail.preset.name}
            </h2>
            <Badge tone="blue">{detail.preset.sectorName}</Badge>
            {detail.isDraft ? (
              <Badge tone="amber">Bozza v{detail.workingVersion}</Badge>
            ) : (
              <Badge tone="green">Pubblicato v{detail.workingVersion}</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Configura categorie, attributi e prompt del preset.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setCopilotOpen(true);
            }}
            title={
              editable
                ? 'Costruisci il preset con l’AI'
                : 'Verrà creata una bozza per applicare le modifiche'
            }
          >
            <Sparkles className="h-4 w-4" />
            Chiedi al Copilot
          </Button>
          {editable && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setImportCatMsg(null);
                  setImportCatOpen(true);
                }}
              >
                <ClipboardList className="h-4 w-4" />
                Categorie da lista
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setImportMsg(null);
                  setImportAttrOpen(true);
                }}
              >
                <ClipboardList className="h-4 w-4" />
                Attributi da lista
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                title="Rimuovi tutte le categorie e gli attributi dalla bozza"
                onClick={() => {
                  setError(null);
                  setConfirmClear(true);
                }}
              >
                <Eraser className="h-4 w-4" />
                Svuota
              </Button>
            </>
          )}
          {editable ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  publishPresetVersion({ presetId: detail.preset.id }),
                )
              }
            >
              <Rocket className="h-4 w-4" />
              Pubblica versione
            </Button>
          ) : (
            <Button size="sm" onClick={createDraft} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Crea bozza per modificare
            </Button>
          )}
        </div>
      </div>

      {!editable && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Questo preset è pubblicato. Per modificarlo verrà creata una nuova
            bozza: le versioni pubblicate restano invariate.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        {/* Sidebar categorie */}
        <Card className="h-fit p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Categorie
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {detail.categories.map((c) => (
              <button
                key={c.presetCategoryId}
                onClick={() => setSelectedCat(c.categoryId)}
                className={cn(
                  'flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  selectedCat === c.categoryId
                    ? 'bg-brand-accent/10 text-brand-accent'
                    : 'text-gray-600 hover:bg-gray-100',
                )}
              >
                <span className="truncate">{c.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {c.attributes.length}
                </span>
              </button>
            ))}
            {detail.categories.length === 0 && (
              <p className="px-2 py-3 text-xs text-gray-400">
                Nessuna categoria.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            disabled={!editable || detail.availableCategories.length === 0}
            onClick={() => {
              setError(null);
              setAddCatOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Aggiungi categoria
          </Button>
        </Card>

        {/* Pannello categoria selezionata */}
        <div className="space-y-4">
          {current ? (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-gray-900">
                    {current.name}
                  </h3>
                  {current.isSystem && <Badge tone="gray">Sistema</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!editable}
                    onClick={() => {
                      setError(null);
                      setAddAttrOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Aggiungi attributo
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!editable}
                    title="Rimuovi categoria dal preset"
                    onClick={() => {
                      setError(null);
                      setRemoveCatTarget(current.presetCategoryId);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>

              {current.attributes.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  Nessun attributo in questa categoria.
                </p>
              ) : (
                <div className="space-y-4">
                  {current.attributes.map((a, i) => (
                    <AttributeEditor
                      key={a.id}
                      attr={a}
                      editable={editable}
                      isFirst={i === 0}
                      isLast={i === current.attributes.length - 1}
                      onError={setError}
                    />
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-10 text-center text-sm text-gray-500">
              Seleziona o aggiungi una categoria per configurarne gli
              attributi.
            </Card>
          )}

          {/* Attributi generali (senza categoria) */}
          {detail.generalAttributes.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-4 text-base font-semibold text-gray-900">
                Attributi generali
              </h3>
              <div className="space-y-4">
                {detail.generalAttributes.map((a, i) => (
                  <AttributeEditor
                    key={a.id}
                    attr={a}
                    editable={editable}
                    isFirst={i === 0}
                    isLast={i === detail.generalAttributes.length - 1}
                    onError={setError}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* Campi generati */}
          <Card className="p-5">
            <h3 className="mb-3 text-base font-semibold text-gray-900">
              Campi generati
            </h3>
            <div className="flex flex-wrap gap-2">
              {detail.generatedFields.map((f) => (
                <Badge key={f.id} tone={f.enabled ? 'green' : 'gray'}>
                  {f.label ?? f.fieldKey}
                </Badge>
              ))}
              {detail.generatedFields.length === 0 && (
                <p className="text-sm text-gray-400">
                  Nessun campo generato configurato.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Aggiungi categoria */}
      <AddCategoryModal
        open={addCatOpen}
        onClose={() => setAddCatOpen(false)}
        available={detail.availableCategories}
        versionId={detail.workingVersionId}
        onError={setError}
      />

      {/* Importa attributi da lista */}
      <Modal
        open={importAttrOpen}
        onClose={() => setImportAttrOpen(false)}
        title="Aggiungi attributi da lista"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Tipo di dato</label>
            <Select value={importDataType} onChange={(e) => setImportDataType(e.target.value)}>
              <option value="text">Testo</option>
              <option value="boolean">Sì/No (booleano)</option>
              <option value="integer">Numero intero</option>
              <option value="decimal">Numero decimale</option>
              <option value="percentage">Percentuale</option>
              <option value="currency">Valuta</option>
              <option value="measurement">Misura (con unità)</option>
            </Select>
            <p className="mt-1 text-xs text-gray-500">
              Il tipo scelto viene applicato a tutti gli attributi della lista e influenza
              come vengono usati nella generazione. Per gli elenchi (select) crea l’attributo
              a mano o col Copilot, per definirne i valori.
            </p>
          </div>
          <div>
            <Textarea
              rows={7}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'Materiale\nColore\nVestibilità\nStagione'}
              aria-label="Attributi, uno per riga"
            />
            <p className="mt-1 text-xs text-gray-500">
              Un attributo per riga. Quelli non ancora esistenti vengono creati e aggiunti
              al preset. Max 300 per volta.
            </p>
          </div>
          {importMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {importMsg}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportAttrOpen(false)}>
              Chiudi
            </Button>
            <Button
              size="sm"
              onClick={handleImportAttrs}
              disabled={pending || !importText.trim()}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Aggiungi
            </Button>
          </div>
        </div>
      </Modal>

      {/* Importa categorie da lista */}
      <Modal
        open={importCatOpen}
        onClose={() => setImportCatOpen(false)}
        title="Aggiungi categorie da lista"
      >
        <div className="space-y-4">
          <div>
            <Textarea
              rows={8}
              value={importCatText}
              onChange={(e) => setImportCatText(e.target.value)}
              placeholder={'T-shirt\nCamicie\nPantaloni\nGiacche'}
              aria-label="Categorie, una per riga"
            />
            <p className="mt-1 text-xs text-gray-500">
              Una categoria per riga. Quelle non ancora esistenti vengono create e aggiunte
              al preset con i loro attributi tipici. Max 300 per volta.
            </p>
          </div>
          {importCatMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {importCatMsg}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportCatOpen(false)}>
              Chiudi
            </Button>
            <Button size="sm" onClick={handleImportCats} disabled={pending || !importCatText.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Aggiungi
            </Button>
          </div>
        </div>
      </Modal>

      {/* Costruttore di preset con AI */}
      <Modal
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        title="Costruisci il preset con l'AI"
        className="max-w-2xl"
      >
        {copilotOpen && (
          <PresetCopilotPanel
            presetId={detail.preset.id}
            onClose={() => setCopilotOpen(false)}
          />
        )}
      </Modal>

      {/* Svuota preset */}
      <ConfirmDialog
        open={confirmClear}
        onCancel={() => setConfirmClear(false)}
        title="Svuotare il preset?"
        message="Verranno rimosse tutte le categorie e gli attributi da questa bozza. I campi generati restano. L'operazione riguarda solo la bozza corrente."
        confirmLabel="Svuota"
        busy={pending}
        onConfirm={() => {
          setConfirmClear(false);
          run(() => clearPresetVersion({ presetVersionId: detail.workingVersionId }));
        }}
      />

      {/* Aggiungi attributo */}
      {current && (
        <AddAttributeModal
          open={addAttrOpen}
          onClose={() => setAddAttrOpen(false)}
          available={detail.availableAttributes}
          versionId={detail.workingVersionId}
          categoryId={current.categoryId}
          onError={setError}
          sectorId={detail.preset.sectorId}
        />
      )}

      {/* Rimuovi categoria */}
      <ConfirmDialog
        open={Boolean(removeCatTarget)}
        title="Rimuovi categoria"
        message="La categoria e i suoi attributi verranno rimossi da questa bozza del preset."
        confirmLabel="Rimuovi"
        busy={pending}
        onConfirm={() => {
          if (!removeCatTarget) return;
          const id = removeCatTarget;
          setRemoveCatTarget(null);
          run(() => removeCategoryFromPreset({ presetCategoryId: id }));
        }}
        onCancel={() => setRemoveCatTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Editor di un singolo attributo del preset
// ---------------------------------------------------------------------
function AttributeEditor({
  attr,
  editable,
  isFirst,
  isLast,
  onError,
}: {
  attr: PresetAttrRow;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
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

  function persist(patch: Parameters<typeof setPresetAttribute>[0]) {
    onError(null);
    startTransition(async () => {
      const res = await setPresetAttribute(patch);
      if (!res.ok) {
        onError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function move(delta: number) {
    persist({ id: attr.id, displayOrder: attr.displayOrder + delta });
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{attr.name}</span>
          <Badge tone="violet">
            {KIND_LABELS[attr.attributeKind] ?? attr.attributeKind}
          </Badge>
          <span className="text-xs text-gray-400">{attr.dataType}</span>
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 flex items-center gap-1.5 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={attr.isRequired}
              disabled={!editable || pending}
              onChange={(e) =>
                persist({ id: attr.id, isRequired: e.target.checked })
              }
              className="h-5 w-5 rounded border-gray-300"
            />
            Obbligatorio
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={!editable || isFirst || pending}
            onClick={() => move(-1)}
            title="Sposta su"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!editable || isLast || pending}
            onClick={() => move(1)}
            title="Sposta giù"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!editable || pending}
            onClick={() => setConfirmRemove(true)}
            title="Rimuovi attributo"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
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
        message={`Rimuovere "${attr.name}" da questa bozza del preset?`}
        confirmLabel="Rimuovi"
        busy={pending}
        onConfirm={() => {
          setConfirmRemove(false);
          onError(null);
          startTransition(async () => {
            const res = await removeAttributeFromPreset({
              presetAttributeId: attr.id,
            });
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

function AddCategoryModal({
  open,
  onClose,
  available,
  versionId,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  available: { id: string; name: string; isSystem: boolean }[];
  versionId: string;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState('');

  function submit() {
    const categoryId = value || available[0]?.id;
    if (!categoryId) return;
    onError(null);
    startTransition(async () => {
      const res = await addCategoryToPreset({
        presetVersionId: versionId,
        categoryId,
      });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Aggiungi categoria">
      <div className="space-y-4">
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isSystem ? ' (sistema)' : ''}
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

function AddAttributeModal({
  open,
  onClose,
  available,
  versionId,
  categoryId,
  sectorId,
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
  versionId: string;
  categoryId: string;
  sectorId: string;
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
      const res = await addAttributeToPreset({
        presetVersionId: versionId,
        attributeId,
        categoryId,
      });
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
        <p className="text-xs text-gray-500">
          Serve un nuovo attributo?{' '}
          <a
            href={`/app/settings/attributes?sector=${sectorId}`}
            className="text-brand-accent hover:underline"
          >
            Crea attributo
          </a>
        </p>
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
