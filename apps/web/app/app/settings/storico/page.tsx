import {
  History,
  Upload,
  Rocket,
  Sparkles,
  Wand2,
  Eraser,
  FileDown,
  PackagePlus,
  CreditCard,
  ClipboardList,
  Image as ImageIcon,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface EventRow {
  id: string;
  event_name: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

// Etichetta + icona per ciascun tipo di evento tracciato.
const EVENT_META: Record<
  string,
  { label: string; icon: typeof Circle; tone: string }
> = {
  onboarding_completed: { label: 'Onboarding completato', icon: CheckCircle2, tone: 'text-emerald-600' },
  batch_created: { label: 'Batch creato', icon: PackagePlus, tone: 'text-blue-600' },
  batch_deleted: { label: 'Batch eliminato', icon: Eraser, tone: 'text-amber-600' },
  file_uploaded: { label: 'File caricato', icon: Upload, tone: 'text-gray-500' },
  mapping_confirmed: { label: 'Mappatura confermata', icon: ClipboardList, tone: 'text-gray-500' },
  sample_generated: { label: 'Campione generato', icon: Sparkles, tone: 'text-violet-600' },
  generation_started: { label: 'Generazione avviata', icon: Rocket, tone: 'text-blue-600' },
  visual_extraction_run: { label: 'Analisi immagini eseguita', icon: ImageIcon, tone: 'text-violet-600' },
  export_created: { label: 'Esportazione creata', icon: FileDown, tone: 'text-gray-500' },
  checkout_started: { label: 'Checkout avviato', icon: CreditCard, tone: 'text-gray-500' },
  payment_completed: { label: 'Pagamento completato', icon: CreditCard, tone: 'text-emerald-600' },
  preset_published: { label: 'Preset pubblicato', icon: Rocket, tone: 'text-emerald-600' },
  categories_imported: { label: 'Categorie importate', icon: ClipboardList, tone: 'text-blue-600' },
  attributes_imported: { label: 'Attributi importati', icon: ClipboardList, tone: 'text-blue-600' },
  preset_cleared: { label: 'Preset svuotato', icon: Eraser, tone: 'text-amber-600' },
  prompt_improved: { label: 'Prompt migliorato', icon: Wand2, tone: 'text-violet-600' },
};

function describe(ev: EventRow): string | null {
  const m = ev.metadata_json ?? {};
  const num = (k: string): number | null =>
    typeof m[k] === 'number' ? (m[k] as number) : null;
  const str = (k: string): string | null =>
    typeof m[k] === 'string' ? (m[k] as string) : null;

  switch (ev.event_name) {
    case 'preset_published': {
      const name = str('presetName');
      const v = num('version');
      return [name, v != null ? `v${v}` : null].filter(Boolean).join(' · ') || null;
    }
    case 'prompt_improved': {
      const name = str('presetName');
      const c = num('correctionsApplied');
      return [name, c != null ? `${c} correzioni assorbite` : null]
        .filter(Boolean)
        .join(' · ') || null;
    }
    case 'categories_imported':
    case 'attributes_imported': {
      const created = num('created');
      const added = num('added');
      const skipped = num('skipped');
      const parts: string[] = [];
      if (added != null) parts.push(`${added} aggiunti`);
      if (created != null) parts.push(`${created} creati`);
      if (skipped != null && skipped > 0) parts.push(`${skipped} saltati`);
      return parts.join(' · ') || null;
    }
    case 'generation_started': {
      const n = num('enqueued');
      return n != null ? `${n} prodotti in coda` : null;
    }
    default:
      return null;
  }
}

export default async function StoricoPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');
  const supabase = await createSupabaseServerClient();

  const { data: events } = await supabase
    .from('app_events')
    .select('id, event_name, metadata_json, created_at')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (events ?? []) as unknown as EventRow[];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Storico attività</h2>
        <p className="mt-1 text-sm text-gray-500">
          Cronologia delle azioni sulla configurazione, sulle generazioni e sui
          miglioramenti del prompt. Ultime 100 attività.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <History className="h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-500">
                Nessuna attività registrata per ora.
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-gray-100">
              {rows.map((ev) => {
                const meta = EVENT_META[ev.event_name] ?? {
                  label: ev.event_name,
                  icon: Circle,
                  tone: 'text-gray-400',
                };
                const Icon = meta.icon;
                const detail = describe(ev);
                return (
                  <li key={ev.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-50">
                      <Icon className={`h-4 w-4 ${meta.tone}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {meta.label}
                      </p>
                      {detail && (
                        <p className="truncate text-xs text-gray-500">{detail}</p>
                      )}
                    </div>
                    <time className="shrink-0 whitespace-nowrap text-xs text-gray-400">
                      {formatDate(ev.created_at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
