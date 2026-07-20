import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Plus,
  PackageOpen,
  ArrowRight,
  Check,
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

export const dynamic = 'force-dynamic';

interface BatchRow {
  id: string;
  name: string;
  status: string;
  total_products: number | null;
  processed_products: number | null;
  created_at: string;
}

function batchHref(id: string, status: string): string {
  switch (status) {
    case 'mapping':
      return `/app/batches/${id}/mapping`;
    case 'input_review':
      return `/app/batches/${id}/input`;
    case 'tone_setup':
    case 'sample_pending':
    case 'sample_ready':
      return `/app/batches/${id}/sample`;
    case 'approved':
    case 'queued':
    case 'processing':
      return `/app/batches/${id}/processing`;
    case 'completed':
    case 'partial_failed':
    case 'failed':
      return `/app/batches/${id}/results`;
    default:
      return `/app/batches/${id}/input`;
  }
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
      .select('id, name, status, total_products, processed_products, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
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

  return (
    <div className="space-y-8">
      {/* Intestazione */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {orgRow.name}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            {sectorName && <Badge tone="blue">{sectorName}</Badge>}
            <span>{categoryCount} categorie</span>
            <span>·</span>
            <span>
              {presetCount} preset{presetCount === 1 ? '' : ''}
            </span>
            <span>·</span>
            <span>{credits} crediti</span>
          </div>
        </div>
        {canCreateBatch && (
          <Link href="/app/batches/new">
            <Button size="lg">
              <Plus className="h-4 w-4" />
              Nuovo batch
            </Button>
          </Link>
        )}
      </div>

      {/* Completezza configurazione */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Completezza configurazione
            </h2>
            <span className="text-sm text-gray-500">
              {checklist.filter((c) => c.done).length}/{checklist.length}
            </span>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full',
                    item.done
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-gray-200 text-gray-400',
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className={cn('text-gray-700', !item.done && 'text-gray-400')}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Azione principale in base allo stato */}
      {!canCreateBatch && (
        <Card className="border-brand-accent/40 bg-blue-50/40">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand-accent">
                <Settings2 className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold text-gray-900">
                  Completa la configurazione del catalogo
                </h3>
                <p className="mt-0.5 text-sm text-gray-500">
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
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Batch recenti
        </h2>
        {batches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
                <PackageOpen className="h-7 w-7" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Nessun batch ancora
                </h2>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
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
          <div className="grid gap-4">
            {batches.map((b) => (
              <RecentBatchCard
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
    </div>
  );
}
