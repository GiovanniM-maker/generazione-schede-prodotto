'use client';

import Link from 'next/link';
import { Loader2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { type PublishedPresetSummary, type PresetExplorer } from '@/lib/actions/batch-wizard';
import { HelpBubble } from '@/components/onboarding/help-bubble';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { etichettaTipoDato } from '@/lib/tipi-dato';

// PREPARA — «di che lavoro si tratta» e «con quali regole».
//
// Passi 1 e 2: informazioni del batch e scelta del preset. Sono le due cose
// che si decidono PRIMA di avere in mano un file, e nel wizard nuovo
// diventeranno un solo stadio.
// ---------------------------------------------------------------------------

export function Step1({
  name,
  setName,
  description,
  setDescription,
  presets,
  selectedPresetId,
  setSelectedPresetId,
  onInvio,
  pronto,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  presets: PublishedPresetSummary[] | null;
  selectedPresetId: string | null;
  setSelectedPresetId: (v: string) => void;
  onInvio: () => void;
  pronto: boolean;
}) {
  const selected = presets?.find((p) => p.id === selectedPresetId) ?? null;
  return (
    // Il nome del batch si scrive e si preme Invio, come in qualunque modulo.
    // «Crea e continua» sta nella barra in fondo, fuori da questo sottoalbero:
    // `form="passo-batch"` lo collega lo stesso.
    <form
      id="passo-batch"
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (pronto) onInvio();
      }}
    >
      <div data-tour="batch-name">
        <Label htmlFor="batch-name">Nome del batch</Label>
        <Input id="batch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Collezione autunno 2026" />
      </div>
      <div>
        <Label htmlFor="batch-desc">Descrizione (facoltativa)</Label>
        <Textarea id="batch-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Note interne su questo batch." />
      </div>

      <div data-tour="preset-pick">
        <Label>
          Preset{' '}
          <HelpBubble text="Il preset è il modello della scheda: definisce le categorie (es. Vino, Ortofrutta) e i dati da compilare per ciascuna. Lo configuri in Configurazione → Preset, anche a chat con il Copilot." />
        </Label>
        {presets === null && (
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento preset…
          </div>
        )}
        {presets !== null && presets.length === 0 && (
          <Card>
            <CardContent className="space-y-3 p-6 text-sm text-ink-600">
              <p className="font-medium text-ink-900">Nessun preset pubblicato</p>
              <p>
                Per creare un batch devi prima configurare e pubblicare un preset con le sue categorie e i suoi attributi.
              </p>
              <Link href="/app/settings/presets" className="inline-flex font-medium text-brand-accent underline underline-offset-2">
                Vai alle impostazioni preset
              </Link>
            </CardContent>
          </Card>
        )}
        {presets !== null && presets.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {presets.map((p) => {
              const active = p.id === selectedPresetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPresetId(p.id)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors',
                    active ? 'border-brand-accent bg-brand-soft/70 ring-1 ring-brand-accent' : 'border-ink-200 bg-white hover:bg-ink-50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink-900">{p.name}</span>
                    {active && <Check className="h-4 w-4 text-brand-accent" />}
                  </div>
                  <div className="mt-1 text-sm text-ink-500">Settore: {p.sectorName}</div>
                  <div className="mt-2 flex gap-2 text-xs text-ink-500">
                    <Badge tone="gray">{p.categoriesCount} categorie</Badge>
                    <Badge tone="gray">{p.attributesCount} attributi</Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="text-sm text-ink-500">
          {/* `-my-1 py-1.5` porta l'area di tocco a 24px senza allargare la
              riga: un collegamento di testo è alto quanto il testo — 17px — e
              col dito non si prende. È lo stesso trattamento dei link legali
              nel piede. */}
          <Link
            href="/app/settings/presets"
            className="-my-1 inline-flex items-center py-1.5 font-medium text-brand-accent underline underline-offset-2"
          >
            Modifica preset
          </Link>
        </div>
      )}
    </form>
  );
}

export function Step2({
  explorer,
  expandedCat,
  setExpandedCat,
  expandedAttr,
  setExpandedAttr,
}: {
  explorer: PresetExplorer | null;
  expandedCat: Set<string>;
  setExpandedCat: (s: Set<string>) => void;
  expandedAttr: Set<string>;
  setExpandedAttr: (s: Set<string>) => void;
}) {
  if (explorer === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Caricamento preset…
      </div>
    );
  }
  function toggle(set: Set<string>, apply: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Settore <span className="font-medium text-ink-800">{explorer.sectorName}</span>. Questi sono gli attributi che verranno estratti e generati. Sola lettura.
      </p>
      {explorer.categories.length === 0 && <p className="text-sm text-ink-500">Nessuna categoria configurata nel preset.</p>}
      {explorer.categories.map((cat) => {
        const open = expandedCat.has(cat.id);
        return (
          <Card key={cat.id}>
            <button type="button" onClick={() => toggle(expandedCat, setExpandedCat, cat.id)} className="flex w-full items-center justify-between p-4 text-left">
              <span className="font-medium text-ink-900">{cat.name}</span>
              <span className="flex items-center gap-2 text-sm text-ink-500">
                {cat.attributes.length} attributi
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </button>
            {open && (
              <CardContent className="space-y-2 pt-0">
                {cat.attributes.map((attr) => {
                  const aopen = expandedAttr.has(attr.id);
                  return (
                    <div key={attr.id} className="rounded-lg border border-ink-100">
                      <button type="button" onClick={() => toggle(expandedAttr, setExpandedAttr, attr.id)} className="flex w-full items-center justify-between px-3 py-2 text-left">
                        <span className="flex items-center gap-2">
                          <span className="text-sm text-ink-800">{attr.name}</span>
                          <Badge tone="gray">{etichettaTipoDato(attr.dataType)}</Badge>
                          {attr.isRequired && <Badge tone="amber">obbligatorio</Badge>}
                        </span>
                        {aopen ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
                      </button>
                      {aopen && (
                        <div className="space-y-2 border-t border-ink-100 px-3 py-2 text-sm text-ink-600">
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Istruzione di estrazione</span>
                            <p className="mt-0.5">{attr.extractionInstruction ?? '—'}</p>
                          </div>
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Istruzione di generazione</span>
                            <p className="mt-0.5">{attr.generationInstruction ?? '—'}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
