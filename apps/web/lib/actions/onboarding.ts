'use server';

import type { Json } from '@app/database';
import { ensureOrg, getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';

// =====================================================================
// Server actions dell'onboarding aziendale v2.
// Ogni action: verifica la sessione, verifica l'appartenenza all'org e
// NON lancia eccezioni (Next redige gli errori in produzione): restituisce
// sempre { ok:false, error } così il client vede il messaggio reale.
// Le SCRITTURE passano dal service client (bypassa la RLS) come da requisito.
// =====================================================================

type ServiceClient = ReturnType<typeof getServiceClient>;

type Fail = { ok: false; error: string };

/** Verifica sessione + appartenenza all'organizzazione. */
async function requireMember(
  organizationId: string,
): Promise<
  | { ok: true; service: ServiceClient; userId: string }
  | Fail
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const service = getServiceClient();
  const { data: member } = await service
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'Organizzazione non accessibile' };
  return { ok: true, service, userId: user.id };
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : 'Errore sconosciuto';
}

// ---------------------------------------------------------------------
// 1. Azienda
// ---------------------------------------------------------------------
export interface SaveCompanyInput {
  name: string;
  brandName: string;
  email: string;
  website?: string;
  country: string;
  language: string;
}

export async function saveCompanyAction(
  input: SaveCompanyInput,
): Promise<{ ok: true; organizationId: string } | Fail> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Non autenticato' };
    const name = input.name?.trim() || 'La mia azienda';
    const org = await ensureOrg(user.id, name);
    const service = getServiceClient();
    const { error } = await service
      .from('organizations')
      .update({ name })
      .eq('id', org.organizationId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, organizationId: org.organizationId };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// ---------------------------------------------------------------------
// 2. Stato onboarding (per riprendere dal punto giusto)
// ---------------------------------------------------------------------
export interface OnboardingState {
  organizationId: string;
  name: string;
  onboardingCompletedAt: string | null;
  sectorId: string | null;
  categoryIds: string[];
  attributeSelection: AttributeSelectionItem[];
  hasPreset: boolean;
  hasBrandProfile: boolean;
}

export async function getOnboardingDataAction(): Promise<
  { ok: true; state: OnboardingState | null } | Fail
> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Non autenticato' };
    const service = getServiceClient();

    const { data: member } = await service
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!member) return { ok: true, state: null };

    const organizationId = member.organization_id;

    const [org, sectorRow, cats, presetRow, brandRow, draftRow] =
      await Promise.all([
        service
          .from('organizations')
          .select('name, onboarding_completed_at')
          .eq('id', organizationId)
          .maybeSingle(),
        service
          .from('organization_sectors')
          .select('sector_id')
          .eq('organization_id', organizationId)
          .eq('is_primary', true)
          .maybeSingle(),
        service
          .from('organization_categories')
          .select('category_id')
          .eq('organization_id', organizationId)
          .eq('enabled', true),
        service
          .from('presets')
          .select('id')
          .eq('organization_id', organizationId)
          .limit(1),
        service
          .from('brand_profiles')
          .select('id')
          .eq('organization_id', organizationId)
          .limit(1),
        service
          .from('configuration_drafts')
          .select('draft_data_json')
          .eq('organization_id', organizationId)
          .eq('entity_type', 'preset')
          .eq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const draftData = (draftRow.data?.draft_data_json ?? null) as
      | { attributes?: AttributeSelectionItem[] }
      | null;

    const state: OnboardingState = {
      organizationId,
      name: org.data?.name ?? '',
      onboardingCompletedAt: org.data?.onboarding_completed_at ?? null,
      sectorId: sectorRow.data?.sector_id ?? null,
      categoryIds: (cats.data ?? []).map((c) => c.category_id),
      attributeSelection: Array.isArray(draftData?.attributes)
        ? draftData!.attributes
        : [],
      hasPreset: (presetRow.data ?? []).length > 0,
      hasBrandProfile: (brandRow.data ?? []).length > 0,
    };

    return { ok: true, state };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// ---------------------------------------------------------------------
// 2b. Selezione settore
// ---------------------------------------------------------------------
export async function selectSectorAction(input: {
  organizationId: string;
  sectorId: string;
}): Promise<{ ok: true } | Fail> {
  try {
    const auth = await requireMember(input.organizationId);
    if (!auth.ok) return auth;
    const { service } = auth;

    const { error: delErr } = await service
      .from('organization_sectors')
      .delete()
      .eq('organization_id', input.organizationId);
    if (delErr) return { ok: false, error: delErr.message };

    const { error: insErr } = await service
      .from('organization_sectors')
      .insert({
        organization_id: input.organizationId,
        sector_id: input.sectorId,
        is_primary: true,
      });
    if (insErr) return { ok: false, error: insErr.message };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// ---------------------------------------------------------------------
// 3. Categorie
// ---------------------------------------------------------------------
export async function saveCategoriesAction(input: {
  organizationId: string;
  categoryIds: string[];
}): Promise<{ ok: true } | Fail> {
  try {
    const auth = await requireMember(input.organizationId);
    if (!auth.ok) return auth;
    const { service } = auth;

    if (input.categoryIds.length === 0) {
      return { ok: false, error: 'Seleziona almeno una categoria' };
    }

    const { error: delErr } = await service
      .from('organization_categories')
      .delete()
      .eq('organization_id', input.organizationId);
    if (delErr) return { ok: false, error: delErr.message };

    const rows = input.categoryIds.map((category_id) => ({
      organization_id: input.organizationId,
      category_id,
      enabled: true,
    }));
    const { error: insErr } = await service
      .from('organization_categories')
      .insert(rows);
    if (insErr) return { ok: false, error: insErr.message };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// ---------------------------------------------------------------------
// 4. Selezione attributi (persistita in configuration_drafts)
// ---------------------------------------------------------------------
export interface AttributeSelectionItem {
  categoryId: string;
  attributeId: string;
  isRequired: boolean;
  enabled: boolean;
}

export async function saveAttributeSelectionAction(input: {
  organizationId: string;
  selection: AttributeSelectionItem[];
}): Promise<{ ok: true } | Fail> {
  try {
    const auth = await requireMember(input.organizationId);
    if (!auth.ok) return auth;
    const { service, userId } = auth;

    const draftData = { attributes: input.selection } as unknown as Json;

    const { data: existing } = await service
      .from('configuration_drafts')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('entity_type', 'preset')
      .eq('status', 'draft')
      .maybeSingle();

    if (existing) {
      const { error } = await service
        .from('configuration_drafts')
        .update({ draft_data_json: draftData })
        .eq('id', existing.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await service.from('configuration_drafts').insert({
        organization_id: input.organizationId,
        entity_type: 'preset',
        draft_data_json: draftData,
        status: 'draft',
        created_by: userId,
      });
      if (error) return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// ---------------------------------------------------------------------
// 5. Preset iniziale
// ---------------------------------------------------------------------
export interface PresetAttributeInput {
  categoryId: string;
  attributeId: string;
  isRequired: boolean;
  enabled: boolean;
  displayOrder: number;
}

const DEFAULT_GENERATED_FIELDS: { field_key: string; label: string }[] = [
  { field_key: 'generated_title', label: 'Titolo' },
  { field_key: 'short_description', label: 'Descrizione breve' },
  { field_key: 'long_description', label: 'Descrizione lunga' },
  { field_key: 'bullets', label: 'Punti elenco' },
  { field_key: 'meta_description', label: 'Meta description' },
];

export async function createInitialPresetAction(input: {
  organizationId: string;
  sectorId: string;
  name?: string;
  categoryIds: string[];
  attributes: PresetAttributeInput[];
}): Promise<{ ok: true; presetId: string; versionId: string } | Fail> {
  try {
    const auth = await requireMember(input.organizationId);
    if (!auth.ok) return auth;
    const { service, userId } = auth;

    if (input.categoryIds.length === 0) {
      return { ok: false, error: 'Nessuna categoria selezionata' };
    }

    const presetName = input.name?.trim() || 'Preset principale';

    const { data: preset, error: presetErr } = await service
      .from('presets')
      .insert({
        organization_id: input.organizationId,
        sector_id: input.sectorId,
        name: presetName,
        status: 'active',
      })
      .select('id')
      .single();
    if (presetErr || !preset) {
      return {
        ok: false,
        error: `Creazione preset fallita: ${presetErr?.message ?? 'sconosciuto'}`,
      };
    }

    const now = new Date().toISOString();
    const { data: version, error: versionErr } = await service
      .from('preset_versions')
      .insert({
        preset_id: preset.id,
        version: 1,
        name: presetName,
        created_by: userId,
        published_at: now,
      })
      .select('id')
      .single();
    if (versionErr || !version) {
      return {
        ok: false,
        error: `Creazione versione preset fallita: ${versionErr?.message ?? 'sconosciuto'}`,
      };
    }

    const catRows = input.categoryIds.map((category_id, i) => ({
      preset_version_id: version.id,
      category_id,
      display_order: i + 1,
      enabled: true,
    }));
    const { error: catErr } = await service
      .from('preset_categories')
      .insert(catRows);
    if (catErr) {
      return { ok: false, error: `Categorie preset fallite: ${catErr.message}` };
    }

    const attrRows = input.attributes
      .filter((a) => a.enabled)
      .map((a) => ({
        preset_version_id: version.id,
        attribute_id: a.attributeId,
        category_id: a.categoryId,
        is_required: a.isRequired,
        display_order: a.displayOrder,
        enabled: true,
      }));
    if (attrRows.length > 0) {
      const { error: attrErr } = await service
        .from('preset_attributes')
        .insert(attrRows);
      if (attrErr) {
        return {
          ok: false,
          error: `Attributi preset falliti: ${attrErr.message}`,
        };
      }
    }

    const fieldRows = DEFAULT_GENERATED_FIELDS.map((f, i) => ({
      preset_version_id: version.id,
      field_key: f.field_key,
      label: f.label,
      display_order: i + 1,
      enabled: true,
    }));
    const { error: fieldErr } = await service
      .from('preset_generated_fields')
      .insert(fieldRows);
    if (fieldErr) {
      return { ok: false, error: `Campi generati falliti: ${fieldErr.message}` };
    }

    const { error: updErr } = await service
      .from('presets')
      .update({ active_version_id: version.id })
      .eq('id', preset.id);
    if (updErr) return { ok: false, error: updErr.message };

    return { ok: true, presetId: preset.id, versionId: version.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// ---------------------------------------------------------------------
// 7. Completamento
// ---------------------------------------------------------------------
export async function completeOnboardingAction(input: {
  organizationId: string;
}): Promise<{ ok: true } | Fail> {
  try {
    const auth = await requireMember(input.organizationId);
    if (!auth.ok) return auth;
    const { service, userId } = auth;

    const { error } = await service
      .from('organizations')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('id', input.organizationId);
    if (error) return { ok: false, error: error.message };

    await service.from('app_events').insert({
      organization_id: input.organizationId,
      user_id: userId,
      event_name: 'onboarding_completed',
      metadata_json: { flow: 'v2' } as unknown as Json,
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
