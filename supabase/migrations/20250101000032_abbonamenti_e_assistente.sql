-- ---------------------------------------------------------------------------
-- L'abbonamento, l'omaggio a termine, e l'assistente che non si paga due volte.
--
-- L'ABBONAMENTO
--
-- 99 €/mese, 150 crediti che scadono a fine ciclo. La tabella tiene lo stato
-- che arriva da Stripe, non una copia del piano: il prezzo sta nel listino,
-- qui sta «questa organizzazione ha un abbonamento in questo stato fino a
-- questa data». Un solo abbonamento per organizzazione — due sarebbero due
-- fatture e un ciclo ambiguo.
--
-- L'OMAGGIO A TERMINE
--
-- `comp_until` è la data fino a cui un'organizzazione ha i diritti del piano a
-- pagamento senza pagare. Non è una regola di anzianità («chi c'era prima del
-- lancio tiene il vecchio prezzo per sempre»): quella si scrive facile e non si
-- toglie più, e fra un anno vincolerebbe il listino a una promessa fatta a
-- dodici persone. Una data si guarda, si sposta e scade da sola.
--
-- Chi sta già provando il prodotto oggi riceve tre mesi. Costa una manciata di
-- euro di modelli e compra i primi riscontri veri, che al momento valgono di
-- più.
--
-- L'ASSISTENTE È COMPRESO
--
-- Prima qui c'era una regola sbagliata: un quinto di credito a richiesta,
-- sopra a un credito già pagato per la scheda. Cioè far pagare due volte lo
-- stesso lavoro — la seconda volta proprio quando il cliente sta rimediando a
-- una nostra frase venuta male. Non si fa.
--
-- La regola è:
--
--     dotazione del ciclo = max(100, 5 × schede generate nel ciclo)
--
-- azzerata a fine ciclo. Chi genera poco ha comunque cento richieste; chi
-- genera molto ne ha cinque per scheda, che è più di quante ne servano a
-- chiunque stia lavorando davvero. **Oltre la dotazione, e solo oltre**, un
-- credito ogni cinque richieste: serve a fermare l'uso come chatbot generico,
-- non a fare margine.
--
-- Il contatore esiste perché `credit_ledger.amount` è un intero: un quinto di
-- credito non è rappresentabile, e non lo diventerà — un registro contabile con
-- i decimali è un registro con gli errori di arrotondamento. Si contano le
-- richieste e si addebita un credito intero ogni cinque.
-- ---------------------------------------------------------------------------

-- =====================================================================
-- Abbonamenti
-- =====================================================================

create table if not exists subscriptions (
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

create index if not exists subscriptions_status_idx on subscriptions(status);

drop trigger if exists set_updated_at on subscriptions;
create trigger set_updated_at before update on subscriptions
  for each row execute function set_updated_at();

alter table subscriptions enable row level security;

-- Lettura ai membri: «da quando a quando ho pagato» non è un segreto.
-- Scrittura solo da `service_role`, cioè solo dal webhook Stripe.
drop policy if exists subscriptions_select on subscriptions;
create policy subscriptions_select on subscriptions
  for select to authenticated using (is_organization_member(organization_id));

-- =====================================================================
-- L'omaggio a termine
-- =====================================================================

alter table organizations add column if not exists comp_until timestamptz;

comment on column organizations.comp_until is
  'Fino a questa data l''organizzazione ha i diritti del piano a pagamento senza pagare. Vuoto = nessun omaggio.';

/**
 * Regala (o prolunga) un periodo di diritti pieni. Prolunga, non riscrive: dare
 * tre mesi a chi ne ha ancora due deve fare cinque, non tre. È la differenza fra
 * un regalo e un taglio fatto per sbaglio.
 */
create or replace function grant_comp_period(org uuid, months int)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  fino timestamptz;
begin
  update organizations
  set comp_until = greatest(coalesce(comp_until, now()), now()) + make_interval(months => months)
  where id = org
  returning comp_until into fino;
  return fino;
end;
$$;

-- Chi c'è già oggi: tre mesi. Gira una volta sola perché tocca solo le
-- organizzazioni che una data non ce l'hanno, e quelle che nasceranno domani
-- sono nate dopo.
do $$
declare o uuid;
begin
  for o in select id from organizations where comp_until is null loop
    perform grant_comp_period(o, 3);
  end loop;
end $$;

-- =====================================================================
-- Il ciclo
-- =====================================================================

/**
 * Il ciclo corrente di un'organizzazione: quello dell'abbonamento se ce n'è
 * uno che paga, altrimenti il mese di calendario.
 *
 * Serve anche a chi non ha abbonamento, perché la dotazione dell'assistente
 * vale per tutti: senza un ciclo, «cento richieste» non vorrebbe dire niente.
 */
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
  left join subscriptions s
    on s.organization_id = org
   and s.status in ('trialing', 'active', 'past_due')
   and s.current_period_start <= at_time
   and s.current_period_end > at_time;
$$;

-- =====================================================================
-- L'assistente
-- =====================================================================

create table if not exists assistant_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  cycle_start timestamptz not null,
  cycle_end timestamptz not null,
  -- Tutte le richieste del ciclo, comprese quelle comprese nella dotazione.
  requests int not null default 0,
  -- Quante hanno consumato la dotazione. Si ferma alla dotazione del ciclo.
  allowance_used int not null default 0,
  -- Quante sono andate oltre. Ogni cinque, un credito.
  billable_requests int not null default 0,
  credits_charged int not null default 0,
  updated_at timestamptz not null default now(),
  unique (organization_id, cycle_start)
);

