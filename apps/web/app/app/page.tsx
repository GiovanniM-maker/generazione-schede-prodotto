import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Plus,
  PackageOpen,
  ArrowRight,
  Check,
  Circle,
  Settings2,
} from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { getCreditBalance } from '@/lib/credits';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RecentBatchCard } from '@/components/recent-batch-card';
import { batchHref } from '@/lib/batch-href';
import { WelcomeCard } from '@/components/onboarding/welcome-card';
import { PageShell } from '@/components/page-shell';

export const dynamic = 'force-dynamic';

interface BatchRow {
  id: string;
  name: string;
  status: string;
  total_products: number | null;
  processed_products: number | null;
  created_at: string;
}


interface ChecklistItem {
  label: string;
  done: boolean;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  const orgId = org.organizationId;
  const supabase = await createSupabaseServerClient();

  // Gate onboarding.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('name, onboarding_completed_at')
    .eq('id', orgId)
    .maybeSingle();
  if (!orgRow || !orgRow.onboarding_completed_at) {
    redirect('/app/onboarding');
  }

  // --- Dati di completezza configurazione ---
  const [
    sectorRow,
    categoryCountRes,
    presetsRes,
    brandProfilesRes,
    credits,
    batchesRes,
  ] = await Promise.all([
    supabase
      .from('organization_sectors')
      .select('sector_id')
      .eq('organization_id', orgId)
      .eq('is_primary', true)
      .maybeSingle(),
    supabase
      .from('organization_categories')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('enabled', true),
    supabase.from('presets').select('id, active_version_id').eq('organization_id', orgId),
    supabase.from('brand_profiles').select('active_version_id').eq('organization_id', orgId),
    getCreditBalance(orgId),
    supabase
      .from('batches')
      // Il totale viene con la stessa richiesta: serve a dire «ce ne sono
      // altri», che è l'informazione che mancava — l'elenco si fermava a dieci
      // e non lo diceva.
      .select('id, name, status, total_products, processed_products, created_at', {
        count: 'exact',
      })
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(10),
  ]);

  let sectorName: string | null = null;
  if (sectorRow.data) {
    const { data: s } = await supabase
      .from('sectors')
      .select('name')
      .eq('id', sectorRow.data.sector_id)
      .maybeSingle();
    sectorName = s?.name ?? null;
  }

  const categoryCount = categoryCountRes.count ?? 0;
  const presets = presetsRes.data ?? [];
  const presetCount = presets.length;

  const activeVersionIds = presets
    .map((p) => p.active_version_id)
    .filter((v): v is string => Boolean(v));

  let presetPublished = false;
  let presetHasAttributes = false;
  if (activeVersionIds.length) {
    const [versionsRes, attrCountRes] = await Promise.all([
      supabase
        .from('preset_versions')
        .select('id, published_at')
        .in('id', activeVersionIds),
      supabase
        .from('preset_attributes')
        .select('id', { count: 'exact', head: true })
        .in('preset_version_id', activeVersionIds)
        .eq('enabled', true),
    ]);
    presetPublished = (versionsRes.data ?? []).some((v) => v.published_at);
    presetHasAttributes = (attrCountRes.count ?? 0) > 0;
  }

  const brandVersionIds = (brandProfilesRes.data ?? [])
    .map((b) => b.active_version_id)
    .filter((v): v is string => Boolean(v));
  let brandApproved = false;
  if (brandVersionIds.length) {
    const { data: bvs } = await supabase
      .from('brand_profile_versions')
      .select('id, approved_at')
      .in('id', brandVersionIds);
    brandApproved = (bvs ?? []).some((v) => v.approved_at);
  }

  const checklist: ChecklistItem[] = [
    { label: 'Settore selezionato', done: !!sectorRow.data },
    { label: 'Almeno una categoria', done: categoryCount > 0 },
    { label: 'Preset pubblicato', done: presetPublished },
    { label: 'Preset con attributi', done: presetHasAttributes },
    { label: 'Profilo del brand approvato (consigliato)', done: brandApproved },
  ];
  // Per creare un batch NON serve il profilo brand (la generazione usa un tono
  // di default se assente): richiediamo solo la configurazione del catalogo.
  const canCreateBatch =
    !!sectorRow.data && categoryCount > 0 && presetPublished && presetHasAttributes;

  const batches = (batchesRes.data ?? []) as BatchRow[];
  const batchTotali = batchesRes.count ?? batches.length;

