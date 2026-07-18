'use server';

import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { getServerEnv } from '@/lib/env.server';

// Gestione team: membri, ruoli, inviti. Solo il proprietario può invitare o
// rimuovere. Gli inviti generano un link con token da condividere; l'invitato
// accede (magic link) e accetta.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

export interface TeamMember {
  userId: string;
  email: string;
  role: string;
  isYou: boolean;
  createdAt: string;
}
export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  link: string;
}

function inviteLink(token: string): string {
  const base = getServerEnv().NEXT_PUBLIC_APP_URL ?? '';
  return `${base}/invite/${token}`;
}

export async function getTeam(): Promise<
  ActionResult<{ members: TeamMember[]; invites: TeamInvite[]; isOwner: boolean }>
> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Nessuna organizzazione');
  const service = getServiceClient();
  const orgId = org.organizationId;

  const { data: memberRows } = await service
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });

  const members: TeamMember[] = [];
  for (const m of memberRows ?? []) {
    let email = '—';
    try {
      const { data } = await service.auth.admin.getUserById(m.user_id);
      email = data.user?.email ?? '—';
    } catch {
      /* email non disponibile */
    }
    members.push({
      userId: m.user_id,
      email,
      role: m.role,
      isYou: m.user_id === user.id,
      createdAt: m.created_at,
    });
  }

  const { data: inviteRows } = await service
    .from('organization_invitations')
    .select('id, email, role, status, token, created_at')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const invites: TeamInvite[] = (inviteRows ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    status: i.status,
    createdAt: i.created_at,
    link: inviteLink(i.token),
  }));

  return ok({ members, invites, isOwner: org.role === 'owner' });
}

export async function inviteMember(input: {
  email: string;
  role: 'member' | 'owner';
}): Promise<ActionResult<{ link: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Nessuna organizzazione');
  if (org.role !== 'owner') return fail('Solo il proprietario può invitare membri.');

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) return fail('Inserisci un indirizzo email valido.');
  const role = input.role === 'owner' ? 'owner' : 'member';
  const service = getServiceClient();

  // Evita inviti doppi ancora pendenti per la stessa email.
  const { data: existing } = await service
    .from('organization_invitations')
    .select('id, token')
    .eq('organization_id', org.organizationId)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) return ok({ link: inviteLink(existing.token) });

  const { data, error } = await service
    .from('organization_invitations')
    .insert({
      organization_id: org.organizationId,
      email,
      role,
      invited_by: user.id,
      status: 'pending',
    })
    .select('token')
    .single();
  if (error || !data) return fail(`Creazione invito fallita: ${error?.message}`);
  return ok({ link: inviteLink(data.token) });
}

export async function revokeInvite(input: { id: string }): Promise<ActionResult<{ ok: true }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Nessuna organizzazione');
  if (org.role !== 'owner') return fail('Solo il proprietario può revocare gli inviti.');
  const service = getServiceClient();
  const { error } = await service
    .from('organization_invitations')
    .update({ status: 'revoked' })
    .eq('id', input.id)
    .eq('organization_id', org.organizationId);
  if (error) return fail(error.message);
  return ok({ ok: true });
}

export async function removeMember(input: { userId: string }): Promise<ActionResult<{ ok: true }>> {
  const user = await getSessionUser();
  if (!user) return fail('Non autenticato');
  const org = await getUserOrg(user.id);
  if (!org) return fail('Nessuna organizzazione');
  if (org.role !== 'owner') return fail('Solo il proprietario può rimuovere membri.');
  if (input.userId === user.id) return fail('Non puoi rimuovere te stesso.');
  const service = getServiceClient();
  const { error } = await service
    .from('organization_members')
    .delete()
    .eq('organization_id', org.organizationId)
    .eq('user_id', input.userId);
  if (error) return fail(error.message);
  return ok({ ok: true });
}

/**
 * Accetta un invito: l'utente loggato entra a far parte dell'organizzazione se
 * l'email dell'invito corrisponde. Idempotente se già membro.
 */
export async function acceptInvitation(input: {
  token: string;
}): Promise<ActionResult<{ organizationId: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Devi accedere per accettare l’invito.');
  const service = getServiceClient();

  const { data: invite } = await service
    .from('organization_invitations')
    .select('id, organization_id, email, role, status')
    .eq('token', input.token)
    .maybeSingle();
  if (!invite) return fail('Invito non trovato.');
  if (invite.status !== 'pending') return fail('Invito non più valido.');
  const userEmail = (user.email ?? '').trim().toLowerCase();
  if (userEmail !== invite.email.trim().toLowerCase()) {
    return fail('Questo invito è destinato a un altro indirizzo email.');
  }

  // Crea la membership se non esiste già.
  const { data: existing } = await service
    .from('organization_members')
    .select('id')
    .eq('organization_id', invite.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!existing) {
    const { error } = await service.from('organization_members').insert({
      organization_id: invite.organization_id,
      user_id: user.id,
      role: invite.role === 'owner' ? 'owner' : 'member',
    });
    if (error) return fail(`Adesione fallita: ${error.message}`);
  }

  await service
    .from('organization_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return ok({ organizationId: invite.organization_id });
}
