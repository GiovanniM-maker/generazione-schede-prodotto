'use server';

import type { Json } from '@app/database';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';

// =====================================================================
// Server actions per l'area "Configurazione catalogo".
//
// Ogni action:
//  * verifica la sessione utente (getSessionUser)
//  * risolve l'organizzazione e verifica l'appartenenza via
//    organization_members (service client, bypassa RLS)
//  * usa il service client per le SCRITTURE
//  * NON lancia mai eccezioni oltre il confine server: restituisce sempre
//    un'unione discriminata { ok:true, ... } | { ok:false, error }.
//
// Regole di dominio:
//  * Le righe di SISTEMA (owner_organization_id null) non sono mai
//    modificate direttamente: si crea una copia personalizzata dell'org.
//  * I preset PUBBLICATI non si modificano: si crea una nuova BOZZA
//    (clonando categorie/attributi/campi) e si modifica quella.
// =====================================================================

type ServiceClient = ReturnType<typeof getServiceClient>;
type Fail = { ok: false; error: string };
type Ok<T> = { ok: true } & T;
type OkVoid = { ok: true };

interface Ctx {
  ok: true;
  service: ServiceClient;
  organizationId: string;
  userId: string;
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : 'Errore sconosciuto';
}

/** Numero massimo di voci creabili in un'unica importazione da lista. */
const MAX_LIST_ITEMS = 300;

/**
 * Estrae una lista di nomi da testo incollato: una voce per riga, oppure
 * separate da virgola/punto e virgola/tab. Rimuove vuoti e duplicati
 * (case-insensitive), preservando il primo ordine di comparsa.
 */
function parseNameList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[\n,;\t]+/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

/** Risolve sessione + organizzazione + appartenenza in un colpo solo. */
async function requireOrg(): Promise<Ctx | Fail> {
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
  if (!member) return { ok: false, error: 'Nessuna organizzazione associata' };
  return {
    ok: true,
    service,
    organizationId: member.organization_id,
    userId: user.id,
  };
}

const DEFAULT_GENERATED_FIELDS: { field_key: string; label: string }[] = [
  { field_key: 'generated_title', label: 'Titolo' },
  { field_key: 'short_description', label: 'Descrizione breve' },
  { field_key: 'long_description', label: 'Descrizione lunga' },
  { field_key: 'bullets', label: 'Punti elenco' },
  { field_key: 'meta_description', label: 'Meta description' },
];

// =====================================================================
// Tipi di ritorno (usati anche dalle pagine)
// =====================================================================

export interface SectorRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
}

export interface PresetListItem {
  id: string;
  name: string;
  sectorId: string;
  sectorName: string;
  categoryCount: number;
  attributeCount: number;
  version: number;
  status: string;
  isPublished: boolean;
  updatedAt: string;
}

export interface CategoryListItem {
  id: string;
  name: string;
  description: string | null;
  sectorId: string;
  sectorName: string;
  isSystem: boolean;
  attributeCount: number;
}

export interface AttributeListItem {
  id: string;
  name: string;
  description: string | null;
  sectorId: string;
  sectorName: string;
  attributeKind: string;
  dataType: string;
  unit: string | null;
  isSystem: boolean;
  usageCount: number;
}

export interface PresetAttrRow {
  id: string;
  attributeId: string;
  name: string;
  attributeKind: string;
  dataType: string;
  isRequired: boolean;
  displayOrder: number;
  enabled: boolean;
  extractionOverride: string | null;
  generationOverride: string | null;
  defaultExtraction: string | null;
  defaultGeneration: string | null;
}

export interface PresetCategoryGroup {
  presetCategoryId: string;
  categoryId: string;
  name: string;
  isSystem: boolean;
  displayOrder: number;
  enabled: boolean;
  attributes: PresetAttrRow[];
}

export interface PresetGeneratedFieldRow {
  id: string;
  fieldKey: string;
  label: string | null;
  displayOrder: number;
  enabled: boolean;
}

export interface PresetDetail {
  preset: {
    id: string;
    name: string;
    description: string | null;
    sectorId: string;
    sectorName: string;
    status: string;
  };
  workingVersionId: string;
  workingVersion: number;
  isDraft: boolean;
  hasPublishedVersion: boolean;
  categories: PresetCategoryGroup[];
  generalAttributes: PresetAttrRow[];
  generatedFields: PresetGeneratedFieldRow[];
  availableCategories: { id: string; name: string; isSystem: boolean }[];
  availableAttributes: {
    id: string;
    name: string;
    attributeKind: string;
    dataType: string;
  }[];
}

export interface CategoryAttrRow {
  id: string;
  attributeId: string;
  name: string;
  attributeKind: string;
  dataType: string;
  isRequired: boolean;
  displayOrder: number;
  extractionOverride: string | null;
  generationOverride: string | null;
  defaultExtraction: string | null;
  defaultGeneration: string | null;
}

export interface CategoryDetail {
  category: {
    id: string;
    name: string;
    description: string | null;
    sectorId: string;
    sectorName: string;
    isSystem: boolean;
    sourceCategoryId: string | null;
  };
  attributes: CategoryAttrRow[];
  availableAttributes: {
    id: string;
    name: string;
    attributeKind: string;
    dataType: string;
  }[];
  usedByPresets: { id: string; name: string }[];
}

export interface AttributeDetail {
  attribute: {
    id: string;
    name: string;
    description: string | null;
    sectorId: string;
    sectorName: string;
    attributeKind: string;
    dataType: string;
    unit: string | null;
    enumValues: string[];
    extractionInstruction: string | null;
    generationInstruction: string | null;
    validationRules: Json;
    normalizationRules: Json;
    isSystem: boolean;
    version: number;
    sourceAttributeId: string | null;
  };
  usedByCategories: { id: string; name: string }[];
  usedByPresets: { id: string; name: string }[];
}

// =====================================================================
// Sectors
// =====================================================================

export async function listSectors(): Promise<
  Ok<{ sectors: SectorRow[] }> | Fail
> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { data, error } = await auth.service
      .from('sectors')
      .select('id, key, name, description, icon')
      .eq('status', 'active')
      .order('name', { ascending: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true, sectors: (data ?? []) as SectorRow[] };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

async function sectorNameMap(
  service: ServiceClient,
): Promise<Map<string, string>> {
  const { data } = await service.from('sectors').select('id, name');
  const map = new Map<string, string>();
  for (const s of data ?? []) map.set(s.id, s.name);
  return map;
}

// =====================================================================
// Presets
// =====================================================================

export async function listPresets(): Promise<
  Ok<{ presets: PresetListItem[] }> | Fail
> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: presets, error } = await service
      .from('presets')
      .select(
        'id, name, sector_id, status, active_version_id, updated_at',
      )
      .eq('organization_id', organizationId)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false });
    if (error) return { ok: false, error: error.message };

    const sectors = await sectorNameMap(service);
    const list: PresetListItem[] = [];

    for (const p of presets ?? []) {
      // Versione di riferimento: la bozza più recente, altrimenti l'attiva.
      const { data: versions } = await service
        .from('preset_versions')
        .select('id, version, published_at')
        .eq('preset_id', p.id)
        .order('version', { ascending: false });
      const draft = (versions ?? []).find((v) => v.published_at === null);
      const published = (versions ?? []).find((v) => v.published_at !== null);
      const working = draft ?? published ?? (versions ?? [])[0];
      let categoryCount = 0;
      let attributeCount = 0;
      if (working) {
        const [cats, attrs] = await Promise.all([
          service
            .from('preset_categories')
            .select('id', { count: 'exact', head: true })
            .eq('preset_version_id', working.id),
          service
            .from('preset_attributes')
            .select('id', { count: 'exact', head: true })
            .eq('preset_version_id', working.id),
        ]);
        categoryCount = cats.count ?? 0;
        attributeCount = attrs.count ?? 0;
      }
      list.push({
        id: p.id,
        name: p.name,
        sectorId: p.sector_id,
        sectorName: sectors.get(p.sector_id) ?? '—',
        categoryCount,
        attributeCount,
        version: working?.version ?? 1,
        status: p.status,
        isPublished: Boolean(published),
        updatedAt: p.updated_at,
      });
    }

    return { ok: true, presets: list };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createPreset(input: {
  sectorId: string;
  name: string;
}): Promise<Ok<{ presetId: string }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId, userId } = auth;

    const name = input.name?.trim();
    if (!name) return { ok: false, error: 'Il nome è obbligatorio' };
    if (!input.sectorId) return { ok: false, error: 'Settore obbligatorio' };

    const { data: preset, error: pErr } = await service
      .from('presets')
      .insert({
        organization_id: organizationId,
        sector_id: input.sectorId,
        name,
        status: 'active',
      })
      .select('id')
      .single();
    if (pErr || !preset) {
      return { ok: false, error: `Creazione preset fallita: ${pErr?.message}` };
    }

    const { data: version, error: vErr } = await service
      .from('preset_versions')
      .insert({
        preset_id: preset.id,
        version: 1,
        name,
        created_by: userId,
        published_at: null,
      })
      .select('id')
      .single();
    if (vErr || !version) {
      return { ok: false, error: `Creazione versione fallita: ${vErr?.message}` };
    }

    // Copia le categorie di sistema del settore + i relativi attributi.
    const { data: sysCats } = await service
      .from('categories')
      .select('id')
      .eq('sector_id', input.sectorId)
      .is('owner_organization_id', null)
      .eq('status', 'active')
      .order('name', { ascending: true });

    const catIds = (sysCats ?? []).map((c) => c.id);
    if (catIds.length > 0) {
      const catRows = catIds.map((category_id, i) => ({
        preset_version_id: version.id,
        category_id,
        display_order: i + 1,
        enabled: true,
      }));
      await service.from('preset_categories').insert(catRows);

      const { data: links } = await service
        .from('category_attributes')
        .select(
          'category_id, attribute_id, is_required, display_order, extraction_instruction_override, generation_instruction_override',
        )
        .in('category_id', catIds);

      if (links && links.length > 0) {
        const attrRows = links.map((l) => ({
          preset_version_id: version.id,
          attribute_id: l.attribute_id,
          category_id: l.category_id,
          is_required: l.is_required,
          display_order: l.display_order,
          extraction_instruction_override: l.extraction_instruction_override,
          generation_instruction_override: l.generation_instruction_override,
          enabled: true,
        }));
        // Dedup su (attribute_id, category_id) per rispettare l'unique.
        const seen = new Set<string>();
        const deduped = attrRows.filter((r) => {
          const k = `${r.attribute_id}:${r.category_id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (deduped.length > 0) {
          await service.from('preset_attributes').insert(deduped);
        }
      }
    }

    const fieldRows = DEFAULT_GENERATED_FIELDS.map((f, i) => ({
      preset_version_id: version.id,
      field_key: f.field_key,
      label: f.label,
      display_order: i + 1,
      enabled: true,
    }));
    await service.from('preset_generated_fields').insert(fieldRows);

    await service
      .from('presets')
      .update({ active_version_id: version.id })
      .eq('id', preset.id);

    return { ok: true, presetId: preset.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Verifica che il preset appartenga all'org e ritorna la riga. */
async function loadOwnedPreset(
  service: ServiceClient,
  organizationId: string,
  presetId: string,
) {
  const { data } = await service
    .from('presets')
    .select('id, name, description, sector_id, status, active_version_id, organization_id')
    .eq('id', presetId)
    .maybeSingle();
  if (!data || data.organization_id !== organizationId) return null;
  return data;
}

export async function renamePreset(input: {
  presetId: string;
  name: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const name = input.name?.trim();
    if (!name) return { ok: false, error: 'Il nome è obbligatorio' };
    const preset = await loadOwnedPreset(service, organizationId, input.presetId);
    if (!preset) return { ok: false, error: 'Preset non trovato' };
    const { error } = await service
      .from('presets')
      .update({ name })
      .eq('id', input.presetId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function archivePreset(input: {
  presetId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const preset = await loadOwnedPreset(service, organizationId, input.presetId);
    if (!preset) return { ok: false, error: 'Preset non trovato' };
    const { error } = await service
      .from('presets')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', input.presetId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function duplicatePreset(input: {
  presetId: string;
}): Promise<Ok<{ presetId: string }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId, userId } = auth;
    const preset = await loadOwnedPreset(service, organizationId, input.presetId);
    if (!preset) return { ok: false, error: 'Preset non trovato' };

    // Versione sorgente: attiva se presente, altrimenti l'ultima.
    let sourceVersionId = preset.active_version_id;
    if (!sourceVersionId) {
      const { data: latest } = await service
        .from('preset_versions')
        .select('id')
        .eq('preset_id', preset.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      sourceVersionId = latest?.id ?? null;
    }

    const { data: newPreset, error: pErr } = await service
      .from('presets')
      .insert({
        organization_id: organizationId,
        sector_id: preset.sector_id,
        name: `${preset.name} (copia)`,
        description: preset.description,
        status: 'active',
      })
      .select('id')
      .single();
    if (pErr || !newPreset) {
      return { ok: false, error: `Duplicazione fallita: ${pErr?.message}` };
    }

    const { data: newVersion, error: vErr } = await service
      .from('preset_versions')
      .insert({
        preset_id: newPreset.id,
        version: 1,
        name: `${preset.name} (copia)`,
        created_by: userId,
        published_at: null,
      })
      .select('id')
      .single();
    if (vErr || !newVersion) {
      return { ok: false, error: `Versione fallita: ${vErr?.message}` };
    }

    if (sourceVersionId) {
      await cloneVersionContent(service, sourceVersionId, newVersion.id);
    } else {
      const fieldRows = DEFAULT_GENERATED_FIELDS.map((f, i) => ({
        preset_version_id: newVersion.id,
        field_key: f.field_key,
        label: f.label,
        display_order: i + 1,
        enabled: true,
      }));
      await service.from('preset_generated_fields').insert(fieldRows);
    }

    await service
      .from('presets')
      .update({ active_version_id: newVersion.id })
      .eq('id', newPreset.id);

    return { ok: true, presetId: newPreset.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Clona categorie/attributi/campi da una versione all'altra. */
async function cloneVersionContent(
  service: ServiceClient,
  fromVersionId: string,
  toVersionId: string,
): Promise<void> {
  const [cats, attrs, fields] = await Promise.all([
    service
      .from('preset_categories')
      .select('category_id, display_order, enabled')
      .eq('preset_version_id', fromVersionId),
    service
      .from('preset_attributes')
      .select(
        'attribute_id, category_id, is_required, display_order, extraction_instruction_override, generation_instruction_override, validation_rules_override_json, enabled',
      )
      .eq('preset_version_id', fromVersionId),
    service
      .from('preset_generated_fields')
      .select('field_key, label, display_order, enabled, config_json')
      .eq('preset_version_id', fromVersionId),
  ]);

  if (cats.data && cats.data.length > 0) {
    await service.from('preset_categories').insert(
      cats.data.map((c) => ({
        preset_version_id: toVersionId,
        category_id: c.category_id,
        display_order: c.display_order,
        enabled: c.enabled,
      })),
    );
  }
  if (attrs.data && attrs.data.length > 0) {
    await service.from('preset_attributes').insert(
      attrs.data.map((a) => ({
        preset_version_id: toVersionId,
        attribute_id: a.attribute_id,
        category_id: a.category_id,
        is_required: a.is_required,
        display_order: a.display_order,
        extraction_instruction_override: a.extraction_instruction_override,
        generation_instruction_override: a.generation_instruction_override,
        validation_rules_override_json: a.validation_rules_override_json,
        enabled: a.enabled,
      })),
    );
  }
  if (fields.data && fields.data.length > 0) {
    await service.from('preset_generated_fields').insert(
      fields.data.map((f) => ({
        preset_version_id: toVersionId,
        field_key: f.field_key,
        label: f.label,
        display_order: f.display_order,
        enabled: f.enabled,
        config_json: f.config_json,
      })),
    );
  }
}

/**
 * Garantisce l'esistenza di una versione BOZZA modificabile per il preset.
 * Se l'ultima versione è pubblicata, ne clona i contenuti in una nuova bozza.
 */
export async function ensureDraftVersion(input: {
  presetId: string;
}): Promise<Ok<{ versionId: string; created: boolean }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId, userId } = auth;
    const preset = await loadOwnedPreset(service, organizationId, input.presetId);
    if (!preset) return { ok: false, error: 'Preset non trovato' };

    const { data: versions } = await service
      .from('preset_versions')
      .select('id, version, published_at')
      .eq('preset_id', preset.id)
      .order('version', { ascending: false });

    const draft = (versions ?? []).find((v) => v.published_at === null);
    if (draft) return { ok: true, versionId: draft.id, created: false };

    const latest = (versions ?? [])[0];
    const nextVersion = (latest?.version ?? 0) + 1;

    const { data: newVersion, error: vErr } = await service
      .from('preset_versions')
      .insert({
        preset_id: preset.id,
        version: nextVersion,
        name: preset.name,
        created_by: userId,
        published_at: null,
      })
      .select('id')
      .single();
    if (vErr || !newVersion) {
      return { ok: false, error: `Creazione bozza fallita: ${vErr?.message}` };
    }

    if (latest) {
      await cloneVersionContent(service, latest.id, newVersion.id);
    }
    return { ok: true, versionId: newVersion.id, created: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function publishPresetVersion(input: {
  presetId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const preset = await loadOwnedPreset(service, organizationId, input.presetId);
    if (!preset) return { ok: false, error: 'Preset non trovato' };

    const { data: draft } = await service
      .from('preset_versions')
      .select('id')
      .eq('preset_id', preset.id)
      .is('published_at', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!draft) return { ok: false, error: 'Nessuna bozza da pubblicare' };

    // Pubblicazione in due passi (manca una transazione lato DB): marca la
    // versione come pubblicata e poi la rende attiva. Se il secondo passo
    // fallisce, annulla il primo per non lasciare una versione "pubblicata ma
    // non attiva" (stato incoerente che confonderebbe la dashboard).
    const now = new Date().toISOString();
    const { error: upErr } = await service
      .from('preset_versions')
      .update({ published_at: now })
      .eq('id', draft.id);
    if (upErr) return { ok: false, error: upErr.message };

    const { error: pErr } = await service
      .from('presets')
      .update({ active_version_id: draft.id })
      .eq('id', preset.id);
    if (pErr) {
      // Rollback compensativo del primo passo.
      await service
        .from('preset_versions')
        .update({ published_at: null })
        .eq('id', draft.id);
      return { ok: false, error: pErr.message };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getPresetDetail(input: {
  presetId: string;
}): Promise<Ok<{ detail: PresetDetail }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const preset = await loadOwnedPreset(service, organizationId, input.presetId);
    if (!preset) return { ok: false, error: 'Preset non trovato' };

    const { data: versions } = await service
      .from('preset_versions')
      .select('id, version, published_at')
      .eq('preset_id', preset.id)
      .order('version', { ascending: false });

    const draft = (versions ?? []).find((v) => v.published_at === null);
    const published = (versions ?? []).find((v) => v.published_at !== null);
    const working = draft ?? published ?? (versions ?? [])[0];
    if (!working) return { ok: false, error: 'Preset senza versioni' };

    const sectors = await sectorNameMap(service);

    const [pCats, pAttrs, pFields, sectorCats, sectorAttrs] = await Promise.all([
      service
        .from('preset_categories')
        .select('id, category_id, display_order, enabled')
        .eq('preset_version_id', working.id)
        .order('display_order', { ascending: true }),
      service
        .from('preset_attributes')
        .select(
          'id, attribute_id, category_id, is_required, display_order, enabled, extraction_instruction_override, generation_instruction_override',
        )
        .eq('preset_version_id', working.id)
        .order('display_order', { ascending: true }),
      service
        .from('preset_generated_fields')
        .select('id, field_key, label, display_order, enabled')
        .eq('preset_version_id', working.id)
        .order('display_order', { ascending: true }),
      service
        .from('categories')
        .select('id, name, owner_organization_id')
        .eq('sector_id', preset.sector_id)
        .eq('status', 'active')
        .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`),
      service
        .from('attributes')
        .select(
          'id, name, attribute_kind, data_type, default_extraction_instruction, default_generation_instruction, owner_organization_id',
        )
        .eq('sector_id', preset.sector_id)
        .eq('status', 'active')
        .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`),
    ]);

    const catName = new Map<string, { name: string; isSystem: boolean }>();
    for (const c of sectorCats.data ?? []) {
      catName.set(c.id, {
        name: c.name,
        isSystem: c.owner_organization_id === null,
      });
    }
    const attrInfo = new Map<
      string,
      {
        name: string;
        attributeKind: string;
        dataType: string;
        defaultExtraction: string | null;
        defaultGeneration: string | null;
      }
    >();
    for (const a of sectorAttrs.data ?? []) {
      attrInfo.set(a.id, {
        name: a.name,
        attributeKind: a.attribute_kind,
        dataType: a.data_type,
        defaultExtraction: a.default_extraction_instruction,
        defaultGeneration: a.default_generation_instruction,
      });
    }

    function buildAttrRow(a: {
      id: string;
      attribute_id: string;
      is_required: boolean;
      display_order: number;
      enabled: boolean;
      extraction_instruction_override: string | null;
      generation_instruction_override: string | null;
    }): PresetAttrRow {
      const info = attrInfo.get(a.attribute_id);
      return {
        id: a.id,
        attributeId: a.attribute_id,
        name: info?.name ?? 'Attributo',
        attributeKind: info?.attributeKind ?? 'factual',
        dataType: info?.dataType ?? 'text',
        isRequired: a.is_required,
        displayOrder: a.display_order,
        enabled: a.enabled,
        extractionOverride: a.extraction_instruction_override,
        generationOverride: a.generation_instruction_override,
        defaultExtraction: info?.defaultExtraction ?? null,
        defaultGeneration: info?.defaultGeneration ?? null,
      };
    }

    const attrsByCat = new Map<string, PresetAttrRow[]>();
    const general: PresetAttrRow[] = [];
    for (const a of pAttrs.data ?? []) {
      const row = buildAttrRow(a);
      if (a.category_id) {
        const arr = attrsByCat.get(a.category_id) ?? [];
        arr.push(row);
        attrsByCat.set(a.category_id, arr);
      } else {
        general.push(row);
      }
    }

    const categories: PresetCategoryGroup[] = (pCats.data ?? []).map((c) => {
      const info = catName.get(c.category_id);
      return {
        presetCategoryId: c.id,
        categoryId: c.category_id,
        name: info?.name ?? 'Categoria',
        isSystem: info?.isSystem ?? false,
        displayOrder: c.display_order,
        enabled: c.enabled,
        attributes: attrsByCat.get(c.category_id) ?? [],
      };
    });

    const inPresetCatIds = new Set(
      (pCats.data ?? []).map((c) => c.category_id),
    );
    const availableCategories = (sectorCats.data ?? [])
      .filter((c) => !inPresetCatIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        isSystem: c.owner_organization_id === null,
      }));

    const availableAttributes = (sectorAttrs.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      attributeKind: a.attribute_kind,
      dataType: a.data_type,
    }));

    const detail: PresetDetail = {
      preset: {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        sectorId: preset.sector_id,
        sectorName: sectors.get(preset.sector_id) ?? '—',
        status: preset.status,
      },
      workingVersionId: working.id,
      workingVersion: working.version,
      isDraft: working.published_at === null,
      hasPublishedVersion: Boolean(published),
      categories,
      generalAttributes: general,
      generatedFields: (pFields.data ?? []).map((f) => ({
        id: f.id,
        fieldKey: f.field_key,
        label: f.label,
        displayOrder: f.display_order,
        enabled: f.enabled,
      })),
      availableCategories,
      availableAttributes,
    };

    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Verifica che una versione appartenga a un preset dell'org e sia BOZZA. */
async function requireDraftVersion(
  service: ServiceClient,
  organizationId: string,
  presetVersionId: string,
): Promise<{ ok: true; presetId: string } | Fail> {
  const { data: version } = await service
    .from('preset_versions')
    .select('id, preset_id, published_at')
    .eq('id', presetVersionId)
    .maybeSingle();
  if (!version) return { ok: false, error: 'Versione non trovata' };
  const preset = await loadOwnedPreset(service, organizationId, version.preset_id);
  if (!preset) return { ok: false, error: 'Preset non accessibile' };
  if (version.published_at !== null) {
    return {
      ok: false,
      error: 'Versione pubblicata: crea prima una bozza',
    };
  }
  return { ok: true, presetId: version.preset_id };
}

/**
 * Verifica che una categoria sia accessibile dall'org: di sistema
 * (owner_organization_id null) oppure di proprietà dell'org. Impedisce di
 * agganciare risorse di ALTRE organizzazioni tramite id manipolati.
 */
async function requireAccessibleCategory(
  service: ServiceClient,
  organizationId: string,
  categoryId: string,
): Promise<OkVoid | Fail> {
  const { data } = await service
    .from('categories')
    .select('id, owner_organization_id')
    .eq('id', categoryId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'Categoria non trovata' };
  if (data.owner_organization_id !== null && data.owner_organization_id !== organizationId) {
    return { ok: false, error: 'Categoria non accessibile' };
  }
  return { ok: true };
}

/** Come sopra ma per gli attributi. */
async function requireAccessibleAttribute(
  service: ServiceClient,
  organizationId: string,
  attributeId: string,
): Promise<OkVoid | Fail> {
  const { data } = await service
    .from('attributes')
    .select('id, owner_organization_id')
    .eq('id', attributeId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'Attributo non trovato' };
  if (data.owner_organization_id !== null && data.owner_organization_id !== organizationId) {
    return { ok: false, error: 'Attributo non accessibile' };
  }
  return { ok: true };
}

export async function addCategoryToPreset(input: {
  presetVersionId: string;
  categoryId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const chk = await requireDraftVersion(
      service,
      organizationId,
      input.presetVersionId,
    );
    if (!chk.ok) return chk;
    const catChk = await requireAccessibleCategory(
      service,
      organizationId,
      input.categoryId,
    );
    if (!catChk.ok) return catChk;

    const { data: existing } = await service
      .from('preset_categories')
      .select('display_order')
      .eq('preset_version_id', input.presetVersionId)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (existing?.display_order ?? 0) + 1;

    const { error } = await service.from('preset_categories').insert({
      preset_version_id: input.presetVersionId,
      category_id: input.categoryId,
      display_order: nextOrder,
      enabled: true,
    });
    if (error) return { ok: false, error: error.message };

    // Porta anche gli attributi della categoria per rendere il preset usabile.
    const { data: links } = await service
      .from('category_attributes')
      .select(
        'attribute_id, is_required, display_order, extraction_instruction_override, generation_instruction_override',
      )
      .eq('category_id', input.categoryId);
    if (links && links.length > 0) {
      const rows = links.map((l) => ({
        preset_version_id: input.presetVersionId,
        attribute_id: l.attribute_id,
        category_id: input.categoryId,
        is_required: l.is_required,
        display_order: l.display_order,
        extraction_instruction_override: l.extraction_instruction_override,
        generation_instruction_override: l.generation_instruction_override,
        enabled: true,
      }));
      await service.from('preset_attributes').insert(rows);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function removeCategoryFromPreset(input: {
  presetCategoryId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: row } = await service
      .from('preset_categories')
      .select('id, preset_version_id, category_id')
      .eq('id', input.presetCategoryId)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Categoria non trovata nel preset' };
    const chk = await requireDraftVersion(
      service,
      organizationId,
      row.preset_version_id,
    );
    if (!chk.ok) return chk;

    // Rimuovi gli attributi legati a questa categoria nella versione.
    await service
      .from('preset_attributes')
      .delete()
      .eq('preset_version_id', row.preset_version_id)
      .eq('category_id', row.category_id);

    const { error } = await service
      .from('preset_categories')
      .delete()
      .eq('id', input.presetCategoryId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function addAttributeToPreset(input: {
  presetVersionId: string;
  attributeId: string;
  categoryId?: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const chk = await requireDraftVersion(
      service,
      organizationId,
      input.presetVersionId,
    );
    if (!chk.ok) return chk;
    const attrChk = await requireAccessibleAttribute(
      service,
      organizationId,
      input.attributeId,
    );
    if (!attrChk.ok) return attrChk;
    if (input.categoryId) {
      const catChk = await requireAccessibleCategory(
        service,
        organizationId,
        input.categoryId,
      );
      if (!catChk.ok) return catChk;
    }

    const { data: existing } = await service
      .from('preset_attributes')
      .select('display_order')
      .eq('preset_version_id', input.presetVersionId)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (existing?.display_order ?? 0) + 1;

    const { error } = await service.from('preset_attributes').insert({
      preset_version_id: input.presetVersionId,
      attribute_id: input.attributeId,
      category_id: input.categoryId ?? null,
      is_required: false,
      display_order: nextOrder,
      enabled: true,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function removeAttributeFromPreset(input: {
  presetAttributeId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: row } = await service
      .from('preset_attributes')
      .select('id, preset_version_id')
      .eq('id', input.presetAttributeId)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Attributo non trovato nel preset' };
    const chk = await requireDraftVersion(
      service,
      organizationId,
      row.preset_version_id,
    );
    if (!chk.ok) return chk;

    const { error } = await service
      .from('preset_attributes')
      .delete()
      .eq('id', input.presetAttributeId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function setPresetAttribute(input: {
  id: string;
  isRequired?: boolean;
  displayOrder?: number;
  enabled?: boolean;
  extractionOverride?: string | null;
  generationOverride?: string | null;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: row } = await service
      .from('preset_attributes')
      .select('id, preset_version_id')
      .eq('id', input.id)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Attributo non trovato' };
    const chk = await requireDraftVersion(
      service,
      organizationId,
      row.preset_version_id,
    );
    if (!chk.ok) return chk;

    const patch: Record<string, unknown> = {};
    if (input.isRequired !== undefined) patch.is_required = input.isRequired;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.extractionOverride !== undefined)
      patch.extraction_instruction_override = input.extractionOverride || null;
    if (input.generationOverride !== undefined)
      patch.generation_instruction_override = input.generationOverride || null;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await service
      .from('preset_attributes')
      .update(patch)
      .eq('id', input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// =====================================================================
// Categories
// =====================================================================

export async function listCategories(input?: {
  sectorId?: string;
}): Promise<Ok<{ categories: CategoryListItem[] }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    let query = service
      .from('categories')
      .select(
        'id, name, description, sector_id, owner_organization_id, status',
      )
      .eq('status', 'active')
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
    if (input?.sectorId) query = query.eq('sector_id', input.sectorId);
    const { data: cats, error } = await query.order('name', {
      ascending: true,
    });
    if (error) return { ok: false, error: error.message };

    const sectors = await sectorNameMap(service);
    const ids = (cats ?? []).map((c) => c.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: links } = await service
        .from('category_attributes')
        .select('category_id')
        .in('category_id', ids);
      for (const l of links ?? []) {
        counts.set(l.category_id, (counts.get(l.category_id) ?? 0) + 1);
      }
    }

    const categories: CategoryListItem[] = (cats ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sectorId: c.sector_id,
      sectorName: sectors.get(c.sector_id) ?? '—',
      isSystem: c.owner_organization_id === null,
      attributeCount: counts.get(c.id) ?? 0,
    }));

    return { ok: true, categories };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createCategory(input: {
  sectorId: string;
  name: string;
  description?: string;
  parentCategoryId?: string;
}): Promise<Ok<{ categoryId: string }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const name = input.name?.trim();
    if (!name) return { ok: false, error: 'Il nome è obbligatorio' };
    if (!input.sectorId) return { ok: false, error: 'Settore obbligatorio' };

    const { data, error } = await service
      .from('categories')
      .insert({
        sector_id: input.sectorId,
        owner_organization_id: organizationId,
        parent_category_id: input.parentCategoryId ?? null,
        name,
        description: input.description?.trim() || null,
        is_system: false,
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !data) {
      return { ok: false, error: `Creazione fallita: ${error?.message}` };
    }
    return { ok: true, categoryId: data.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function duplicateSystemCategory(input: {
  categoryId: string;
}): Promise<Ok<{ categoryId: string }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: src } = await service
      .from('categories')
      .select(
        'id, sector_id, parent_category_id, name, description, owner_organization_id',
      )
      .eq('id', input.categoryId)
      .maybeSingle();
    if (!src) return { ok: false, error: 'Categoria non trovata' };
    // Non consentire di duplicare categorie private di ALTRE organizzazioni:
    // ammesse solo quelle di sistema o già di proprietà dell'org.
    if (
      src.owner_organization_id !== null &&
      src.owner_organization_id !== organizationId
    ) {
      return { ok: false, error: 'Categoria non accessibile' };
    }

    const { data: copy, error } = await service
      .from('categories')
      .insert({
        sector_id: src.sector_id,
        owner_organization_id: organizationId,
        parent_category_id: src.parent_category_id,
        source_category_id: src.id,
        name: `${src.name} (personalizzata)`,
        description: src.description,
        is_system: false,
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !copy) {
      return { ok: false, error: `Duplicazione fallita: ${error?.message}` };
    }

    const { data: links } = await service
      .from('category_attributes')
      .select(
        'attribute_id, is_required, display_order, extraction_instruction_override, generation_instruction_override, validation_rules_override_json',
      )
      .eq('category_id', src.id);
    if (links && links.length > 0) {
      await service.from('category_attributes').insert(
        links.map((l) => ({
          category_id: copy.id,
          attribute_id: l.attribute_id,
          is_required: l.is_required,
          display_order: l.display_order,
          extraction_instruction_override: l.extraction_instruction_override,
          generation_instruction_override: l.generation_instruction_override,
          validation_rules_override_json: l.validation_rules_override_json,
        })),
      );
    }
    return { ok: true, categoryId: copy.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getCategoryDetail(input: {
  categoryId: string;
}): Promise<Ok<{ detail: CategoryDetail }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: cat } = await service
      .from('categories')
      .select(
        'id, name, description, sector_id, owner_organization_id, source_category_id',
      )
      .eq('id', input.categoryId)
      .maybeSingle();
    if (!cat) return { ok: false, error: 'Categoria non trovata' };
    if (
      cat.owner_organization_id !== null &&
      cat.owner_organization_id !== organizationId
    ) {
      return { ok: false, error: 'Categoria non accessibile' };
    }

    const sectors = await sectorNameMap(service);
    const isSystem = cat.owner_organization_id === null;

    const { data: links } = await service
      .from('category_attributes')
      .select(
        'id, attribute_id, is_required, display_order, extraction_instruction_override, generation_instruction_override',
      )
      .eq('category_id', cat.id)
      .order('display_order', { ascending: true });

    const attrIds = (links ?? []).map((l) => l.attribute_id);
    const attrInfo = new Map<
      string,
      {
        name: string;
        attributeKind: string;
        dataType: string;
        defaultExtraction: string | null;
        defaultGeneration: string | null;
      }
    >();
    if (attrIds.length > 0) {
      const { data: attrs } = await service
        .from('attributes')
        .select(
          'id, name, attribute_kind, data_type, default_extraction_instruction, default_generation_instruction',
        )
        .in('id', attrIds);
      for (const a of attrs ?? []) {
        attrInfo.set(a.id, {
          name: a.name,
          attributeKind: a.attribute_kind,
          dataType: a.data_type,
          defaultExtraction: a.default_extraction_instruction,
          defaultGeneration: a.default_generation_instruction,
        });
      }
    }

    const attributes: CategoryAttrRow[] = (links ?? []).map((l) => {
      const info = attrInfo.get(l.attribute_id);
      return {
        id: l.id,
        attributeId: l.attribute_id,
        name: info?.name ?? 'Attributo',
        attributeKind: info?.attributeKind ?? 'factual',
        dataType: info?.dataType ?? 'text',
        isRequired: l.is_required,
        displayOrder: l.display_order,
        extractionOverride: l.extraction_instruction_override,
        generationOverride: l.generation_instruction_override,
        defaultExtraction: info?.defaultExtraction ?? null,
        defaultGeneration: info?.defaultGeneration ?? null,
      };
    });

    // Attributi del settore disponibili (non ancora collegati).
    const linkedIds = new Set(attrIds);
    const { data: sectorAttrs } = await service
      .from('attributes')
      .select('id, name, attribute_kind, data_type, owner_organization_id')
      .eq('sector_id', cat.sector_id)
      .eq('status', 'active')
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`)
      .order('name', { ascending: true });
    const availableAttributes = (sectorAttrs ?? [])
      .filter((a) => !linkedIds.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        attributeKind: a.attribute_kind,
        dataType: a.data_type,
      }));

    // Preset che usano la categoria.
    const { data: presetCats } = await service
      .from('preset_categories')
      .select('preset_version_id')
      .eq('category_id', cat.id);
    const usedByPresets: { id: string; name: string }[] = [];
    const versionIds = Array.from(
      new Set((presetCats ?? []).map((p) => p.preset_version_id)),
    );
    if (versionIds.length > 0) {
      const { data: vers } = await service
        .from('preset_versions')
        .select('preset_id')
        .in('id', versionIds);
      const presetIds = Array.from(
        new Set((vers ?? []).map((v) => v.preset_id)),
      );
      if (presetIds.length > 0) {
        const { data: presets } = await service
          .from('presets')
          .select('id, name')
          .in('id', presetIds)
          .eq('organization_id', organizationId);
        for (const p of presets ?? []) usedByPresets.push({ id: p.id, name: p.name });
      }
    }

    const detail: CategoryDetail = {
      category: {
        id: cat.id,
        name: cat.name,
        description: cat.description,
        sectorId: cat.sector_id,
        sectorName: sectors.get(cat.sector_id) ?? '—',
        isSystem,
        sourceCategoryId: cat.source_category_id,
      },
      attributes,
      availableAttributes,
      usedByPresets,
    };
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

