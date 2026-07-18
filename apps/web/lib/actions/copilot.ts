'use server';

import { createAiProviders } from '@app/ai';
import type {
  CopilotDraftPatch,
  CopilotEntityType,
  CopilotHistoryMessage,
  CopilotOutput,
} from '@app/core';
import type { Json } from '@app/database';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { checkAiRateLimit } from '@/lib/rate-limit';

// =====================================================================
// Server actions per il "Copilot di Configurazione".
//
// Il copilot NON scrive mai nel catalogo: ogni turno aggiorna solo una
// BOZZA (configuration_drafts). Solo confirmDraft PUBBLICA la riga reale
// (attributes / categories) dopo la conferma esplicita dell'utente.
//
// Come per catalog.ts, ogni action:
//  * verifica sessione + appartenenza all'organizzazione
//  * usa il service client per le SCRITTURE
//  * non lancia mai eccezioni oltre il confine server: ritorna sempre
//    un'unione discriminata { ok:true, ... } | { ok:false, error }.
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

// =====================================================================
// Forma della bozza (draft_data_json)
// =====================================================================

/**
 * Contenuto di draft_data_json. Oltre ai campi della bozza teniamo alcuni
 * metadati (`sectorId`) necessari alla pubblicazione. `sectorId` non fa parte
 * del draftPatch e non viene mai sovrascritto dal modello.
 */
export interface CopilotDraftData {
  sectorId: string | null;
  name: string | null;
  description: string | null;
  attributeKind: string | null;
  dataType: string | null;
  unit: string | null;
  enumValues: string[] | null;
  extractionInstruction: string | null;
  generationInstruction: string | null;
  categoryKeys: string[] | null;
  isRequired: boolean | null;
}

export interface CopilotDraftView {
  id: string;
  entityType: CopilotEntityType;
  status: string;
  entityId: string | null;
  data: CopilotDraftData;
}

export interface CopilotMessageView {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

function emptyDraftData(sectorId: string | null): CopilotDraftData {
  return {
    sectorId,
    name: null,
    description: null,
    attributeKind: null,
    dataType: null,
    unit: null,
    enumValues: null,
    extractionInstruction: null,
    generationInstruction: null,
    categoryKeys: null,
    isRequired: null,
  };
}

/** Normalizza il JSON grezzo del DB in CopilotDraftData completo. */
function parseDraftData(raw: Json | null | undefined): CopilotDraftData {
  const base = emptyDraftData(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const strArr = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.map((x) => String(x)) : null;
  return {
    sectorId: str(obj.sectorId),
    name: str(obj.name),
    description: str(obj.description),
    attributeKind: str(obj.attributeKind),
    dataType: str(obj.dataType),
    unit: str(obj.unit),
    enumValues: strArr(obj.enumValues),
    extractionInstruction: str(obj.extractionInstruction),
    generationInstruction: str(obj.generationInstruction),
    categoryKeys: strArr(obj.categoryKeys),
    isRequired: typeof obj.isRequired === 'boolean' ? obj.isRequired : null,
  };
}

/**
 * Applica un draftPatch alla bozza: SOLO i campi non-null vengono sovrascritti.
 * `sectorId` (metadato) non viene mai toccato dal patch del modello.
 */
function mergeDraft(current: CopilotDraftData, patch: CopilotDraftPatch): CopilotDraftData {
  const next: CopilotDraftData = { ...current };
  if (patch.name !== null) next.name = patch.name;
  if (patch.description !== null) next.description = patch.description;
  if (patch.attributeKind !== null) next.attributeKind = patch.attributeKind;
  if (patch.dataType !== null) next.dataType = patch.dataType;
  if (patch.unit !== null) next.unit = patch.unit;
  if (patch.enumValues !== null) next.enumValues = patch.enumValues;
  if (patch.extractionInstruction !== null)
    next.extractionInstruction = patch.extractionInstruction;
  if (patch.generationInstruction !== null)
    next.generationInstruction = patch.generationInstruction;
  if (patch.categoryKeys !== null) next.categoryKeys = patch.categoryKeys;
  if (patch.isRequired !== null) next.isRequired = patch.isRequired;
  return next;
}

function toEntityType(value: string): CopilotEntityType {
  return value === 'category' ? 'category' : 'attribute';
}

async function sectorName(service: ServiceClient, sectorId: string | null): Promise<string> {
  if (!sectorId) return '';
  const { data } = await service
    .from('sectors')
    .select('name')
    .eq('id', sectorId)
    .maybeSingle();
  return data?.name ?? '';
}

// =====================================================================
// Avvio conversazione
// =====================================================================

export async function startCopilotConversation(input: {
  entityType: CopilotEntityType;
  sectorId?: string;
  /** Se presente, si MODIFICA l'entità esistente invece di crearne una nuova. */
  entityId?: string;
}): Promise<Ok<{ conversationId: string; draftId: string }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId, userId } = auth;

