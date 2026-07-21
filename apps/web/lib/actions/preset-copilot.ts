'use server';

import { createAiProviders } from '@app/ai';
import type { PresetPlanOutput, PlannedCategory, PlannedAttribute } from '@app/core';
import type { Json } from '@app/database';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getServerEnv } from '@/lib/env.server';
import { checkAiRateLimit } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// "Costruttore di preset" via Copilot: una chiamata AI progetta l'intero preset
// (categorie + attributi + tipi), l'utente conferma, la creazione è deterministica.
// ---------------------------------------------------------------------------

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

const ALLOWED_DATA_TYPES = new Set([
  'text',
  'long_text',
  'boolean',
  'integer',
  'decimal',
  'date',
  'enum',
  'multi_enum',
  'measurement',
  'percentage',
  'currency',
]);
function normDataType(dt: string | null | undefined): string {
  return dt && ALLOWED_DATA_TYPES.has(dt) ? dt : 'text';
}
function norm(s: string): string {
  return s.trim().toLowerCase();
}

interface PresetCtx {
  orgId: string;
  presetId: string;
  presetName: string;
  sectorId: string | null;
  sectorName: string;
}

async function assertPresetAccess(presetId: string): Promise<PresetCtx | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const service = getServiceClient();
  const { data: preset } = await service
    .from('presets')
    .select('id, name, organization_id, sector_id')
    .eq('id', presetId)
    .maybeSingle();
  if (!preset) return null;
  const { data: member } = await service
    .from('organization_members')
    .select('id')
    .eq('organization_id', preset.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return null;
  let sectorName = '';
  if (preset.sector_id) {
    const { data: s } = await service
      .from('sectors')
      .select('name')
      .eq('id', preset.sector_id)
      .maybeSingle();
    sectorName = s?.name ?? '';
  }
  return {
    orgId: preset.organization_id,
    presetId: preset.id,
    presetName: preset.name,
    sectorId: preset.sector_id,
    sectorName,
  };
}

export interface PlannedAttributeView extends PlannedAttribute {
  /** true se l'attributo è già collegato a questa categoria nella versione di lavoro. */
  existing: boolean;
}
export interface PlannedCategoryView {
  name: string;
  description: string | null;
  /** true se la categoria è già collegata al preset (versione di lavoro). */
  existing: boolean;
  attributes: PlannedAttributeView[];
}

export interface PresetPlanResult {
  assistantMessage: string;
  summary: string;
  categories: PlannedCategoryView[];
  /** Quante categorie del piano non sono ancora nel preset. */
  newCategories: number;
  /** Quanti attributi del piano non sono ancora collegati. */
  newAttributes: number;
}

/** Trova la versione di lavoro (bozza, altrimenti pubblicata, altrimenti l'ultima). */
async function findWorkingVersionId(
  service: ReturnType<typeof getServiceClient>,
  presetId: string,
): Promise<string | null> {
  const { data: versions } = await service
    .from('preset_versions')
    .select('id, version, published_at')
    .eq('preset_id', presetId)
    .order('version', { ascending: false });
  if (!versions || versions.length === 0) return null;
  const draft = versions.find((v) => v.published_at === null);
  const published = versions.find((v) => v.published_at !== null);
  const working = draft ?? published ?? versions[0];
  return working?.id ?? null;
}

