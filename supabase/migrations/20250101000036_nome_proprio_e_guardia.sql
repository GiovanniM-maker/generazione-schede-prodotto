-- ---------------------------------------------------------------------------
-- Un nome che non si può rubare, e una guardia che non lascia passare.
--
-- COSA È SUCCESSO
--
-- Il progetto Supabase di produzione non è nato con questa applicazione: è
-- riciclato da una precedente, e ne porta ancora quindici tabelle —
-- `articles`, `feeds_config`, `schedules`, `profiles`, `selection_prefs`… — più
-- un trigger su `auth.users` che ci scrive dentro a ogni registrazione.
--
-- Fra quelle quindici c'era anche una `subscriptions`, con `user_id` e `plan`.
-- La nostra migrazione `…000032` diceva `create table if not exists
-- subscriptions`: avrebbe trovato quella e l'avrebbe saltata, senza dire
-- niente, per poi fermarsi tre righe dopo sulla policy con «column
-- organization_id does not exist». Rilascio bloccato a metà — le migrazioni 30
-- e 31 già applicate, dalla 32 in poi no.
--
-- Verificato riproducendo la situazione su un Postgres vero, non dedotto.
--
-- COSA SI FA QUI
--
-- 1. La nostra tabella si chiama `org_subscriptions`. La `…000032` è stata
--    corretta alla fonte, perché in produzione non è mai girata; questa
--    migrazione rinomina quella già creata dove la vecchia versione era
--    passata (sviluppo, staging, e qualunque copia locale).
--
--    La `subscriptions` dell'altra applicazione **non si tocca**. Non è nostra,
--    ha nove righe, e un trigger di registrazione ci scrive dentro: cancellarla
--    romperebbe l'iscrizione di ogni nuovo utente.
--
-- 2. La guardia. `create table if not exists` è comodo e bugiardo: se il nome è
--    già occupato non crea niente e non lo dice. Qui si controlla che le tre
--    tabelle che quel costrutto crea siano davvero le nostre — cioè che
--    abbiano le colonne che ci aspettiamo — e se non lo sono la migrazione si
--    ferma con un messaggio che dice quale tabella e quale colonna manca.
--
--    Meglio un rilascio che si ferma con una frase leggibile che un rilascio
--    che passa e lascia l'applicazione a scrivere su una tabella di qualcun
--    altro.
-- ---------------------------------------------------------------------------

-- =====================================================================
-- 1. La guardia, PRIMA di tutto il resto
-- =====================================================================
--
-- In fondo al file non serviva a niente: la prima istruzione che tocca una
-- tabella con il nome rubato fallisce da sé, e il messaggio che si legge è
-- «column lo.source does not exist» — cioè il sintomo, tre schermate lontano
-- dalla causa. Provato, ed è successo esattamente così.
--
-- La guardia parla per prima o non parla.

/**
 * Pretende che una tabella nostra sia davvero nostra.
 *
 * `create table if not exists` non distingue fra «l'ho creata io» e «c'era già
 * ed è di qualcun altro»: nei due casi fa la stessa cosa, cioè niente, e non lo
 * dice. Questa funzione trasforma quel silenzio in un messaggio.
 */
create or replace function assert_tabella_nostra(nome text, colonne text[])
returns void
language plpgsql
as $$
declare
  mancante text;
begin
  if to_regclass('public.' || nome) is null then
    raise exception
      'la tabella «%» non esiste: una migrazione che doveva crearla non l''ha fatto.', nome;
  end if;

  select c into mancante
  from unnest(colonne) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = nome and column_name = c
  )
  limit 1;

  if mancante is not null then
    raise exception
      'la tabella «%» esiste ma non è la nostra: manca la colonna «%». '
      'Quasi certamente il nome era già occupato da un''altra applicazione su questo database, '
      'e `create table if not exists` l''ha saltata in silenzio.',
      nome, mancante;
  end if;
end;
$$;

do $$
begin
  perform assert_tabella_nostra('credit_lots', array['organization_id', 'source', 'granted', 'expires_at']);
  perform assert_tabella_nostra('assistant_counters', array['organization_id', 'cycle_start', 'allowance_used']);
  perform assert_tabella_nostra('credit_ledger', array['organization_id', 'lot_id', 'idempotency_key']);
end $$;

-- =====================================================================
-- 2. Il nome proprio
-- =====================================================================

do $$
begin
  -- Già a posto: ambiente nuovo, dove la `…000032` corretta ha creato subito
  -- il nome giusto.
  if to_regclass('public.org_subscriptions') is not null then
    return;
  end if;

  -- La `subscriptions` che c'è è NOSTRA (la riconosciamo da `organization_id`):
  -- si rinomina, portandosi dietro dati, indici e vincoli.
  if to_regclass('public.subscriptions') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'subscriptions'
         and column_name = 'organization_id'
     )
  then
    alter table public.subscriptions rename to org_subscriptions;
    raise notice 'org_subscriptions: rinominata dalla vecchia subscriptions';
    return;
  end if;

  -- Non c'è, oppure quella che c'è è di un'altra applicazione: si crea la
  -- nostra accanto, senza toccare niente.
  create table public.org_subscriptions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null unique references organizations(id) on delete cascade,
    stripe_subscription_id text unique,
    stripe_price_id text,
    plan_key text,
    status subscription_status not null default 'incomplete',
    monthly_credits int not null default 150,
    current_period_start timestamptz,
    current_period_end timestamptz,
    cancel_at_period_end boolean not null default false,
    canceled_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  raise notice 'org_subscriptions: creata da zero';
