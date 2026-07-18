'use server';

import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Azioni account (GDPR): export dei dati e cancellazione account+dati.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

/**
 * Esporta i dati dell'utente e della sua organizzazione in un oggetto JSON
 * scaricabile (diritto di accesso/portabilità GDPR).
 */
export async function exportMyData(): Promise<ActionResult<{ json: string; filename: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Nessuna organizzazione associata');
  const service = getServiceClient();
  const orgId = org.organizationId;

  const [orgRow, members, batches, presets, categories, attributes, events, ledger] =
    await Promise.all([
      service.from('organizations').select('*').eq('id', orgId).maybeSingle(),
      service.from('organization_members').select('user_id, role, created_at').eq('organization_id', orgId),
      service
        .from('batches')
        .select('id, name, status, total_products, valid_products, created_at')
        .eq('organization_id', orgId),
      service.from('presets').select('id, name, sector_id, active_version_id, created_at').eq('organization_id', orgId),
      service.from('categories').select('id, name, sector_id').eq('owner_organization_id', orgId),
      service.from('attributes').select('id, name, sector_id, attribute_kind, data_type').eq('owner_organization_id', orgId),
      service
        .from('app_events')
        .select('event_name, metadata_json, created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(500),
      service
        .from('credit_ledger')
        .select('amount, entry_type, reference_type, created_at')
        .eq('organization_id', orgId)
        .limit(500),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { userId: user.id, email: user.email ?? null, role: org.role },
    organization: orgRow.data ?? null,
    members: members.data ?? [],
    batches: batches.data ?? [],
    presets: presets.data ?? [],
    categories: categories.data ?? [],
    attributes: attributes.data ?? [],
    creditLedger: ledger.data ?? [],
    activity: events.data ?? [],
  };

  return ok({
    json: JSON.stringify(payload, null, 2),
    filename: `export-dati-${orgId}.json`,
  });
}

/**
 * Cancella l'account e TUTTI i dati dell'organizzazione (irreversibile).
 * Richiede il ruolo owner e la conferma testuale esatta. La cancellazione
 * dell'organizzazione fa cascade su batch, prodotti, generazioni, config, ecc.
 */
export async function deleteAccount(input: {
  confirmation: string;
}): Promise<ActionResult<{ deleted: true }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  if (input.confirmation.trim().toUpperCase() !== 'ELIMINA') {
    return fail('Digita ELIMINA per confermare la cancellazione.');
  }
  const org = await getUserOrg(user.id);
  if (!org) return fail('Nessuna organizzazione associata');
  if (org.role !== 'owner') {
    return fail('Solo il proprietario può eliminare l’organizzazione e l’account.');
  }
  const service = getServiceClient();

  // Elimina l'organizzazione: FK on delete cascade rimuovono tutti i dati
  // collegati (batch, prodotti, generazioni, preset, categorie, attributi,
  // correzioni, eventi, ledger, membership...).
  const { error: orgErr } = await service
    .from('organizations')
    .delete()
    .eq('id', org.organizationId);
  if (orgErr) return fail(`Cancellazione dati fallita: ${orgErr.message}`);

  // Elimina l'utente di autenticazione (service role → auth.admin).
  try {
    await service.auth.admin.deleteUser(user.id);
  } catch {
    // Se la cancellazione dell'utente auth fallisce, i dati sono comunque già
    // stati rimossi: l'utente resterà senza organizzazione. Non è un blocco.
  }

  // Termina la sessione corrente.
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    /* ignora */
  }

  return ok({ deleted: true });
}
