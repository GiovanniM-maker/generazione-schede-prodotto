'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, Eye, Sparkles, ClipboardList } from 'lucide-react';
import {
  listAttributes,
  createAttribute,
  createAttributesFromList,
  type AttributeListItem,
  type CategoryListItem,
  type SectorRow,
} from '@/lib/actions/catalog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Modal } from '@/components/settings/modal';
import { CopilotPanel } from '@/components/copilot/copilot-panel';

const KINDS = [
  { value: 'factual', label: 'Fattuale' },
  { value: 'derived', label: 'Derivato' },
  { value: 'generative', label: 'Generativo' },
];

const DATA_TYPES = [
  'text',
  'long_text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'enum',
  'multi_enum',
  'measurement',
  'percentage',
  'currency',
  'json',
];

export function AttributesClient({
  initialAttributes,
  categories,
  sectors,
  initialSectorId,
}: {
  initialAttributes: AttributeListItem[];
  categories: CategoryListItem[];
  sectors: SectorRow[];
  initialSectorId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [attributes, setAttributes] =
    useState<AttributeListItem[]>(initialAttributes);
  const [sectorFilter, setSectorFilter] = useState(initialSectorId ?? '');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importSector, setImportSector] = useState(initialSectorId ?? sectors[0]?.id ?? '');
  const [importDataType, setImportDataType] = useState('text');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    attributeKind: 'factual',
    dataType: 'text',
    unit: '',
    enumValues: '',
    extractionInstruction: '',
    generationInstruction: '',
    sectorId: initialSectorId ?? sectors[0]?.id ?? '',
  });

  // Rifiltra lato server quando cambiano settore/categoria/tipo.
  useEffect(() => {
    startTransition(async () => {
      const res = await listAttributes({
        sectorId: sectorFilter || undefined,
        categoryId: categoryFilter || undefined,
        kind: kindFilter || undefined,
      });
      if (res.ok) setAttributes(res.attributes);
      else setError(res.error);
    });
  }, [sectorFilter, categoryFilter, kindFilter]);

  const categoriesForSector = useMemo(
    () =>
      categories.filter((c) => !sectorFilter || c.sectorId === sectorFilter),
    [categories, sectorFilter],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attributes;
    return attributes.filter((a) => a.name.toLowerCase().includes(q));
  }, [attributes, search]);

  function handleImport() {
    setError(null);
    setImportMsg(null);
    startTransition(async () => {
      const res = await createAttributesFromList({
        sectorId: importSector,
        text: importText,
        dataType: importDataType,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImportText('');
      setImportMsg(
        `${res.created} attributi creati${res.skipped > 0 ? `, ${res.skipped} già esistenti saltati` : ''}.`,
      );
      // Allinea la vista al settore in cui si è importato e ricarica da lì,
      // così i nuovi attributi sono sempre visibili (anche se il filtro era su
      // un altro settore).
      setCategoryFilter('');
      setKindFilter('');
      setSectorFilter(importSector);
      const list = await listAttributes({ sectorId: importSector || undefined });
      if (list.ok) setAttributes(list.attributes);
    });
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createAttribute({
        sectorId: form.sectorId,
        name: form.name,
        description: form.description,
        attributeKind: form.attributeKind,
        dataType: form.dataType,
        unit: form.unit,
        enumValues: form.enumValues
          ? form.enumValues
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          : undefined,
        extractionInstruction: form.extractionInstruction,
        generationInstruction: form.generationInstruction,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreateOpen(false);
      router.push(`/app/settings/attributes/${res.attributeId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Attributi</h2>
          <p className="mt-1 text-sm text-gray-500">
            Libreria di attributi di sistema ed estensioni della tua
            organizzazione.
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
          >
            <Sparkles className="h-4 w-4" />
            Crea con AI
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setImportMsg(null);
              setImportSector(sectorFilter || sectors[0]?.id || '');
              setImportOpen(true);
            }}
          >
            <ClipboardList className="h-4 w-4" />
            Importa lista
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setForm((f) => ({
                ...f,
                sectorId: sectorFilter || sectors[0]?.id || '',
              }));
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nuovo attributo
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={sectorFilter}
          onChange={(e) => {
            setSectorFilter(e.target.value);
            setCategoryFilter('');
          }}
          className="w-44"
          aria-label="Filtra per settore"
        >
          <option value="">Tutti i settori</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-44"
          aria-label="Filtra per categoria"
        >
          <option value="">Tutte le categorie</option>
          {categoriesForSector.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="w-40"
          aria-label="Filtra per tipo"
        >
          <option value="">Tutti i tipi</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca attributo…"
          className="w-56"
          aria-label="Cerca attributo"
        />
        {pending && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      <Card>
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            Nessun attributo trovato.
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Nome</TH>
                <TH>Settore</TH>
                <TH>Tipo</TH>
                <TH>Dato</TH>
                <TH>Origine</TH>
                <TH>Utilizzi</TH>
                <TH className="text-right">Azioni</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium text-gray-900">{a.name}</TD>
                  <TD>
                    <Badge tone="blue">{a.sectorName}</Badge>
                  </TD>
                  <TD>
                    <Badge tone="violet">
                      {KINDS.find((k) => k.value === a.attributeKind)?.label ??
                        a.attributeKind}
                    </Badge>
                  </TD>
                  <TD className="text-gray-500">{a.dataType}</TD>
                  <TD>
                    {a.isSystem ? (
                      <Badge tone="gray">Sistema</Badge>
                    ) : (
                      <Badge tone="green">Custom</Badge>
                    )}
                  </TD>
                  <TD>{a.usageCount}</TD>
                  <TD>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          router.push(`/app/settings/attributes/${a.id}`)
                        }
                      >
                        <Eye className="h-4 w-4" />
                        Dettaglio
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importa attributi da lista"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="imp-attr-sector">Settore</Label>
            <Select
              id="imp-attr-sector"
              value={importSector}
              onChange={(e) => setImportSector(e.target.value)}
            >
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="imp-attr-type">Tipo di dato</Label>
            <Select
              id="imp-attr-type"
              value={importDataType}
              onChange={(e) => setImportDataType(e.target.value)}
            >
              <option value="text">Testo</option>
              <option value="boolean">Sì/No (booleano)</option>
              <option value="integer">Numero intero</option>
              <option value="decimal">Numero decimale</option>
              <option value="percentage">Percentuale</option>
              <option value="currency">Valuta</option>
              <option value="measurement">Misura (con unità)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="imp-attr-text">Un attributo per riga</Label>
            <Textarea
              id="imp-attr-text"
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'Materiale\nColore\nVestibilità\nStagione'}
            />
            <p className="mt-1 text-xs text-gray-500">
              Il tipo scelto vale per tutti. Per gli elenchi (select) crea l’attributo a
              mano o col Copilot per definirne i valori. I nomi già esistenti vengono
              saltati. Max 300 per volta.
            </p>
          </div>
          {importMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {importMsg}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>
              Chiudi
            </Button>
            <Button size="sm" onClick={handleImport} disabled={pending || !importText.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Importa
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuovo attributo"
        className="max-w-xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="attr-sector">Settore</Label>
              <Select
                id="attr-sector"
                value={form.sectorId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sectorId: e.target.value }))
                }
              >
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="attr-name">Nome</Label>
              <Input
                id="attr-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Es. Materiale"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="attr-kind">Tipo</Label>
              <Select
                id="attr-kind"
                value={form.attributeKind}
                onChange={(e) =>
                  setForm((f) => ({ ...f, attributeKind: e.target.value }))
                }
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="attr-dtype">Tipo di dato</Label>
              <Select
                id="attr-dtype"
                value={form.dataType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, dataType: e.target.value }))
                }
              >
                {DATA_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="attr-unit">Unità (facoltativa)</Label>
              <Input
                id="attr-unit"
                value={form.unit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, unit: e.target.value }))
                }
                placeholder="Es. cm"
              />
            </div>
            <div>
              <Label htmlFor="attr-enum">Valori enum (separati da virgola)</Label>
              <Input
                id="attr-enum"
                value={form.enumValues}
                onChange={(e) =>
                  setForm((f) => ({ ...f, enumValues: e.target.value }))
                }
                placeholder="Es. rosso, blu, verde"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="attr-desc">Descrizione</Label>
            <Input
              id="attr-desc"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="attr-extr">Prompt di estrazione</Label>
            <Textarea
              id="attr-extr"
              rows={2}
              value={form.extractionInstruction}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  extractionInstruction: e.target.value,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="attr-gen">Prompt di generazione</Label>
            <Textarea
              id="attr-gen"
              rows={2}
              value={form.generationInstruction}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  generationInstruction: e.target.value,
                }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              Annulla
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Crea
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        title="Crea un attributo con l'AI"
        className="max-w-4xl"
      >
        {copilotOpen && (
          <CopilotPanel
            entityType="attribute"
            sectorId={sectorFilter || sectors[0]?.id || undefined}
            onClose={() => setCopilotOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}