create index if not exists assistant_counters_org_idx on assistant_counters(organization_id);

alter table assistant_counters enable row level security;

drop policy if exists assistant_counters_select on assistant_counters;
create policy assistant_counters_select on assistant_counters
  for select to authenticated using (is_organization_member(organization_id));

/**
 * La dotazione di richieste dell'assistente per un ciclo:
 * `max(100, 5 × schede generate nel ciclo)`.
 *
 * Si contano le **schede**, non le generazioni: una scheda rigenerata tre volte
 * resta una scheda. Contare le generazioni darebbe più assistente a chi
 * rigenera di più, cioè premierebbe il caso in cui abbiamo lavorato peggio.
 */
create or replace function assistant_allowance(org uuid, cycle_start timestamptz, cycle_end timestamptz)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select greatest(100, 5 * count(distinct pg.product_id))::int
  from product_generations pg
  where pg.organization_id = org
    and pg.created_at >= cycle_start
    and pg.created_at < cycle_end;
$$;

/**
 * Registra una richiesta all'assistente e dice come è stata pagata.
 *
 * Restituisce
 *   { allowed, covered, charged, allowance, allowance_used, remaining,
 *     billable_requests, credits_charged, cycle_start, cycle_end }
 *
 * `allowed = false` succede in un caso solo: la dotazione è finita, tocca il
 * credito e il credito non c'è. In quel caso non si registra niente — nessun
 * contatore avanza per una richiesta che non è stata servita.
 */
create or replace function record_assistant_request(org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c record;
  dotazione int;
  riga assistant_counters;
  addebitato boolean := false;
  coperta boolean;
begin
  perform pg_advisory_xact_lock(hashtext('assistant:' || org::text));

  select * into c from current_cycle(org);
  dotazione := assistant_allowance(org, c.cycle_start, c.cycle_end);

  insert into assistant_counters (organization_id, cycle_start, cycle_end)
  values (org, c.cycle_start, c.cycle_end)
  on conflict (organization_id, cycle_start) do nothing;

  select * into riga from assistant_counters
  where organization_id = org and cycle_start = c.cycle_start;

  coperta := riga.allowance_used < dotazione;

  if not coperta then
    -- Fuori dotazione: un credito ogni cinque richieste, e il credito si
    -- addebita sulla quinta. Se non c'è, la richiesta non parte.
    if (riga.billable_requests + 1) % 5 = 0 then
      if not draw_from_lots(org, 1, 'consumption', 'assistant', riga.id, null) then
        return jsonb_build_object(
          'allowed', false, 'covered', false, 'charged', false,
          'allowance', dotazione, 'allowance_used', riga.allowance_used,
          'remaining', 0, 'billable_requests', riga.billable_requests,
          'credits_charged', riga.credits_charged,
          'cycle_start', c.cycle_start, 'cycle_end', c.cycle_end
        );
      end if;
      addebitato := true;
    end if;
  end if;

  update assistant_counters set
    requests = requests + 1,
    allowance_used = allowance_used + (case when coperta then 1 else 0 end),
    billable_requests = billable_requests + (case when coperta then 0 else 1 end),
    credits_charged = credits_charged + (case when addebitato then 1 else 0 end),
    updated_at = now()
  where id = riga.id
  returning * into riga;

  return jsonb_build_object(
    'allowed', true, 'covered', coperta, 'charged', addebitato,
    'allowance', dotazione, 'allowance_used', riga.allowance_used,
    'remaining', greatest(0, dotazione - riga.allowance_used),
    'billable_requests', riga.billable_requests,
    'credits_charged', riga.credits_charged,
    'cycle_start', c.cycle_start, 'cycle_end', c.cycle_end
  );
end;
$$;

/**
 * Il passaggio di ciclo dell'abbonamento, in una transazione sola: aggiorna il
 * periodo, fa scadere quello che restava del ciclo vecchio, accredita i crediti
 * del nuovo.
 *
 * In una transazione sola perché i tre pezzi non hanno senso separati: un
 * accredito senza scadenza raddoppierebbe la dotazione, una scadenza senza
 * accredito lascerebbe l'abbonato a zero dopo aver pagato.
 */
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

  update subscriptions set
    current_period_start = period_start,
    current_period_end = period_end,
    status = case when status in ('incomplete', 'past_due', 'unpaid') then 'active' else status end
  where organization_id = org
  returning monthly_credits into quanti;

  if quanti is null then
    raise exception 'nessun abbonamento per l''organizzazione %', org;
  end if;

  -- I crediti del ciclo appena chiuso scadono adesso, non «fra un po'».
  perform expire_credit_lots(org);
  perform grant_subscription_credits(org, coalesce(credits, quanti), stripe_event, period_end);
end;
$$;

grant execute on function grant_comp_period(uuid, int) to service_role;
grant execute on function current_cycle(uuid, timestamptz) to authenticated, service_role;
grant execute on function assistant_allowance(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function record_assistant_request(uuid) to service_role;
grant execute on function roll_subscription_cycle(uuid, uuid, timestamptz, timestamptz, int) to service_role;
