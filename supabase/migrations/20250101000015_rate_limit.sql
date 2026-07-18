-- =====================================================================
-- Rate limiting per organizzazione sulle azioni AI (anti-abuso costi).
--
-- Finestra fissa: per ogni (org, azione, finestra) teniamo un contatore.
-- consume_rate_limit incrementa atomicamente e ritorna true se ENTRO il
-- limite. Le azioni AI chiamano questa funzione prima di procedere.
-- =====================================================================

create table if not exists rate_limit_counters (
  organization_id uuid not null references organizations(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (organization_id, action, window_start)
);

create index if not exists rate_limit_counters_window_idx
  on rate_limit_counters(window_start);

-- SECURITY DEFINER: chiamata dal service client; nessuna policy pubblica.
alter table rate_limit_counters enable row level security;

create or replace function consume_rate_limit(
  org uuid,
  act text,
  max_per_window int,
  window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket timestamptz;
  new_count int;
begin
  -- Inizio della finestra corrente (allineato a multipli di window_seconds).
  bucket := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);

  insert into rate_limit_counters (organization_id, action, window_start, count)
    values (org, act, bucket, 1)
  on conflict (organization_id, action, window_start)
    do update set count = rate_limit_counters.count + 1
  returning count into new_count;

  return new_count <= max_per_window;
end;
$$;

-- Pulizia opportunistica delle finestre vecchie (best-effort, chiamabile da cron).
create or replace function purge_rate_limit_counters(older_than_seconds int default 86400)
returns void
language sql
security definer
set search_path = public
as $$
  delete from rate_limit_counters
  where window_start < now() - make_interval(secs => older_than_seconds);
$$;

-- Queste funzioni devono essere invocabili SOLO dal service client (mai da
-- anon/authenticated via PostgREST): altrimenti un utente potrebbe azzerare i
-- contatori (purge) o saturare quelli di un'altra org (DoS cross-tenant).
revoke all on function consume_rate_limit(uuid, text, int, int) from public, anon, authenticated;
revoke all on function purge_rate_limit_counters(int) from public, anon, authenticated;
grant execute on function consume_rate_limit(uuid, text, int, int) to service_role;
grant execute on function purge_rate_limit_counters(int) to service_role;