    const entityType: CopilotEntityType =
      input.entityType === 'category' ? 'category' : 'attribute';

    // Risolvi un settore: quello richiesto, altrimenti il primo attivo.
    let sectorId = input.sectorId ?? null;
    if (!sectorId) {
      const { data: sector } = await service
        .from('sectors')
        .select('id')
        .eq('status', 'active')
        .order('name', { ascending: true })
        .limit(1)
        .maybeSingle();
      sectorId = sector?.id ?? null;
    }

    // Modalità MODIFICA: precarica lo stato dell'entità esistente nella bozza.
    // Solo entità dell'org sono modificabili (quelle di sistema vanno duplicate).
    let draftData = emptyDraftData(sectorId);
    let editEntityId: string | null = null;
    if (input.entityId) {
      if (entityType === 'category') {
        const { data: cat } = await service
          .from('categories')
          .select('id, name, description, sector_id, owner_organization_id')
          .eq('id', input.entityId)
          .maybeSingle();
        if (!cat) return { ok: false, error: 'Categoria non trovata' };
        if (cat.owner_organization_id !== organizationId) {
          return { ok: false, error: 'Solo le categorie personalizzate sono modificabili (duplica quelle di sistema).' };
        }
        draftData = { ...draftData, sectorId: cat.sector_id, name: cat.name, description: cat.description };
        editEntityId = cat.id;
      } else {
        const { data: attr } = await service
          .from('attributes')
          .select('id, name, description, sector_id, attribute_kind, data_type, unit, enum_values_json, default_extraction_instruction, default_generation_instruction, owner_organization_id')
          .eq('id', input.entityId)
          .maybeSingle();
        if (!attr) return { ok: false, error: 'Attributo non trovato' };
        if (attr.owner_organization_id !== organizationId) {
          return { ok: false, error: 'Solo gli attributi personalizzati sono modificabili (duplica quelli di sistema).' };
        }
        const enumValues = Array.isArray(attr.enum_values_json)
          ? (attr.enum_values_json as unknown[]).filter((v): v is string => typeof v === 'string')
          : null;
        draftData = {
          ...draftData,
          sectorId: attr.sector_id,
          name: attr.name,
          description: attr.description,
          attributeKind: attr.attribute_kind,
          dataType: attr.data_type,
          unit: attr.unit,
          enumValues,
          extractionInstruction: attr.default_extraction_instruction,
          generationInstruction: attr.default_generation_instruction,
        };
        editEntityId = attr.id;
      }
    }

    const { data: draft, error: dErr } = await service
      .from('configuration_drafts')
      .insert({
        organization_id: organizationId,
        entity_type: entityType,
        entity_id: editEntityId,
        draft_data_json: draftData as unknown as Json,
        status: editEntityId ? 'awaiting_information' : 'draft',
        created_by: userId,
      })
      .select('id')
      .single();
    if (dErr || !draft) {
      return { ok: false, error: `Creazione bozza fallita: ${dErr?.message}` };
    }

    const { data: conversation, error: cErr } = await service
      .from('configuration_conversations')
      .insert({
        organization_id: organizationId,
        entity_type: entityType,
        entity_draft_id: draft.id,
        status: 'active',
      })
      .select('id')
      .single();
    if (cErr || !conversation) {
      return { ok: false, error: `Creazione conversazione fallita: ${cErr?.message}` };
    }