/** Progetta un preset (una chiamata AI). NON scrive nulla. */
export async function planPresetAction(input: {
  presetId: string;
  request: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  /** Piano già proposto: passato quando l'utente chiede una modifica. */
  currentPlan?: PlannedCategory[] | null;
}): Promise<ActionResult<PresetPlanResult>> {
  const ctx = await assertPresetAccess(input.presetId);
  if (!ctx) return fail('Preset non accessibile');
  if (!ctx.sectorId) return fail('Il preset non ha un settore');
  const request = input.request?.trim();
  if (!request) return fail('Scrivi cosa vuoi creare');
  if (request.length > 12000) return fail('Richiesta troppo lunga: accorciala un po’.');

  const rl = await checkAiRateLimit(ctx.orgId, 'preset_plan');
  if (!rl.allowed) return fail(rl.message);

  const service = getServiceClient();
  const [{ data: cats }, { data: attrs }] = await Promise.all([
    service
      .from('categories')
      .select('id, name')
      .eq('sector_id', ctx.sectorId)
      .eq('status', 'active')
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${ctx.orgId}`),
    service
      .from('attributes')
      .select('id, name')
      .eq('sector_id', ctx.sectorId)
      .eq('status', 'active')
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${ctx.orgId}`),
  ]);

  // Stato attuale del preset (versione di lavoro): serve a marcare ciò che è GIÀ
  // presente, così l'anteprima non chiede di ri-accettare modifiche già create.
  const catIdByName = new Map((cats ?? []).map((c) => [norm(c.name), c.id] as const));
  const attrIdByName = new Map((attrs ?? []).map((a) => [norm(a.name), a.id] as const));
  const workingVersionId = await findWorkingVersionId(service, ctx.presetId);
  const linkedCats = new Set<string>();
  const linkedAttrKeys = new Set<string>();
  if (workingVersionId) {
    const [{ data: pc }, { data: pa }] = await Promise.all([
      service.from('preset_categories').select('category_id').eq('preset_version_id', workingVersionId),
      service.from('preset_attributes').select('attribute_id, category_id').eq('preset_version_id', workingVersionId),
    ]);
    for (const r of pc ?? []) linkedCats.add(r.category_id);
    for (const r of pa ?? []) linkedAttrKeys.add(`${r.attribute_id}|${r.category_id ?? ''}`);
  }

  let out: PresetPlanOutput;
  try {
    const providers = createAiProviders(getServerEnv());
    const res = await providers.presetPlan.planPreset({
      sectorName: ctx.sectorName,
      presetName: ctx.presetName,
      userRequest: request.slice(0, 12000),
      existingCategories: (cats ?? []).map((c) => c.name),
      existingAttributes: (attrs ?? []).map((a) => a.name),
      history: (input.history ?? []).slice(-8),
      currentPlan: input.currentPlan ?? null,
    });
    out = res.data;
  } catch (err) {
    return fail(`Pianificazione non riuscita: ${err instanceof Error ? err.message : 'errore AI'}`);
  }

  // Sanifica + annota (già presente vs nuovo).
  let newCategories = 0;
  let newAttributes = 0;
  const categories: PlannedCategoryView[] = out.categories.slice(0, 20).map((c) => {
    const name = c.name.trim().slice(0, 120);
    const catId = catIdByName.get(norm(name));
    const catExisting = !!catId && linkedCats.has(catId);
    if (!catExisting) newCategories++;
    const attributes: PlannedAttributeView[] = c.attributes.slice(0, 20).map((a) => {
      const aName = a.name.trim().slice(0, 120);
      const attrId = attrIdByName.get(norm(aName));
      const attrExisting = !!attrId && !!catId && linkedAttrKeys.has(`${attrId}|${catId}`);
      if (!attrExisting) newAttributes++;
      return {
        name: aName,
        dataType: normDataType(a.dataType),
        enumValues: Array.isArray(a.enumValues)
          ? a.enumValues.map((v) => String(v).trim()).filter(Boolean).slice(0, 30)
          : null,
        unit: a.unit?.trim().slice(0, 40) ?? null,
        extractionInstruction: a.extractionInstruction?.trim().slice(0, 500) ?? null,
        generationInstruction: a.generationInstruction?.trim().slice(0, 500) ?? null,
        existing: attrExisting,
      };
    });
    return {
      name,
      description: c.description?.trim().slice(0, 500) ?? null,
      existing: catExisting,
      attributes,
    };
  });

  return ok({
    assistantMessage: out.assistantMessage,
    summary: out.summary,
    categories,
    newCategories,
    newAttributes,
  });
}

export interface ApplyPlanResult {
  categoriesAdded: number;
  categoriesCreated: number;
  attributesAdded: number;
  attributesCreated: number;
}

