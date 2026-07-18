-- =====================================================================
-- Inviti all'organizzazione (gestione team).
--
-- Un membro invita un'email con un ruolo. L'invitato apre il link con il
-- token, accede (magic link) e l'invito viene accettato: viene creata la
-- membership. L'accettazione avviene lato server con service client.
-- =====================================================================

create table if not exists organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending',
  invited_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (token)
);

create index if not exists org_invitations_org_idx on organization_invitations(organization_id);
create index if not exists org_invitations_email_idx on organization_invitations(lower(email));

alter table organization_invitations enable row level security;

-- I membri dell'org gestiscono i propri inviti.
drop policy if exists org_invitations_select on organization_invitations;
create policy org_invitations_select on organization_invitations
  for select to authenticated
  using (is_organization_member(organization_id));

drop policy if exists org_invitations_insert on organization_invitations;
create policy org_invitations_insert on organization_invitations
  for insert to authenticated
  with check (is_organization_member(organization_id));

drop policy if exists org_invitations_update on organization_invitations;
create policy org_invitations_update on organization_invitations
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

drop policy if exists org_invitations_delete on organization_invitations;
create policy org_invitations_delete on organization_invitations
  for delete to authenticated
  using (is_organization_member(organization_id));
