'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Copy, Archive, Loader2 } from 'lucide-react';
import {
  createPreset,
  renamePreset,
  duplicatePreset,
  archivePreset,
  type PresetListItem,
  type SectorRow,
} from '@/lib/actions/catalog';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Modal, ConfirmDialog } from '@/components/settings/modal';

export function PresetsClient({
  presets,
  sectors,
}: {
  presets: PresetListItem[];
  sectors: SectorRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSector, setNewSector] = useState(sectors[0]?.id ?? '');

  const [renameTarget, setRenameTarget] = useState<PresetListItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [archiveTarget, setArchiveTarget] = useState<PresetListItem | null>(
    null,
  );

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createPreset({ sectorId: newSector, name: newName });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreateOpen(false);
      setNewName('');
      router.push(`/app/settings/presets/${res.presetId}`);
    });
  }

  function handleRename() {
    if (!renameTarget) return;
    setError(null);
    startTransition(async () => {
      const res = await renamePreset({
        presetId: renameTarget.id,
        name: renameValue,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRenameTarget(null);
      router.refresh();
    });
  }

  function handleDuplicate(preset: PresetListItem) {
    setError(null);
    startTransition(async () => {
      const res = await duplicatePreset({ presetId: preset.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/app/settings/presets/${res.presetId}`);
    });
  }

  function handleArchive() {
    if (!archiveTarget) return;
    setError(null);
    startTransition(async () => {
      const res = await archivePreset({ presetId: archiveTarget.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setArchiveTarget(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Preset</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configurazioni riutilizzabili di categorie, attributi e prompt.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setError(null);
            setNewSector(sectors[0]?.id ?? '');
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nuovo preset
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        {presets.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            Nessun preset. Creane uno per iniziare.
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Nome</TH>
                <TH>Settore</TH>
                <TH>Categorie</TH>
                <TH>Attributi</TH>
                <TH>Versione</TH>
                <TH>Stato</TH>
                <TH>Aggiornato</TH>
                <TH className="text-right">Azioni</TH>
              </TR>
            </THead>
            <TBody>
              {presets.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <button
                      className="font-medium text-brand-accent hover:underline"
                      onClick={() =>
                        router.push(`/app/settings/presets/${p.id}`)
                      }
                    >
                      {p.name}
                    </button>
                  </TD>
                  <TD>
                    <Badge tone="blue">{p.sectorName}</Badge>
                  </TD>
                  <TD>{p.categoryCount}</TD>
                  <TD>{p.attributeCount}</TD>
                  <TD>v{p.version}</TD>
                  <TD>
                    {p.isPublished ? (
                      <Badge tone="green">Pubblicato</Badge>
                    ) : (
                      <Badge tone="amber">Bozza</Badge>
                    )}
                  </TD>
                  <TD className="text-gray-500">{formatDate(p.updatedAt)}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Rinomina"
                        onClick={() => {
                          setError(null);
                          setRenameTarget(p);
                          setRenameValue(p.name);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Duplica"
                        disabled={pending}
                        onClick={() => handleDuplicate(p)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Archivia"
                        onClick={() => {
                          setError(null);
                          setArchiveTarget(p);
                        }}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Nuovo preset */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuovo preset"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="preset-sector">Settore</Label>
            <Select
              id="preset-sector"
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
            <Label htmlFor="preset-name">Nome</Label>
            <Input
              id="preset-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Es. Catalogo principale"
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

      {/* Rinomina */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rinomina preset"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="rename">Nome</Label>
            <Input
              id="rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameTarget(null)}
            >
              Annulla
            </Button>
            <Button size="sm" onClick={handleRename} disabled={pending}>
              Salva
            </Button>
          </div>
        </div>
      </Modal>

      {/* Archivia */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archivia preset"
        message={`Vuoi archiviare "${archiveTarget?.name}"? Non sarà più visibile nell'elenco.`}
        confirmLabel="Archivia"
        busy={pending}
        onConfirm={handleArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