    return { ok: true, conversationId: conversation.id, draftId: draft.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// =====================================================================
// Invio messaggio (turno del copilot)
// =====================================================================

/**
 * Tool server-side `suggest_similar`: cerca attributi/categorie dell'org e di
 * sistema del settore con nome simile (ILIKE) al testo dell'utente, per
 * segnalare eventuali duplicati. Il modello NON esegue query: riceve solo il
 * risultato.
 */
async function suggestSimilar(
  service: ServiceClient,
  organizationId: string,
  entityType: CopilotEntityType,
  sectorId: string | null,
  message: string,
): Promise<{ id: string; name: string }[]> {
  const terms = message
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .slice(0, 6);
  if (terms.length === 0) return [];

  const table = entityType === 'category' ? 'categories' : 'attributes';
  let query = service
    .from(table)
    .select('id, name')
    .eq('status', 'active')
    .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
  if (sectorId) query = query.eq('sector_id', sectorId);
  // Match fuzzy: il nome contiene almeno uno dei termini.
  query = query.or(terms.map((t) => `name.ilike.%${t}%`).join(','));

  const { data } = await query.limit(8);
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
}

export async function sendCopilotMessage(input: {
  conversationId: string;
  message: string;
}): Promise<Ok<{ output: CopilotOutput; draft: CopilotDraftView }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const message = input.message?.trim();
    if (!message) return { ok: false, error: 'Il messaggio è vuoto' };
    // Limite anti-abuso (prompt gigante = costo/latenza). 4000 caratteri ~ 1k token.
    if (message.length > 4000) {
      return { ok: false, error: 'Messaggio troppo lungo (massimo 4000 caratteri).' };
    }

    // Carica conversazione + bozza + cronologia, verificando l'appartenenza.
    const { data: conversation } = await service
      .from('configuration_conversations')
      .select('id, organization_id, entity_type, entity_draft_id, status')
      .eq('id', input.conversationId)
      .maybeSingle();
    if (!conversation || conversation.organization_id !== organizationId) {
      return { ok: false, error: 'Conversazione non trovata' };
    }
    if (!conversation.entity_draft_id) {
      return { ok: false, error: 'Conversazione senza bozza associata' };
    }

    const { data: draftRow } = await service
      .from('configuration_drafts')
      .select('id, organization_id, entity_type, entity_id, draft_data_json, status')
      .eq('id', conversation.entity_draft_id)
      .maybeSingle();
    if (!draftRow || draftRow.organization_id !== organizationId) {
      return { ok: false, error: 'Bozza non trovata' };
    }

    const entityType = toEntityType(draftRow.entity_type);
    const currentDraft = parseDraftData(draftRow.draft_data_json);

    const { data: historyRows } = await service
      .from('configuration_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });
    const history: CopilotHistoryMessage[] = (historyRows ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    // Rate limit per org sulle chiamate AI del copilot.
    const rl = await checkAiRateLimit(organizationId, 'copilot');
    if (!rl.allowed) return { ok: false, error: rl.message };

    const existingSimilar = await suggestSimilar(
      service,
      organizationId,
      entityType,
      currentDraft.sectorId,
      message,
    );

    // Chiamata al provider AI (mock/openrouter/openai a seconda dell'env).
    const env = getServerEnv();
    const providers = createAiProviders(env);
    const { data: output } = await providers.copilot.suggestConfiguration({
      userMessage: message,
      entityType,
      history,
      currentDraft: currentDraft as unknown as Record<string, unknown>,
      existingSimilar,
      sectorName: await sectorName(service, currentDraft.sectorId),
    });

    // Merge del patch (solo campi non-null) e nuovo stato della bozza.
    const merged = mergeDraft(currentDraft, output.draftPatch);
    const readyToConfirm =
      output.requiresConfirmation && output.missingInformation.length === 0;
    const nextStatus = readyToConfirm ? 'ready_for_confirmation' : 'awaiting_information';

    const { error: upErr } = await service
      .from('configuration_drafts')
      .update({
        draft_data_json: merged as unknown as Json,
        status: nextStatus,
      })
      .eq('id', draftRow.id);
    if (upErr) return { ok: false, error: upErr.message };

    // Salva il turno utente + il turno assistente.
    await service.from('configuration_messages').insert([
      { conversation_id: conversation.id, role: 'user', content: message },
      {
        conversation_id: conversation.id,
        role: 'assistant',
        content: output.assistantMessage,
        tool_calls_json: {
          intent: output.intent,
          missingInformation: output.missingInformation,
          suggestedActions: output.suggestedActions,
          draftPatch: output.draftPatch,
          requiresConfirmation: output.requiresConfirmation,
          confirmationSummary: output.confirmationSummary,
          existingSimilar,
        } as unknown as Json,
      },
    ]);

    const draft: CopilotDraftView = {
      id: draftRow.id,
      entityType,
      status: nextStatus,
      entityId: draftRow.entity_id,
      data: merged,
    };
    return { ok: true, output, draft };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

// =====================================================================
// Conferma → pubblicazione (unica scrittura reale nel catalogo)
// =====================================================================

/** Risolve categoryKeys (key o nome) in id di categorie accessibili. */
async function resolveCategoryIds(
  service: ServiceClient,
  organizationId: string,
  sectorId: string | null,
  keys: string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  let query = service
    .from('categories')
    .select('id, key, name, owner_organization_id')
    .eq('status', 'active')
    .or(`owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`);
  if (sectorId) query = query.eq('sector_id', sectorId);
  const { data } = await query;
  const wanted = new Set(keys.map((k) => k.toLowerCase().trim()));
  return (data ?? [])
    .filter(
      (c) =>
        (c.key && wanted.has(String(c.key).toLowerCase())) ||
        wanted.has(String(c.name).toLowerCase()),
    )
    .map((c) => c.id as string);
}

export async function confirmDraft(input: {
  draftId: string;
}): Promise<Ok<{ entityId: string }> | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: draftRow } = await service
      .from('configuration_drafts')
      .select('id, organization_id, entity_type, entity_id, draft_data_json, status')
      .eq('id', input.draftId)
      .maybeSingle();
    if (!draftRow || draftRow.organization_id !== organizationId) {
      return { ok: false, error: 'Bozza non trovata' };
    }
    if (
      draftRow.status !== 'ready_for_confirmation' &&
      draftRow.status !== 'confirmed'
    ) {
      return {
        ok: false,
        error: 'La bozza non è pronta per la conferma',
      };
    }

    const entityType = toEntityType(draftRow.entity_type);
    const data = parseDraftData(draftRow.draft_data_json);
    const name = data.name?.trim();
    if (!name) return { ok: false, error: 'La bozza non ha un nome' };
    if (!data.sectorId) return { ok: false, error: 'Settore mancante nella bozza' };

    // Claim atomico: transiziona lo stato a 'published' SOLO se è ancora
    // confermabile. Un doppio click concorrente troverà 0 righe aggiornate e
    // uscirà, evitando la creazione di entità duplicate. Manca una transazione
    // DB: in caso di errore nell'inserimento ripristiniamo lo stato originale.
    const { data: claimed } = await service
      .from('configuration_drafts')
      .update({ status: 'published' })
      .eq('id', draftRow.id)
      .in('status', ['ready_for_confirmation', 'confirmed'])
      .select('id');
    if (!claimed || claimed.length === 0) {
      return {
        ok: false,
        error: 'La bozza è già stata confermata o è in fase di conferma',
      };
    }
    const rollbackClaim = async () => {
      await service
        .from('configuration_drafts')
        .update({ status: draftRow.status })
        .eq('id', draftRow.id);
    };

    let entityId: string;
    // Modalità MODIFICA se la bozza ha un entity_id precaricato all'avvio.
    const isEdit = Boolean(draftRow.entity_id);

    if (entityType === 'attribute') {
      const enumJson =
        data.enumValues && data.enumValues.length > 0
          ? (data.enumValues as unknown as Json)
          : null;
      const payload = {
        sector_id: data.sectorId,
        name,
        description: data.description?.trim() || null,
        attribute_kind: data.attributeKind || 'factual',
        data_type: data.dataType || 'text',
        unit: data.unit?.trim() || null,
        enum_values_json: enumJson,
        default_extraction_instruction: data.extractionInstruction?.trim() || null,
        default_generation_instruction: data.generationInstruction?.trim() || null,
      };
      if (isEdit) {
        // Aggiorna solo se l'attributo è dell'org (difesa in profondità).
        const { data: updated, error } = await service
          .from('attributes')
          .update(payload)
          .eq('id', draftRow.entity_id as string)
          .eq('owner_organization_id', organizationId)
          .select('id')
          .maybeSingle();
        if (error || !updated) {
          await rollbackClaim();
          return { ok: false, error: `Modifica attributo fallita: ${error?.message ?? 'non accessibile'}` };
        }
        entityId = updated.id;
      } else {
        const { data: attr, error } = await service
          .from('attributes')
          .insert({ ...payload, owner_organization_id: organizationId, is_system: false, status: 'active', version: 1 })
          .select('id')
          .single();
        if (error || !attr) {
          await rollbackClaim();
          return { ok: false, error: `Creazione attributo fallita: ${error?.message}` };
        }
        entityId = attr.id;

        // Collegamento facoltativo alle categorie indicate (solo in creazione).
        const catIds = data.categoryKeys
          ? await resolveCategoryIds(service, organizationId, data.sectorId, data.categoryKeys)
          : [];
        if (catIds.length > 0) {
          await service.from('category_attributes').insert(
            catIds.map((category_id, i) => ({
              category_id,
              attribute_id: entityId,
              is_required: data.isRequired ?? false,
              display_order: i + 1,
            })),
          );
        }
      }
    } else {
      const payload = {
        sector_id: data.sectorId,
        name,
        description: data.description?.trim() || null,
      };
      if (isEdit) {
        const { data: updated, error } = await service
          .from('categories')
          .update(payload)
          .eq('id', draftRow.entity_id as string)
          .eq('owner_organization_id', organizationId)
          .select('id')
          .maybeSingle();
        if (error || !updated) {
          await rollbackClaim();
          return { ok: false, error: `Modifica categoria fallita: ${error?.message ?? 'non accessibile'}` };
        }
        entityId = updated.id;
      } else {
        const { data: cat, error } = await service
          .from('categories')
          .insert({ ...payload, owner_organization_id: organizationId, is_system: false, status: 'active' })
          .select('id')
          .single();
        if (error || !cat) {
          await rollbackClaim();
          return { ok: false, error: `Creazione categoria fallita: ${error?.message}` };
        }
        entityId = cat.id;
      }
    }

    const now = new Date().toISOString();
    await service
      .from('configuration_drafts')
      .update({
        status: 'published',
        entity_id: entityId,
        confirmed_at: now,
        published_at: now,
      })
      .eq('id', draftRow.id);

    // Chiudi la conversazione collegata, se presente.
    await service
      .from('configuration_conversations')
      .update({ status: 'completed', completed_at: now })
      .eq('entity_draft_id', draftRow.id);

    return { ok: true, entityId };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function discardDraft(input: {
  draftId: string;
}): Promise<OkVoid | Fail> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: draftRow } = await service
      .from('configuration_drafts')
      .select('id, organization_id, status')
      .eq('id', input.draftId)
      .maybeSingle();
    if (!draftRow || draftRow.organization_id !== organizationId) {
      return { ok: false, error: 'Bozza non trovata' };
    }
    const { error } = await service
      .from('configuration_drafts')
      .update({ status: 'discarded' })
      .eq('id', draftRow.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getConversation(input: {
  conversationId: string;
}): Promise<
  Ok<{ messages: CopilotMessageView[]; draft: CopilotDraftView }> | Fail
> {
  try {
    const auth = await requireOrg();
    if (!auth.ok) return auth;
    const { service, organizationId } = auth;

    const { data: conversation } = await service
      .from('configuration_conversations')
      .select('id, organization_id, entity_type, entity_draft_id')
      .eq('id', input.conversationId)
      .maybeSingle();
    if (!conversation || conversation.organization_id !== organizationId) {
      return { ok: false, error: 'Conversazione non trovata' };
    }
    if (!conversation.entity_draft_id) {
      return { ok: false, error: 'Conversazione senza bozza associata' };
    }

    const { data: draftRow } = await service
      .from('configuration_drafts')
      .select('id, entity_type, entity_id, draft_data_json, status')
      .eq('id', conversation.entity_draft_id)
      .maybeSingle();
    if (!draftRow) return { ok: false, error: 'Bozza non trovata' };

    const { data: messageRows } = await service
      .from('configuration_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    const messages: CopilotMessageView[] = (messageRows ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    }));

    const draft: CopilotDraftView = {
      id: draftRow.id,
      entityType: toEntityType(draftRow.entity_type),
      status: draftRow.status,
      entityId: draftRow.entity_id,
      data: parseDraftData(draftRow.draft_data_json),
    };

    return { ok: true, messages, draft };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
