'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, Copy, Eye, Sparkles, ClipboardList } from 'lucide-react';
import {
  createCategory,
  createCategoriesFromList,
  duplicateSystemCategory,
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

export function CategoriesClient({
  categories,
  sectors,
}: {
  categories: CategoryListItem[];
  sectors: SectorRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [sectorFilter, setSectorFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [newSector, setNewSector] = useState(sectors[0]?.id ?? '');

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return categories.filter((c) => {
      if (sectorFilter && c.sectorId !== sectorFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [categories, sectorFilter, search]);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createCategory({
        sectorId: newSector,
        name,
        description,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreateOpen(false);
      setName('');
      setDescription('');
      router.push(`/app/settings/categories/${res.categoryId}`);
    });
  }

  function handleImport() {
    setError(null);
    setImportMsg(null);
    startTransition(async () => {
      const res = await createCategoriesFromList({
        sectorId: newSector,
        text: importText,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImportText('');
      setImportMsg(
        `${res.created} categorie create${res.skipped > 0 ? `, ${res.skipped} già esistenti saltate` : ''}.`,
      );
      router.refresh();
    });
  }

  function handleDuplicate(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await duplicateSystemCategory({ categoryId: id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/app/settings/categories/${res.categoryId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Categorie</h2>
          <p className="mt-1 text-sm text-gray-500">
            Categorie di sistema e categorie personalizzate della tua
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
              setNewSector(sectorFilter || sectors[0]?.id || '');
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
              setNewSector(sectorFilter || sectors[0]?.id || '');
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nuova categoria
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
          onChange={(e) => setSectorFilter(e.target.value)}
          className="w-48"
          aria-label="Filtra per settore"
        >
          <option value="">Tutti i settori</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca categoria…"
          className="w-64"
          aria-label="Cerca categoria"
        />
      </div>

      <Card>
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            Nessuna categoria trovata.
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Nome</TH>
                <TH>Settore</TH>
                <TH>Attributi</TH>
                <TH>Tipo</TH>
                <TH className="text-right">Azioni</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium text-gray-900">{c.name}</TD>
                  <TD>
                    <Badge tone="blue">{c.sectorName}</Badge>
                  </TD>
                  <TD>{c.attributeCount}</TD>
                  <TD>
                    {c.isSystem ? (
                      <Badge tone="gray">Sistema</Badge>
                    ) : (
                      <Badge tone="violet">Personalizzata</Badge>
                    )}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          router.push(`/app/settings/categories/${c.id}`)
                        }
                      >
                        <Eye className="h-4 w-4" />
                        Visualizza attributi
                      </Button>
                      {c.isSystem && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          title="Duplica per personalizzare"
                          onClick={() => handleDuplicate(c.id)}
                        >
                          <Copy className="h-4 w-4" />
                          Duplica per personalizzare
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuova categoria"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="cat-sector">Settore</Label>
            <Select
              id="cat-sector"
              value={newSector}
              onChange={(e) => setNewSector(e.target.value)}
            >
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cat-name">Nome</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es. T-shirt"
            />
          </div>
          <div>
            <Label htmlFor="cat-desc">Descrizione</Label>
            <Input
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Facoltativa"
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
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importa categorie da lista"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="imp-cat-sector">Settore</Label>
            <Select
              id="imp-cat-sector"
              value={newSector}
              onChange={(e) => setNewSector(e.target.value)}
            >
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="imp-cat-text">Una categoria per riga</Label>
            <Textarea
              id="imp-cat-text"
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'T-shirt\nCamicie\nPantaloni\nGiacche'}
            />
            <p className="mt-1 text-xs text-gray-500">
              Incolla la tua lista. I nomi già esistenti vengono saltati. Max 300 per volta.
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
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        title="Crea una categoria con l'AI"
        className="max-w-4xl"
      >
        {copilotOpen && (
          <CopilotPanel
            entityType="category"
            sectorId={sectorFilter || sectors[0]?.id || undefined}
            onClose={() => setCopilotOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}
