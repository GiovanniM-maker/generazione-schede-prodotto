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
import { PageShell } from '@/components/page-shell';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Overlay } from '@/components/ui/overlay';
import { CopilotPanel } from '@/components/copilot/copilot-panel';
import { Avviso } from '@/components/ui/avviso';
import { motivoMancante } from '@app/core/comandi';

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
    <PageShell
      title="Categorie"
      subtitle="Categorie di sistema e categorie personalizzate della tua organizzazione."
      actions={
        <>
          <Button
            variant="outline"
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
        </>
      }
    >
      {/* Non due volte.
          La modale mostra ora l'errore dell'azione che ha lanciato lei; questo
          riquadro serve alle azioni della pagina. Lasciandoli accesi insieme,
          lo stesso messaggio finiva nel DOM due volte — uno visibile e uno
          dietro la velatura — e un lettore di schermo lo annunciava due volte.
          `copilotOpen` non entra nel conto: il copilota ha i suoi errori. */}

      {error && !(createOpen || importOpen) && (

        <Avviso tono="errore">
          {error}
        </Avviso>
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
          <div className="p-10 text-center text-sm text-ink-500">
            Nessuna categoria trovata.
          </div>
        ) : (
          <Table scorrevole>
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
                  <TD className="font-medium text-ink-900">{c.name}</TD>
                  <TD>
                    <Badge tone="gray">{c.sectorName}</Badge>
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

      <Overlay
        errore={error}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuova categoria"
      >
        <form
          id="nuova-categoria"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            // Niente `&& name.trim()`: qui il pulsante «Crea» è acceso anche a
            // nome vuoto, apposta, perché è `handleCreate` a dire «il nome è
            // obbligatorio». Con la guardia in più, premere «Crea» senza nome
            // non faceva più succedere niente — cioè esattamente il difetto
            // che quella modale aveva ed è stato corretto: un comando che
            // sembra non aver ricevuto il clic, e uno che ripreme.
            //
            // La guardia va tenuta solo dove il pulsante è spento nello stesso
            // caso (invito a un collega, dati azienda, correzione di un
            // dubbio): lì rispecchia il pulsante invece di contraddirlo.
            if (!pending) void handleCreate();
          }}
        >
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
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Crea
            </Button>
          </div>
        </form>
      </Overlay>

      <Overlay
        errore={error}
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
            <p className="mt-1 text-xs text-ink-500">
              Incolla la tua lista. I nomi già esistenti vengono saltati. Max 300 per volta.
            </p>
          </div>
          {importMsg && (
            <Avviso tono="riuscito">
              {importMsg}
            </Avviso>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>
              Chiudi
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              loading={pending}
              nonDisponibile={motivoMancante([
                { manca: !importText.trim(), cosa: 'la lista da incollare' },
              ])}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Importa
            </Button>
          </div>
        </div>
      </Overlay>

      <Overlay
        errore={error}
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
      </Overlay>
    </PageShell>
  );
}
