-- =====================================================================
-- Test RLS (SQL semplice, senza pgTAP).
-- =====================================================================
-- Come eseguirlo:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.test.sql
--
-- `ON_ERROR_STOP=1` non è un ornamento: senza, psql stampa l'errore e tira
-- dritto, e lo script esce con successo mentre le prove non sono passate. È
-- metà del motivo per cui questo file è rimasto rotto per mesi senza che
-- nessuno lo sapesse; l'altra metà era il `|| true` nel workflow.
--
-- Non servono i seed: tutto quello che serve se lo crea qui dentro.
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

-- I batch NON hanno più bisogno di un preset: dalla migrazione
-- `20250101000010_config_model.sql` la colonna `preset_version_id` è nullable e
-- senza chiave esterna. Qui c'era un `insert into presets (owner_organization_id,
-- key, category, is_system)` — le colonne del PRIMO modello, che quella stessa
-- migrazione elimina con `drop table ... cascade`. Il file era rotto da allora,
-- e non si vedeva perché la CI lo eseguiva con `|| true`.

-- Un batch appartenente a Org B.
insert into batches (id, organization_id, name)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Batch di Org B');

-- Un batch appartenente a Org A (per il test di lettura positiva).
insert into batches (id, organization_id, name)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Batch di Org A');

-- Un brand profile di Org A (per il test owner-manage).
insert into brand_profiles (id, organization_id, name)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tono Org A');

-- Un lotto, un abbonamento e un contatore per ciascuna organizzazione: quanti
-- crediti ha un cliente, fino a quando ha pagato e quanto ha usato l'assistente
-- sono tre cose che si leggono in casa propria e in nessun'altra.
insert into credit_lots (id, organization_id, source, granted, expires_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pack', 50, now() + interval '90 days'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'pack', 50, now() + interval '90 days');

insert into org_subscriptions (organization_id, stripe_subscription_id, status, current_period_start, current_period_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sub_a', 'active', now() - interval '1 day', now() + interval '29 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sub_b', 'active', now() - interval '1 day', now() + interval '29 days');

insert into assistant_counters (organization_id, cycle_start, cycle_end, requests) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', 7),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', 9);

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


-- =====================================================================
-- Il modello di configurazione: settori, categorie, attributi, preset.
--
-- È la parte del prodotto nata DOPO questo file, e finora non era coperta da
-- niente — proprio mentre diventava il posto dove vive il rischio multi-tenant:
-- una libreria di sistema condivisa da tutti gli inquilini, più le estensioni
-- di ciascuno.
--
-- Le regole da custodire, lette dalle policy e non indovinate:
--   · le righe di sistema (owner nullo) le legge chiunque sia autenticato;
--   · le righe di un'organizzazione le legge solo chi ne è membro;
--   · le righe di sistema **non le modifica nessuno**, perché `update` e
--     `delete` pretendono `owner_organization_id is not null`;
--   · e nessuno può crearne di nuove di sistema, per lo stesso motivo su
--     `insert`.
-- =====================================================================

reset role;
reset request.jwt.claims;

-- Un settore, una categoria di sistema e una categoria di Org B.
insert into sectors (id, key, name)
values ('55555555-5555-5555-5555-555555555555', 'prova', 'Settore di prova')
on conflict (id) do nothing;

insert into categories (id, owner_organization_id, sector_id, name)
values ('66666666-6666-6666-6666-666666666666', null,
        '55555555-5555-5555-5555-555555555555', 'Categoria di sistema');

insert into categories (id, owner_organization_id, sector_id, name)
values ('77777777-7777-7777-7777-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '55555555-5555-5555-5555-555555555555', 'Categoria di Org B');

insert into presets (id, organization_id, sector_id, name)
values ('88888888-8888-8888-8888-888888888888', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '55555555-5555-5555-5555-555555555555', 'Preset di Org B');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- =====================================================================
-- TEST 8: la libreria di sistema si legge, quella di un altro no
-- =====================================================================
do $$
declare
  sistema int;
  altrui int;
  settori int;
begin
  select count(*) into sistema from categories
  where id = '66666666-6666-6666-6666-666666666666';
  if sistema <> 1 then
    raise exception 'FALLITO T8a: user A non vede la categoria di sistema (count=%)', sistema;
  end if;

  select count(*) into altrui from categories
  where id = '77777777-7777-7777-7777-777777777777';
  if altrui <> 0 then
    raise exception 'FALLITO T8b: user A vede la categoria di Org B (count=%)', altrui;
  end if;

  -- Controllo positivo: i settori sono leggibili da tutti. Serve a distinguere
  -- «RLS funziona» da «non si vede niente comunque»: senza, un database che
  -- nega tutto passerebbe tutte le prove negative qui sopra.
  select count(*) into settori from sectors;
  if settori < 1 then
    raise exception 'FALLITO T8c: nessun settore visibile: la prova non sta guardando niente';
  end if;

  raise notice 'OK T8: sistema visibile, roba altrui no, e qualcosa si vede davvero';
end $$;

-- =====================================================================
-- TEST 9: la libreria di sistema è di sola lettura PER TUTTI
-- =====================================================================
do $$
declare
  toccate int;
begin
  update categories set name = 'hacked'
  where id = '66666666-6666-6666-6666-666666666666';
  get diagnostics toccate = row_count;
  if toccate <> 0 then
    raise exception 'FALLITO T9a: modificata la categoria di sistema (righe=%)', toccate;
  end if;

  delete from categories where id = '66666666-6666-6666-6666-666666666666';
  get diagnostics toccate = row_count;
  if toccate <> 0 then
    raise exception 'FALLITO T9b: cancellata la categoria di sistema (righe=%)', toccate;
  end if;

  raise notice 'OK T9: la libreria di sistema non si modifica e non si cancella';
end $$;

-- =====================================================================
-- TEST 10: nessuno può creare righe di sistema
-- =====================================================================
do $$
begin
  begin
    insert into categories (owner_organization_id, sector_id, name)
    values (null, '55555555-5555-5555-5555-555555555555', 'Finta di sistema');
    raise exception 'FALLITO T10: creata una categoria di sistema da authenticated';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'OK T10: non si creano categorie di sistema';
  end;
end $$;

-- =====================================================================
-- TEST 11: i preset sono per organizzazione, e basta
-- =====================================================================
do $$
declare
  visti int;
begin
  select count(*) into visti from presets
  where id = '88888888-8888-8888-8888-888888888888';
  if visti <> 0 then
    raise exception 'FALLITO T11a: user A vede il preset di Org B (count=%)', visti;
  end if;

  begin
    insert into presets (organization_id, sector_id, name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            '55555555-5555-5555-5555-555555555555', 'Preset infilato');
    raise exception 'FALLITO T11b: user A ha creato un preset dentro Org B';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'OK T11: i preset di un''altra organizzazione non si vedono e non si creano';
  end;
end $$;

-- =====================================================================
-- TEST 12: i lotti, l'abbonamento e i contatori si leggono solo in casa
-- =====================================================================
-- Non è un dettaglio: qui dentro c'è quanto ha comprato un cliente, quando
-- scade e quanto sta usando il prodotto. È il genere di riga che un concorrente
-- pagherebbe per vedere.
do $$
declare
  miei int;
  altrui int;
begin
  select count(*) into miei from credit_lots where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select count(*) into altrui from credit_lots where organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if miei <> 1 then raise exception 'FALLITO T12: user A non vede i propri lotti (%)', miei; end if;
  if altrui <> 0 then raise exception 'FALLITO T12: user A vede % lotti di Org B', altrui; end if;

  select count(*) into miei from org_subscriptions where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select count(*) into altrui from org_subscriptions where organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if miei <> 1 then raise exception 'FALLITO T12: user A non vede il proprio abbonamento (%)', miei; end if;
  if altrui <> 0 then raise exception 'FALLITO T12: user A vede l''abbonamento di Org B'; end if;

  select count(*) into miei from assistant_counters where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select count(*) into altrui from assistant_counters where organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if miei <> 1 then raise exception 'FALLITO T12: user A non vede il proprio contatore (%)', miei; end if;
  if altrui <> 0 then raise exception 'FALLITO T12: user A vede il contatore di Org B'; end if;

  raise notice 'OK T12: lotti, abbonamento e contatori restano dentro l''organizzazione';
end $$;

-- =====================================================================
-- TEST 13: e non si scrivono da fuori
-- =====================================================================
-- Un lotto lo crea chi ha incassato, non chi ha un account: senza questo, un
-- utente si regala 10.000 crediti con una `insert`.
do $$
declare
  toccate int;
begin
  begin
    insert into credit_lots (organization_id, source, granted)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual', 10000);
    raise exception 'FALLITO T13: un utente si è concesso 10.000 crediti';
  exception when insufficient_privilege then
    null;
  end;

  update credit_lots set granted = 9999 where id = 'a1a1a1a1-0000-0000-0000-000000000001';
  get diagnostics toccate = row_count;
  if toccate <> 0 then raise exception 'FALLITO T13: modificate % righe di credit_lots', toccate; end if;

  update org_subscriptions set status = 'active', current_period_end = now() + interval '10 years'
  where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  get diagnostics toccate = row_count;
  if toccate <> 0 then raise exception 'FALLITO T13: prolungato l''abbonamento da authenticated'; end if;

  update assistant_counters set allowance_used = 0
  where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  get diagnostics toccate = row_count;
  if toccate <> 0 then raise exception 'FALLITO T13: azzerato il contatore dell''assistente'; end if;

  raise notice 'OK T13: crediti, abbonamento e contatori non si scrivono da un account';
end $$;

-- ---------------------------------------------------------------------
-- Fine
-- ---------------------------------------------------------------------
reset role;
reset request.jwt.claims;

do $$ begin raise notice 'TUTTI I TEST RLS SUPERATI'; end $$;

rollback;