/** Crea deterministicamente il piano: categorie + attributi collegati al preset. */
export async function applyPresetPlanAction(input: {
  presetId: string;
  categories: PlannedCategory[];
}): Promise<ActionResult<ApplyPlanResult>> {
  const ctx = await assertPresetAccess(input.presetId);
  if (!ctx) return fail('Preset non accessibile');
  if (!ctx.sectorId) return fail('Il preset non ha un settore');
  const sectorId = ctx.sectorId;
  const service = getServiceClient();

  const { ensureDraftVersion } = await import('./catalog');
  const draftRes = await ensureDraftVersion({ presetId: input.presetId });
  if (!draftRes.ok) return fail(draftRes.error);
  const versionId = draftRes.versionId;

  // Mappe esistenti (per riuso / no-duplicati).
  const [{ data: existingCats }, { data: existingAttrs }] = await Promise.all([
    service
      .from('categories')
      .select('id, name')
      .eq('sector_id', sectorId)
      .eq('status', 'active')
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${ctx.orgId}`),
    service
      .from('attributes')
      .select('id, name')
      .eq('sector_id', sectorId)
      .eq('status', 'active')
      .or(`owner_organization_id.is.null,owner_organization_id.eq.${ctx.orgId}`),
  ]);
  const catIdByName = new Map((existingCats ?? []).map((c) => [norm(c.name), c.id] as const));
  const attrIdByName = new Map((existingAttrs ?? []).map((a) => [norm(a.name), a.id] as const));

  // Stato preset (per non duplicare i collegamenti).
  const [{ data: presetCats }, { data: presetAttrs }] = await Promise.all([
    service.from('preset_categories').select('category_id, display_order').eq('preset_version_id', versionId),
    service.from('preset_attributes').select('attribute_id, category_id, display_order').eq('preset_version_id', versionId),
  ]);
  const linkedCats = new Set((presetCats ?? []).map((p) => p.category_id));
  const linkedAttrs = new Set(
    (presetAttrs ?? []).map((p) => `${p.attribute_id}|${p.category_id ?? ''}`),
  );
  let catOrder = (presetCats ?? []).reduce((m, p) => Math.max(m, p.display_order ?? 0), 0);
  let attrOrder = (presetAttrs ?? []).reduce((m, p) => Math.max(m, p.display_order ?? 0), 0);

  const res: ApplyPlanResult = {
    categoriesAdded: 0,
    categoriesCreated: 0,
    attributesAdded: 0,
    attributesCreated: 0,
  };

  for (const cat of input.categories) {
    const catName = cat.name.trim();
    if (!catName) continue;
    // Trova o crea la categoria.
    let categoryId = catIdByName.get(norm(catName));
    if (!categoryId) {
      const { data: created, error } = await service
        .from('categories')
        .insert({
          sector_id: sectorId,
          owner_organization_id: ctx.orgId,
          name: catName,
          description: cat.description ?? null,
          is_system: false,
          status: 'active',
        })
        .select('id')
        .single();
      if (error || !created) continue;
      categoryId = created.id;
      catIdByName.set(norm(catName), categoryId);
      res.categoriesCreated++;
    }
    // Collega la categoria al preset.
    if (!linkedCats.has(categoryId)) {
      const { error } = await service.from('preset_categories').insert({
        preset_version_id: versionId,
        category_id: categoryId,
        display_order: ++catOrder,
        enabled: true,
      });
      if (!error) {
        linkedCats.add(categoryId);
        res.categoriesAdded++;
      }
    }

    // Attributi della categoria.
    for (const attr of cat.attributes) {
      const attrName = attr.name.trim();
      if (!attrName) continue;
      const enumJson =
        (attr.dataType === 'enum' || attr.dataType === 'multi_enum') &&
        attr.enumValues &&
        attr.enumValues.length > 0
          ? (attr.enumValues as unknown as Json)
          : null;
      let attributeId = attrIdByName.get(norm(attrName));
      if (!attributeId) {
        const { data: created, error } = await service
          .from('attributes')
          .insert({
            sector_id: sectorId,
            owner_organization_id: ctx.orgId,
            name: attrName,
            attribute_kind: 'factual',
            data_type: normDataType(attr.dataType),
            unit: attr.unit ?? null,
            enum_values_json: enumJson,
            default_extraction_instruction:
              attr.extractionInstruction?.trim() ||
              `Estrai il valore di "${attrName}" dalle fonti: solo il dato dichiarato, non stimare.`,
            default_generation_instruction:
              attr.generationInstruction?.trim() ||
              `Usa "${attrName}" nel testo solo se presente tra i fatti verificati.`,
            is_system: false,
            status: 'active',
            version: 1,
          })
          .select('id')
          .single();
        if (error || !created) continue;
        attributeId = created.id;
        attrIdByName.set(norm(attrName), attributeId);
        res.attributesCreated++;
      }
      // Collega l'attributo al preset sotto questa categoria.
      const key = `${attributeId}|${categoryId}`;
      if (!linkedAttrs.has(key)) {
        const { error } = await service.from('preset_attributes').insert({
          preset_version_id: versionId,
          attribute_id: attributeId,
          category_id: categoryId,
          is_required: false,
          display_order: ++attrOrder,
          enabled: true,
        });
        if (!error) {
          linkedAttrs.add(key);
          res.attributesAdded++;
        }
      }
    }
  }

  try {
    const user = await getSessionUser();
    await service.from('app_events').insert({
      organization_id: ctx.orgId,
      user_id: user?.id ?? null,
      event_name: 'preset_built_ai',
      metadata_json: res as unknown as Json,
    });
  } catch {
    /* storico best-effort */
  }

  return ok(res);
}
