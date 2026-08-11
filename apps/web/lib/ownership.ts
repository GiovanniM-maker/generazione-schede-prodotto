import { createSupabaseServerClient } from '@/lib/supabase/server';

// Verifica (sotto RLS) che l'utente autenticato possa accedere al batch.
// Ritorna organization_id se autorizzato, altrimenti null.
export async function assertBatchAccess(batchId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('batches')
    .select('id, organization_id')
    .eq('id', batchId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

// ---------------------------------------------------------------------------
// Il ruolo.
//
// `organization_members.role` esisteva da sempre, l'interfaccia mostrava il
// badge «Proprietario / Membro» — e il server lo controllava in due soli file
// su tutto il progetto. Tutto il resto passa dal client di servizio, che
// scavalca le regole di accesso del database senza mai guardare chi sta
// chiedendo: un semplice membro comprava crediti, cancellava batch interi,
// riscriveva i preset.
//
// Una distinzione mostrata e non applicata è peggio di nessuna distinzione:
// promette una protezione che non c'è.
//
// La linea scelta: **il membro fa il lavoro, il proprietario decide i soldi e
// le regole.** Generare, rivedere, esportare, rispondere ai dubbi restano di
// tutti; comprare crediti, cancellare il lavoro altrui e riscrivere il
// vocabolario condiviso no.
// ---------------------------------------------------------------------------

import { getSessionUser, getUserOrg } from '@/lib/auth';

export interface EsitoRuolo {
  organizationId: string;
  role: 'owner' | 'member';
}

/** Chi sta chiedendo e con che ruolo. Null se non autenticato o senza org. */
export async function chiSta(): Promise<EsitoRuolo | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const org = await getUserOrg(user.id);
  return org ? { organizationId: org.organizationId, role: org.role } : null;
}

/**
 * Come `chiSta`, ma solo per il proprietario.
 *
 * Ritorna l'organizzazione, oppure un messaggio che dice **chi** può fare
 * quella cosa: «non autorizzato» lascia l'utente a chiedersi se è un guasto.
 */
export async function soloProprietario(
  cosa: string,
): Promise<{ ok: true; organizationId: string } | { ok: false; error: string }> {
  const chi = await chiSta();
  if (!chi) return { ok: false, error: 'Non autenticato' };
  if (chi.role !== 'owner') {
    return { ok: false, error: `Solo il proprietario dell'organizzazione può ${cosa}.` };
  }
  return { ok: true, organizationId: chi.organizationId };
}
