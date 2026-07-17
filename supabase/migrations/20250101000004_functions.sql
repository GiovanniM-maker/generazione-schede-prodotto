-- Funzioni helper e transazionali.
-- Tutte le funzioni SECURITY DEFINER fissano search_path per evitare hijacking.
--
-- NOTA SICUREZZA: le funzioni di autorizzazione leggono ESCLUSIVAMENTE dalla
-- tabella organization_members. Non usare mai claim del JWT controllabili dal
-- client come fonte di autorizzazione.

-- =====================================================================
-- Trigger di aggiornamento updated_at
-- =====================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Attacca il trigger a tutte le tabelle con updated_at.
do $$
declare
  t text;
  tables text[] := array[
    'organizations', 'brand_profiles', 'batches', 'products',
    'product_variants', 'import_mappings', 'product_generations', 'job_items'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists set_updated_at on %I;', t);
    execute format(
      'create trigger set_updated_at before update on %I
         for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- =====================================================================
-- Helper di autorizzazione (SECURITY DEFINER)
-- =====================================================================

create or replace function is_organization_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
  );
$$;

create or replace function is_organization_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

-- =====================================================================
-- Crediti: modello del ledger
-- =====================================================================
-- Il saldo di un'organizzazione = sum(amount) del credit_ledger.
-- Segno degli importi (amount):
--   purchase / welcome / release / refund  -> positivo (accredito)
--   reservation / consumption               -> negativo (addebito)
--   admin_adjustment                        -> con segno (rettifica manuale)
--
-- Flusso "riserva -> consumo":
--   * reserve_credits inserisce amount = -amt (il saldo cala subito).
--   * consume_reserved_credit (per item riuscito) inserisce
--       'release' +1  (restituisce l'unita' riservata)
--       'consumption' -1 (la consuma) -> variazione netta 0, saldo invariato,
--     ma l'audit trail registra il consumo effettivo.
--   * release_credits (per fallimento definitivo) inserisce +1 -> rimborsa la
--     riserva e riporta il saldo al valore precedente.
-- In questo modo saldo = sum(ledger) resta sempre corretto, con audit completo.

create or replace function get_credit_balance(org uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(amount), 0)::int
  from credit_ledger
  where organization_id = org;
$$;

create or replace function grant_welcome_credits(org uuid, amt int)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Idempotente: concede i crediti di benvenuto solo se non gia' presenti.
  if not exists (
    select 1 from credit_ledger
    where organization_id = org and entry_type = 'welcome'
  ) then
    insert into credit_ledger (organization_id, amount, entry_type, reference_type, metadata_json)
    values (org, amt, 'welcome', 'signup', jsonb_build_object('granted_at', now()));
  end if;
end;
$$;

create or replace function reserve_credits(org uuid, amt int, ref_type text, ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_balance int;
begin
  -- Lock advisory a livello di transazione, serializza le riserve per org.
  perform pg_advisory_xact_lock(hashtext(org::text));

  select coalesce(sum(amount), 0)::int into current_balance
  from credit_ledger
  where organization_id = org;

  if current_balance >= amt then
    insert into credit_ledger (organization_id, amount, entry_type, reference_type, reference_id)
    values (org, -amt, 'reservation', ref_type, ref_id);
    return true;
  else
    return false;
  end if;
end;
$$;

create or replace function release_credits(org uuid, amt int, ref_type text, ref_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Rimborsa (accredita) unita' precedentemente riservate.
  insert into credit_ledger (organization_id, amount, entry_type, reference_type, reference_id)
  values (org, amt, 'release', ref_type, ref_id);
end;
$$;

create or replace function consume_reserved_credit(org uuid, ref_type text, ref_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Consuma 1 unita' precedentemente riservata mantenendo il saldo invariato
  -- ma registrando l'audit trail: release +1 (restituzione) + consumption -1.
  insert into credit_ledger (organization_id, amount, entry_type, reference_type, reference_id)
  values
    (org, 1, 'release', ref_type, ref_id),
    (org, -1, 'consumption', ref_type, ref_id);
end;
$$;

create or replace function apply_credit_purchase(org uuid, amt int, stripe_event uuid, price_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Idempotenza applicativa: non fare nulla se esiste gia' un acquisto per
  -- questo evento Stripe (reference_id = stripe_event).
  if exists (
    select 1 from credit_ledger
    where organization_id = org
      and entry_type = 'purchase'
      and reference_id = stripe_event
  ) then
    return;
  end if;

  insert into credit_ledger (organization_id, amount, entry_type, reference_type, reference_id, metadata_json)
  values (org, amt, 'purchase', 'stripe_event', stripe_event, jsonb_build_object('price_key', price_key));
end;
$$;

-- =====================================================================
-- Creazione organizzazione per un utente (onboarding)
-- =====================================================================

create or replace function create_organization_for_user(
  user_id uuid,
  org_name text,
  org_slug text,
  welcome_amt int default 3
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  existing_org uuid;
  new_org uuid;
begin
  -- Idempotente: se l'utente e' gia' membro di un'organizzazione, restituisce quella.
  select organization_id into existing_org
  from organization_members
  where organization_members.user_id = create_organization_for_user.user_id
  limit 1;

  if existing_org is not null then
    return existing_org;
  end if;

  insert into organizations (name, slug)
  values (org_name, org_slug)
  returning id into new_org;

  insert into organization_members (organization_id, user_id, role)
  values (new_org, create_organization_for_user.user_id, 'owner');

  perform grant_welcome_credits(new_org, welcome_amt);

  return new_org;
end;
$$;