async function loadOwnedCategory(
  service: ServiceClient,
  organizationId: string,
  categoryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await service
    .from('categories')
    .select('id, owner_organization_id')
    .eq('id', categoryId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'Categoria non trovata' };
  if (data.owner_organization_id === null)
    return { ok: false, error: 'Categoria di sistema non modificabile' };
  if (data.owner_organization_id !== organizationId)
    return { ok: false, error: 'Categoria non accessibile' };
  return { ok: true };
}

export async function addAttributeToCategory(input: {
  categoryId: string;
  attributeId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const chk = await loadOwnedCategory(service, organizationId, input.categoryId);
    if (!chk.ok) return chk;
    const attrChk = await requireAccessibleAttribute(
      service,
      organizationId,
      input.attributeId,
    );
    if (!attrChk.ok) return attrChk;

    const { data: existing } = await service
      .from('category_attributes')
      .select('display_order')
      .eq('category_id', input.categoryId)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (existing?.display_order ?? 0) + 1;

    const { error } = await service.from('category_attributes').insert({
      category_id: input.categoryId,
      attribute_id: input.attributeId,
      is_required: false,
      display_order: nextOrder,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function removeAttributeFromCategory(input: {
  id: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: row } = await service
      .from('category_attributes')
      .select('id, category_id')
      .eq('id', input.id)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Collegamento non trovato' };
    const chk = await loadOwnedCategory(service, organizationId, row.category_id);
    if (!chk.ok) return chk;

    const { error } = await service
      .from('category_attributes')
      .delete()
      .eq('id', input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function setCategoryAttribute(input: {
  id: string;
  isRequired?: boolean;
  displayOrder?: number;
  extractionOverride?: string | null;
  generationOverride?: string | null;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: row } = await service
      .from('category_attributes')
      .select('id, category_id')
      .eq('id', input.id)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Collegamento non trovato' };
    const chk = await loadOwnedCategory(service, organizationId, row.category_id);
    if (!chk.ok) return chk;

    const patch: Record<string, unknown> = {};
    if (input.isRequired !== undefined) patch.is_required = input.isRequired;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    if (input.extractionOverride !== undefined)
      patch.extraction_instruction_override = input.extractionOverride || null;
    if (input.generationOverride !== undefined)
      patch.generation_instruction_override = input.generationOverride || null;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await service
      .from('category_attributes')
      .update(patch)
      .eq('id', input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// =====================================================================
// Attributes
// =====================================================================

export async function listAttributes(input?: {
  sectorId?: string;
  categoryId?: string;
  kind?: string;
}): Promise<Ok<{ attributes: AttributeListItem[] }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    // Se filtrato per categoria, ricava gli attribute_id collegati.
    let restrictToIds: Set<string> | null = null;
    if (input?.categoryId) {
      const { data: links } = await service
        .from('category_attributes')
        .select('attribute_id')
        .eq('category_id', input.categoryId);
      restrictToIds = new Set((links ?? []).map((l) => l.attribute_id));
      if (restrictToIds.size === 0) return { ok: true, attributes: [] };
    }

    let query = service
      .from('attributes')
      .select(
        'id, name, description, sector_id, attribute_kind, data_type, unit, owner_organization_id, status',
      )
      .eq('status', 'active')
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
    if (input?.sectorId) query = query.eq('sector_id', input.sectorId);
    if (input?.kind) query = query.eq('attribute_kind', input.kind);
    const { data: attrs, error } = await query.order('name', {
      ascending: true,
    });
    if (error) return { ok: false, error: error.message };

    const filtered = (attrs ?? []).filter(
      (a) => !restrictToIds || restrictToIds.has(a.id),
    );

    const sectors = await sectorNameMap(service);

    // Conteggio utilizzo (categorie + preset).
    const ids = filtered.map((a) => a.id);
    const usage = new Map<string, number>();
    if (ids.length > 0) {
      const [catLinks, presetLinks] = await Promise.all([
        service
          .from('category_attributes')
          .select('attribute_id')
          .in('attribute_id', ids),
        service
          .from('preset_attributes')
          .select('attribute_id')
          .in('attribute_id', ids),
      ]);
      for (const l of catLinks.data ?? [])
        usage.set(l.attribute_id, (usage.get(l.attribute_id) ?? 0) + 1);
      for (const l of presetLinks.data ?? [])
        usage.set(l.attribute_id, (usage.get(l.attribute_id) ?? 0) + 1);
    }

    const attributes: AttributeListItem[] = filtered.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      sectorId: a.sector_id,
      sectorName: sectors.get(a.sector_id) ?? '—',
      attributeKind: a.attribute_kind,
      dataType: a.data_type,
      unit: a.unit,
      isSystem: a.owner_organization_id === null,
      usageCount: usage.get(a.id) ?? 0,
    }));

    return { ok: true, attributes };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createAttribute(input: {
  sectorId: string;
  name: string;
  description?: string;
  attributeKind: string;
  dataType: string;
  unit?: string;
  enumValues?: string[];
  extractionInstruction?: string;
  generationInstruction?: string;
}): Promise<Ok<{ attributeId: string }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const name = input.name?.trim();
    if (!name) return { ok: false, error: 'Il nome è obbligatorio' };
    if (!input.sectorId) return { ok: false, error: 'Settore obbligatorio' };

    const enumJson =
      input.enumValues && input.enumValues.length > 0
        ? (input.enumValues as unknown as Json)
        : null;

    const { data, error } = await service
      .from('attributes')
      .insert({
        sector_id: input.sectorId,
        owner_organization_id: organizationId,
        name,
        description: input.description?.trim() || null,
        attribute_kind: input.attributeKind,
        data_type: input.dataType,
        unit: input.unit?.trim() || null,
        enum_values_json: enumJson,
        default_extraction_instruction:
          input.extractionInstruction?.trim() || null,
        default_generation_instruction:
          input.generationInstruction?.trim() || null,
        is_system: false,
        status: 'active',
        version: 1,
      })
      .select('id')
      .single();
    if (error || !data) {
      return { ok: false, error: `Creazione fallita: ${error?.message}` };
    }
    return { ok: true, attributeId: data.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getAttributeDetail(input: {
  attributeId: string;
}): Promise<Ok<{ detail: AttributeDetail }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: a } = await service
      .from('attributes')
      .select('*')
      .eq('id', input.attributeId)
      .maybeSingle();
    if (!a) return { ok: false, error: 'Attributo non trovato' };
    if (
      a.owner_organization_id !== null &&
      a.owner_organization_id !== organizationId
    ) {
      return { ok: false, error: 'Attributo non accessibile' };
    }

    const sectors = await sectorNameMap(service);
    const enumValues = Array.isArray(a.enum_values_json)
      ? (a.enum_values_json as unknown[]).map((v) => String(v))
      : [];

    // Where-used: categorie.
    const { data: catLinks } = await service
      .from('category_attributes')
      .select('category_id')
      .eq('attribute_id', a.id);
    const catIds = Array.from(
      new Set((catLinks ?? []).map((l) => l.category_id)),
    );
    const usedByCategories: { id: string; name: string }[] = [];
    if (catIds.length > 0) {
      const { data: cats } = await service
        .from('categories')
        .select('id, name, owner_organization_id')
        .in('id', catIds)
        .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
      for (const c of cats ?? []) usedByCategories.push({ id: c.id, name: c.name });
    }

    // Where-used: preset.
    const { data: presetLinks } = await service
      .from('preset_attributes')
      .select('preset_version_id')
      .eq('attribute_id', a.id);
    const versionIds = Array.from(
      new Set((presetLinks ?? []).map((l) => l.preset_version_id)),
    );
    const usedByPresets: { id: string; name: string }[] = [];
    if (versionIds.length > 0) {
      const { data: vers } = await service
        .from('preset_versions')
        .select('preset_id')
        .in('id', versionIds);
      const presetIds = Array.from(
        new Set((vers ?? []).map((v) => v.preset_id)),
      );
      if (presetIds.length > 0) {
        const { data: presets } = await service
          .from('presets')
          .select('id, name')
          .in('id', presetIds)
          .eq('organization_id', organizationId);
        for (const p of presets ?? []) usedByPresets.push({ id: p.id, name: p.name });
      }
    }

    const detail: AttributeDetail = {
      attribute: {
        id: a.id,
        name: a.name,
        description: a.description,
        sectorId: a.sector_id,
        sectorName: sectors.get(a.sector_id) ?? '—',
        attributeKind: a.attribute_kind,
        dataType: a.data_type,
        unit: a.unit,
        enumValues,
        extractionInstruction: a.default_extraction_instruction,
        generationInstruction: a.default_generation_instruction,
        validationRules: a.validation_rules_json,
        normalizationRules: a.normalization_rules_json,
        isSystem: a.owner_organization_id === null,
        version: a.version,
        sourceAttributeId: a.source_attribute_id,
      },
      usedByCategories,
      usedByPresets,
    };
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export interface AttributePatch {
  name?: string;
  description?: string | null;
  unit?: string | null;
  enumValues?: string[];
  extractionInstruction?: string | null;
  generationInstruction?: string | null;
  validationRules?: Json;
  normalizationRules?: Json;
}

/**
 * Aggiorna un attributo. Se l'attributo è di SISTEMA (owner null) NON viene
 * mutato: si crea una copia personalizzata dell'org (source_attribute_id =
 * originale) con la patch applicata e si ritorna il nuovo id. Se è già
 * dell'org, aggiorna in place e incrementa `version`.
 */
export async function updateAttribute(input: {
  attributeId: string;
  patch: AttributePatch;
}): Promise<Ok<{ attributeId: string; forked: boolean }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: a } = await service
      .from('attributes')
      .select('*')
      .eq('id', input.attributeId)
      .maybeSingle();
    if (!a) return { ok: false, error: 'Attributo non trovato' };
    if (
      a.owner_organization_id !== null &&
      a.owner_organization_id !== organizationId
    ) {
      return { ok: false, error: 'Attributo non accessibile' };
    }

    const p = input.patch;
    const enumJson =
      p.enumValues !== undefined
        ? p.enumValues.length > 0
          ? (p.enumValues as unknown as Json)
          : null
        : undefined;

    if (a.owner_organization_id === null) {
      // Fork: crea una copia personalizzata.
      const { data: copy, error } = await service
        .from('attributes')
        .insert({
          sector_id: a.sector_id,
          owner_organization_id: organizationId,
          source_attribute_id: a.id,
          key: a.key,
          name: p.name?.trim() || a.name,
          description:
            p.description !== undefined ? p.description : a.description,
          attribute_kind: a.attribute_kind,
          data_type: a.data_type,
          unit: p.unit !== undefined ? p.unit : a.unit,
          enum_values_json: enumJson !== undefined ? enumJson : a.enum_values_json,
          default_extraction_instruction:
            p.extractionInstruction !== undefined
              ? p.extractionInstruction
              : a.default_extraction_instruction,
          default_generation_instruction:
            p.generationInstruction !== undefined
              ? p.generationInstruction
              : a.default_generation_instruction,
          validation_rules_json:
            p.validationRules !== undefined
              ? p.validationRules
              : a.validation_rules_json,
          normalization_rules_json:
            p.normalizationRules !== undefined
              ? p.normalizationRules
              : a.normalization_rules_json,
          allowed_sources_json: a.allowed_sources_json,
          is_system: false,
          status: 'active',
          version: 1,
        })
        .select('id')
        .single();
      if (error || !copy) {
        return { ok: false, error: `Copia fallita: ${error?.message}` };
      }
      return { ok: true, attributeId: copy.id, forked: true };
    }

    // Update in place con bump di versione.
    const patch: Record<string, unknown> = { version: (a.version ?? 1) + 1 };
    if (p.name !== undefined) patch.name = p.name.trim() || a.name;
    if (p.description !== undefined) patch.description = p.description;
    if (p.unit !== undefined) patch.unit = p.unit;
    if (enumJson !== undefined) patch.enum_values_json = enumJson;
    if (p.extractionInstruction !== undefined)
      patch.default_extraction_instruction = p.extractionInstruction;
    if (p.generationInstruction !== undefined)
      patch.default_generation_instruction = p.generationInstruction;
    if (p.validationRules !== undefined)
      patch.validation_rules_json = p.validationRules;
    if (p.normalizationRules !== undefined)
      patch.normalization_rules_json = p.normalizationRules;

    const { error } = await service
      .from('attributes')
      .update(patch)
      .eq('id', a.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, attributeId: a.id, forked: false };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// =====================================================================
// Import in blocco da lista incollata (velocità di setup).
// =====================================================================

/**
 * Crea in blocco categorie a partire da una lista incollata (una per riga).
 * Salta i nomi già esistenti (di sistema o dell'org) per non duplicare.
 */
export async function createCategoriesFromList(input: {
  sectorId: string;
  text: string;
}): Promise<Ok<{ created: number; skipped: number; total: number }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    if (!input.sectorId) return { ok: false, error: 'Settore obbligatorio' };
    const names = parseNameList(input.text);
    if (names.length === 0) return { ok: false, error: 'Nessun nome valido nella lista' };

    const { data: existing } = await service
      .from('categories')
      .select('name')
      .eq('sector_id', input.sectorId)
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
    const existingSet = new Set((existing ?? []).map((c) => c.name.trim().toLowerCase()));
    const toCreate = names.filter((n) => !existingSet.has(n.toLowerCase()));

    if (toCreate.length > 0) {
      const { error } = await service.from('categories').insert(
        toCreate.map((name) => ({
          sector_id: input.sectorId,
          owner_organization_id: organizationId,
          name,
          is_system: false,
          status: 'active',
        })),
      );
      if (error) return { ok: false, error: error.message };
    }
    return {
      ok: true,
      created: toCreate.length,
      skipped: names.length - toCreate.length,
      total: names.length,
    };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/**
 * Crea in blocco attributi FATTUALI (testo) da una lista incollata. Le
 * istruzioni di default ribadiscono il principio "solo dati dichiarati".
 * Salta i nomi già esistenti nel settore.
 */
export async function createAttributesFromList(input: {
  sectorId: string;
  text: string;
}): Promise<Ok<{ created: number; skipped: number; total: number }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    if (!input.sectorId) return { ok: false, error: 'Settore obbligatorio' };
    const names = parseNameList(input.text);
    if (names.length === 0) return { ok: false, error: 'Nessun nome valido nella lista' };

    const { data: existing } = await service
      .from('attributes')
      .select('name')
      .eq('sector_id', input.sectorId)
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
    const existingSet = new Set((existing ?? []).map((a) => a.name.trim().toLowerCase()));
    const toCreate = names.filter((n) => !existingSet.has(n.toLowerCase()));

    if (toCreate.length > 0) {
      const { error } = await service.from('attributes').insert(
        toCreate.map((name) => ({
          sector_id: input.sectorId,
          owner_organization_id: organizationId,
          name,
          attribute_kind: 'factual',
          data_type: 'text',
          default_extraction_instruction: `Estrai il valore di "${name}" dalle fonti: solo il dato dichiarato, non stimare.`,
          default_generation_instruction: `Usa "${name}" nel testo solo se presente tra i fatti verificati.`,
          is_system: false,
          status: 'active',
          version: 1,
        })),
      );
      if (error) return { ok: false, error: error.message };
    }
    return {
      ok: true,
      created: toCreate.length,
      skipped: names.length - toCreate.length,
      total: names.length,
    };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/**
 * Svuota una BOZZA di preset: rimuove tutte le categorie e gli attributi
 * collegati (i campi di output generati restano). Solo su versioni non
 * pubblicate.
 */
export async function clearPresetVersion(input: {
  presetVersionId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const chk = await requireDraftVersion(service, organizationId, input.presetVersionId);
    if (!chk.ok) return chk;

    await service.from('preset_attributes').delete().eq('preset_version_id', input.presetVersionId);
    await service.from('preset_categories').delete().eq('preset_version_id', input.presetVersionId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/**
 * Popola un preset (bozza) da una lista di attributi incollata: crea gli
 * attributi mancanti nel settore del preset e li collega tutti alla versione.
 * Serve al caso "ho già le mie voci, creo il preset incollandole".
 */
export async function addAttributesFromListToPreset(input: {
  presetVersionId: string;
  text: string;
}): Promise<Ok<{ added: number; created: number; total: number }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;
    const chk = await requireDraftVersion(service, organizationId, input.presetVersionId);
    if (!chk.ok) return chk;

    const names = parseNameList(input.text);
    if (names.length === 0) return { ok: false, error: 'Nessun nome valido nella lista' };

    // Settore del preset (per creare/cercare gli attributi giusti).
    const { data: preset } = await service
      .from('presets')
      .select('sector_id')
      .eq('id', chk.presetId)
      .maybeSingle();
    const sectorId = preset?.sector_id;
    if (!sectorId) return { ok: false, error: 'Settore del preset non trovato' };

    // Attributi esistenti (sistema o org) del settore, per nome normalizzato.
    const { data: existing } = await service
      .from('attributes')
      .select('id, name')
      .eq('sector_id', sectorId)
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
    const idByName = new Map(
      (existing ?? []).map((a) => [a.name.trim().toLowerCase(), a.id] as const),
    );

    // Crea gli attributi mancanti.
    const missing = names.filter((n) => !idByName.has(n.toLowerCase()));
    let created = 0;
    if (missing.length > 0) {
      const { data: inserted, error } = await service
        .from('attributes')
        .insert(
          missing.map((name) => ({
            sector_id: sectorId,
            owner_organization_id: organizationId,
            name,
            attribute_kind: 'factual',
            data_type: 'text',
            default_extraction_instruction: `Estrai il valore di "${name}" dalle fonti: solo il dato dichiarato, non stimare.`,
            default_generation_instruction: `Usa "${name}" nel testo solo se presente tra i fatti verificati.`,
            is_system: false,
            status: 'active',
            version: 1,
          })),
        )
        .select('id, name');
      if (error) return { ok: false, error: error.message };
      for (const a of inserted ?? []) idByName.set(a.name.trim().toLowerCase(), a.id);
      created = (inserted ?? []).length;
    }

    // Attributi già collegati alla versione (per non duplicare).
    const { data: presentRows } = await service
      .from('preset_attributes')
      .select('attribute_id, display_order')
      .eq('preset_version_id', input.presetVersionId);
    const present = new Set((presentRows ?? []).map((p) => p.attribute_id));
    let nextOrder = (presentRows ?? []).reduce((m, p) => Math.max(m, p.display_order ?? 0), 0);

    const toLink = names
      .map((n) => idByName.get(n.toLowerCase()))
      .filter((id): id is string => Boolean(id) && !present.has(id as string));
    // Dedup fra loro mantenendo l'ordine.
    const uniqueToLink = [...new Set(toLink)];

    if (uniqueToLink.length > 0) {
      const { error } = await service.from('preset_attributes').insert(
        uniqueToLink.map((attribute_id) => ({
          preset_version_id: input.presetVersionId,
          attribute_id,
          category_id: null,
          is_required: false,
          display_order: ++nextOrder,
          enabled: true,
        })),
      );
      if (error) return { ok: false, error: error.message };
    }

    return { ok: true, added: uniqueToLink.length, created, total: names.length };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
