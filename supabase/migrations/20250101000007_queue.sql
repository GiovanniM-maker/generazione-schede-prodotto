-- Wrapper RPC per la coda PGMQ "generation_jobs".
-- SECURITY DEFINER, eseguibili SOLO da service_role (worker/server).
-- Il messaggio contiene solo identificativi (jobItemId), mai l'intero prodotto.

create or replace function public.queue_send(msg jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  msg_id bigint;
begin
  select pgmq.send('generation_jobs', msg) into msg_id;
  return msg_id;
end;
$$;

create or replace function public.queue_read(vt integer, qty integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
begin
  return query
    select q.msg_id, q.read_ct, q.message
    from pgmq.read('generation_jobs', vt, qty) as q;
end;
$$;

create or replace function public.queue_delete(msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
begin
  return pgmq.delete('generation_jobs', msg_id);
end;
$$;

create or replace function public.queue_archive(msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
begin
  return pgmq.archive('generation_jobs', msg_id);
end;
$$;

-- Solo service_role può usare la coda. Nessun accesso da browser.
revoke all on function public.queue_send(jsonb) from public, anon, authenticated;
revoke all on function public.queue_read(integer, integer) from public, anon, authenticated;
revoke all on function public.queue_delete(bigint) from public, anon, authenticated;
revoke all on function public.queue_archive(bigint) from public, anon, authenticated;
grant execute on function public.queue_send(jsonb) to service_role;
grant execute on function public.queue_read(integer, integer) to service_role;
grant execute on function public.queue_delete(bigint) to service_role;
grant execute on function public.queue_archive(bigint) to service_role;
