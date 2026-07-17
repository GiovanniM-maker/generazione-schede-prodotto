-- =====================================================================
-- Test RLS (SQL semplice, senza pgTAP).
-- =====================================================================
-- Come eseguirlo:
--   psql "$DATABASE_URL" -f supabase/tests/rls.test.sql
-- oppure tramite `supabase db test` (dopo aver applicato le migrazioni + seed).
--
-- I test girano dentro una singola transazione che viene sempre ROLLBACK-ata,
-- quindi non lasciano residui. Vengono seminati due utenti in auth.users e due
-- organizzazioni. La simulazione dell'utente autenticato avviene con:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub": "<user_id>", "role": "authenticated"}';
-- perche' auth.uid() legge il claim "sub".
--
-- Ogni assertion fallita solleva un'eccezione (RAISE EXCEPTION) che fa fallire
-- l'intero script. Un run "verde" arriva fino al messaggio finale.

begin;

-- ---------------------------------------------------------------------
-- Seed di prova (dentro la transazione, verra' annullato dal rollback)
-- ---------------------------------------------------------------------

-- Due utenti auth. Colonne minime richieste da auth.users.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'user-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@example.com')
on conflict (id) do nothing;

-- Due organizzazioni.
insert into organizations (id, name, slug)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A', 'org-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B', 'org-b');

-- User A e' owner di Org A; User B e' owner di Org B.
insert into organization_members (organization_id, user_id, role)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner');

-- Serve un preset_version per la FK dei batch (usa quello di sistema del seed,
-- oppure creane uno di prova se il seed non e' stato caricato).
insert into presets (id, owner_organization_id, key, name, category, is_system)
values ('00000000-0000-0000-0000-0000000000a1', null, 'moda', 'Moda', 'fashion', true)
on conflict (id) do nothing;

insert into preset_versions (id, preset_id, version, fact_schema_json, content_schema_json,
  validation_rules_json, inference_policy_json, header_synonyms_json, published_at)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 1,
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())
on conflict (preset_id, version) do nothing;

-- Un batch appartenente a Org B.
insert into batches (id, organization_id, preset_version_id, name)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (select id from preset_versions where preset_id = '00000000-0000-0000-0000-0000000000a1' and version = 1),
  'Batch di Org B');

-- Un batch appartenente a Org A (per il test di lettura positiva).
insert into batches (id, organization_id, preset_version_id, name)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from preset_versions where preset_id = '00000000-0000-0000-0000-0000000000a1' and version = 1),
  'Batch di Org A');

-- Un brand profile di Org A (per il test owner-manage).
insert into brand_profiles (id, organization_id, name)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tono Org A');

-- =====================================================================
-- TEST 1: user A NON puo' vedere i batch di Org B
-- =====================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
declare
  visible int;
begin
  select count(*) into visible from batches
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  if visible <> 0 then
    raise exception 'FALLITO T1: user A vede il batch di Org B (count=%)', visible;
  end if;
  raise notice 'OK T1: user A non vede i batch di Org B';
end $$;

-- =====================================================================
-- TEST 2: user A NON puo' aggiornare il batch di Org B
-- =====================================================================
do $$
declare
  affected int;
begin
  update batches set name = 'hacked' where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLITO T2: user A ha aggiornato % righe del batch di Org B', affected;
  end if;
  raise notice 'OK T2: update del batch di Org B bloccato (0 righe)';
end $$;

-- =====================================================================
-- TEST 3: user A (membro) PUO' leggere i propri batch (Org A)
-- =====================================================================
do $$
declare
  visible int;
begin
  select count(*) into visible from batches
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  if visible <> 1 then
    raise exception 'FALLITO T3: user A non vede il proprio batch di Org A (count=%)', visible;
  end if;
  raise notice 'OK T3: user A vede i propri batch';
end $$;

-- =====================================================================
-- TEST 4: utente normale NON puo' inserire nel credit_ledger
-- =====================================================================
do $$
begin
  begin
    insert into credit_ledger (organization_id, amount, entry_type)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100, 'admin_adjustment');
    -- Se arriviamo qui l'insert e' passato: fallimento del test.
    raise exception 'FALLITO T4: insert nel credit_ledger consentito ad authenticated';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'OK T4: insert nel credit_ledger bloccato da RLS';
  end;
end $$;

-- =====================================================================
-- TEST 5: utente normale NON puo' toccare stripe_events (nessuna policy)
-- =====================================================================
do $$
declare
  visible int;
begin
  -- Lettura: deve restituire 0 righe (nessuna policy => deny all).
  select count(*) into visible from stripe_events;
  if visible <> 0 then
    raise exception 'FALLITO T5a: authenticated legge stripe_events (count=%)', visible;
  end if;

  -- Scrittura: deve essere bloccata.
  begin
    insert into stripe_events (stripe_event_id, event_type) values ('evt_test', 'test');
    raise exception 'FALLITO T5b: insert in stripe_events consentito ad authenticated';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'OK T5: stripe_events inaccessibile ad authenticated';
  end;
end $$;

-- =====================================================================
-- TEST 6: owner puo' gestire (aggiornare) il proprio brand profile
-- =====================================================================
do $$
declare
  affected int;
begin
  update brand_profiles set name = 'Tono Org A aggiornato'
  where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'FALLITO T6: owner non ha potuto aggiornare il proprio brand profile (righe=%)', affected;
  end if;
  raise notice 'OK T6: owner puo'' gestire il proprio brand profile';
end $$;

-- =====================================================================
-- TEST 7: user A (owner di A) NON puo' modificare il brand profile di un'altra org
-- (controllo incrociato: crea un brand profile per Org B come service e verifica il blocco)
-- =====================================================================
reset role;
reset request.jwt.claims;
insert into brand_profiles (id, organization_id, name)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tono Org B');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
declare
  affected int;
begin
  update brand_profiles set name = 'hacked'
  where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLITO T7: user A ha modificato il brand profile di Org B (righe=%)', affected;
  end if;
  raise notice 'OK T7: user A non puo'' modificare il brand profile di Org B';
end $$;

-- ---------------------------------------------------------------------
-- Fine
-- ---------------------------------------------------------------------
reset role;
reset request.jwt.claims;

do $$ begin raise notice 'TUTTI I TEST RLS SUPERATI'; end $$;

rollback;