end $$;

-- Indici, trigger e regole di accesso: si rifanno comunque, perché il ramo che
-- ha rinominato la tabella si porta dietro i vecchi nomi degli oggetti.
alter index if exists subscriptions_status_idx rename to org_subscriptions_status_idx;
create index if not exists org_subscriptions_status_idx on org_subscriptions(status);

drop trigger if exists set_updated_at on org_subscriptions;
create trigger set_updated_at before update on org_subscriptions
  for each row execute function set_updated_at();

alter table org_subscriptions enable row level security;

drop policy if exists subscriptions_select on org_subscriptions;
drop policy if exists org_subscriptions_select on org_subscriptions;
create policy org_subscriptions_select on org_subscriptions
  for select to authenticated using (is_organization_member(organization_id));

-- Le due funzioni che leggevano il vecchio nome. Sugli ambienti nati prima
-- puntano ancora là: `create or replace` le riscrive.
create or replace function current_cycle(org uuid, at_time timestamptz default now())
returns table (cycle_start timestamptz, cycle_end timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    coalesce(s.current_period_start, date_trunc('month', at_time)),
    coalesce(s.current_period_end, date_trunc('month', at_time) + interval '1 month')
  from (select 1) as sempre
  left join org_subscriptions s
    on s.organization_id = org
   and s.status in ('trialing', 'active', 'past_due')
   and s.current_period_start <= at_time
   and s.current_period_end > at_time;
$$;

create or replace function roll_subscription_cycle(
  org uuid,
  stripe_event uuid,
  period_start timestamptz,
  period_end timestamptz,
  credits int default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  quanti int;
begin
  perform pg_advisory_xact_lock(hashtext(org::text));

  update org_subscriptions set
    current_period_start = period_start,
    current_period_end = period_end,
    status = case when status in ('incomplete', 'past_due', 'unpaid') then 'active' else status end
  where organization_id = org
  returning monthly_credits into quanti;

  if quanti is null then
    raise exception 'nessun abbonamento per l''organizzazione %', org;
  end if;

  perform expire_credit_lots(org);
  perform grant_subscription_credits(org, coalesce(credits, quanti), stripe_event, period_end);
end;
$$;

grant execute on function current_cycle(uuid, timestamptz) to authenticated, service_role;
grant execute on function roll_subscription_cycle(uuid, uuid, timestamptz, timestamptz, int) to service_role;

-- `entitlements` legge l'abbonamento: va riscritta anche lei.
create or replace function entitlements(org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with lotti as (
    select
      lo.id,
      lo.source::text as source,
      lo.expires_at,
      (lo.source = 'subscription') as prima,
      lo.created_at,
      coalesce(sum(cl.amount), 0)::int as remaining
    from credit_lots lo
    left join credit_ledger cl on cl.lot_id = lo.id
    where lo.organization_id = org
      and (lo.expires_at is null or lo.expires_at > now())
    group by lo.id, lo.source, lo.expires_at, lo.created_at
    having coalesce(sum(cl.amount), 0) > 0
  ),
  ciclo as (
    select cycle_start, cycle_end from current_cycle(org)
  )
  select jsonb_build_object(
    'balance', get_credit_balance(org),
    'lots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id, 'source', l.source,
          'remaining', l.remaining, 'expires_at', l.expires_at
        )
        order by l.prima desc, l.expires_at asc nulls last, l.created_at asc
      )
      from lotti l
    ), '[]'::jsonb),
    'subscription', (
      select jsonb_build_object(
        'status', s.status::text,
        'monthly_credits', s.monthly_credits,
        'current_period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end
      )
      from org_subscriptions s where s.organization_id = org
    ),
    'comp_until', (select o.comp_until from organizations o where o.id = org),
    'assistant', (
      select jsonb_build_object(
        'allowance', assistant_allowance(org, c.cycle_start, c.cycle_end),
        'requests', coalesce(ac.requests, 0),
        'allowance_used', coalesce(ac.allowance_used, 0),
        'billable_requests', coalesce(ac.billable_requests, 0),
        'credits_charged', coalesce(ac.credits_charged, 0),
        'cycle_start', c.cycle_start,
        'cycle_end', c.cycle_end
      )
      from ciclo c
      left join assistant_counters ac
        on ac.organization_id = org and ac.cycle_start = c.cycle_start
    ),
    'now', now()
  );
$$;

grant execute on function entitlements(uuid) to service_role;

-- E infine la nostra, che questa migrazione ha appena creato o rinominato.
do $$
begin
  perform assert_tabella_nostra('org_subscriptions', array['organization_id', 'monthly_credits', 'cancel_at_period_end']);
end $$;