  return (
    <PageShell
      title={orgRow.name}
      subtitle={
        // Un `<span>` e non un `<div>`: il sottotitolo del guscio vive dentro
        // un `<p>`, e un `<div>` lì dentro è HTML non valido — il browser
        // chiuderebbe il paragrafo da sé e React se ne lamenterebbe.
        <span className="flex flex-wrap items-center gap-2">
          {sectorName && <Badge tone="blue">{sectorName}</Badge>}
          <span>{categoryCount} categorie</span>
          <span>·</span>
          <span>{presetCount} preset</span>
          <span>·</span>
          <span>{credits} crediti</span>
        </span>
      }
      actions={
        canCreateBatch && (
          <Link href="/app/batches/new">
            <Button size="lg">
              <Plus className="h-4 w-4" />
              Nuovo batch
            </Button>
          </Link>
        )
      }
    >
      {/* La scheda di benvenuto stava SOPRA il titolo. Ora è il primo figlio:
          la pagina si presenta col nome dell'organizzazione, e il consiglio
          viene subito dopo. Un invito che precede l'identità della pagina fa
          sembrare l'applicazione una promozione. */}
      <WelcomeCard pronto={canCreateBatch} />

      {/* Completezza configurazione */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink-900">
              Completezza configurazione
            </h2>
            <span className="text-sm text-ink-500">
              {checklist.filter((c) => c.done).length}/{checklist.length}
            </span>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {/* La spunta la porta SOLO chi ha finito.
                Prima l'icona era la stessa per tutti e cambiava solo il
                colore: con la configurazione appena iniziata si vedevano
                cinque spunte grigie accanto al conteggio «0/5», che si
                contraddicono a vista. E chi non distingue il grigio dal verde
                — daltonismo, schermo al sole, contrasto basso — leggeva cinque
                cose fatte.

                Ora la forma dice lo stato: cerchio vuoto se manca, spunta se
                c'è. Il colore resta, ma non è più l'unica cosa che informa. */}
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                    item.done
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'border border-ink-300 bg-white text-ink-500',
                  )}
                  aria-hidden="true"
                >
                  {item.done ? <Check className="h-3 w-3" /> : <Circle className="h-2 w-2" />}
                </span>
                {/* Detto anche a chi ascolta: l'icona è decorativa, lo stato
                    no. Senza, l'elenco si legge come cinque voci identiche. */}
                <span className="sr-only">{item.done ? 'Fatto:' : 'Da fare:'}</span>
                <span className={cn('text-ink-700', !item.done && 'text-ink-500')}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Azione principale in base allo stato */}
      {!canCreateBatch && (
        <Card className="border-brand-accent/40 bg-brand-soft/50">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand-accent">
                <Settings2 className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold text-ink-900">
                  Completa la configurazione del catalogo
                </h3>
                <p className="mt-0.5 text-sm text-ink-500">
                  Termina la configurazione per poter creare i tuoi batch di
                  schede prodotto.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href="/app/settings/presets">
                <Button variant="outline">Gestisci preset</Button>
              </Link>
              <Link href="/app/settings/presets">
                <Button>
                  Completa
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Batch recenti */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink-900">Batch recenti</h2>
          {/* Compariva solo sopra i dieci batch: con cinque, dalla dashboard
              non si raggiungeva più l'elenco completo. Ora c'è appena esiste
              un lavoro, e il testo dice quanti ce ne sono solo quando questa
              lista ne nasconde davvero qualcuno. */}
          {batches.length > 0 && (
            <Link
              href="/app/batches"
              className="text-sm font-medium text-brand-accent underline underline-offset-2"
            >
              {batchTotali > batches.length ? `Vedi tutti i ${batchTotali}` : 'Tutti i lavori'}
            </Link>
          )}
        </div>
        {batches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
                <PackageOpen className="h-7 w-7" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-ink-900">
                  Nessun batch ancora
                </h2>
                <p className="mt-1 max-w-sm text-sm text-ink-500">
                  {canCreateBatch
                    ? 'Crea il tuo primo batch caricando un file CSV o Excel con il tuo catalogo.'
                    : 'Completa la configurazione del catalogo per creare il primo batch.'}
                </p>
              </div>
              {canCreateBatch && (
                <Link href="/app/batches/new">
                  <Button>
                    <Plus className="h-4 w-4" />
                    Crea il primo batch
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {/* `grid-cols-1` e non solo `grid`: una traccia `auto` si
                dimensiona sul contenuto più largo, e basta il nome di un
                batch per allargare la pagina. `grid-cols-1` è
                `minmax(0,1fr)`: la traccia non supera mai il contenitore. */}
            {batches.map((b) => (
              <RecentBatchCard
                isOwner={org.role === 'owner'}
                key={b.id}
                batch={{
                  id: b.id,
                  name: b.name,
                  status: b.status,
                  total: b.total_products ?? 0,
                  processed: b.processed_products ?? 0,
                  createdAt: b.created_at,
                  href: batchHref(b.id, b.status),
                  isCompleted:
                    b.status === 'completed' || b.status === 'partial_failed',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
