-- =====================================================================
-- Test delle quattro cifre.
-- =====================================================================
-- Come eseguirlo:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/telemetria.test.sql
--
-- PERCHÉ ESISTE
--
-- Una vista che gira senza errori e restituisce zero righe sembra funzionare.
-- Le quattro cifre servono a decidere un prezzo: una vista che conta male non
-- si vede, si crede. Qui si semina una situazione con i numeri noti a mano e si
-- pretende che le viste dicano quelli.
--
-- Il file comincia pretendendo che le tabelle di partenza siano vuote: senza,
-- i totali qui sotto verrebbero da dati che non ho messo io e le prove
-- passerebbero o fallirebbero per caso.
--
-- Tutto in una transazione che finisce in `rollback`.
-- =====================================================================

begin;

do $$
declare
  n int;
begin
  select count(*) into n from generation_runs;
  if n <> 0 then
    raise exception 'PRECONDIZIONE: ci sono già % esecuzioni. Serve un database senza dati.', n;
  end if;
  select count(*) into n from credit_ledger;
  if n <> 0 then
    raise exception 'PRECONDIZIONE: il registro crediti non è vuoto (% righe).', n;
  end if;
end $$;

insert into auth.users (id, email) values
  ('33333333-0000-0000-0000-000000000001', 'tel-a@example.com'),
  ('33333333-0000-0000-0000-000000000002', 'tel-b@example.com'),
  ('33333333-0000-0000-0000-000000000003', 'tel-c@example.com');

-- ---------------------------------------------------------------------
-- La situazione, con i numeri decisi a tavolino
-- ---------------------------------------------------------------------
--   · 3 esecuzioni da 0,10 € = 0,30 € di costo stimato
--   · 5 schede distinte, 7 generazioni (una scheda rifatta tre volte)
--     → costo per scheda 0,06 ; generazioni medie 1,4 ; 4 su 5 al primo colpo
--   · 12 messaggi scritti da persone + 3 correzioni = 15 richieste
--     → 3 richieste per scheda, dotazione 100, quindi dentro
--   · due organizzazioni che hanno comprato 120 giorni fa; una sola ha
--     ricomprato entro i novanta → 50%
--   · una terza che ha comprato ieri: non ha ancora avuto novanta giorni per
--     ricomprare, e va tenuta fuori dal conto
do $$
declare
  org uuid;
  altra uuid;
  recente uuid;
  batch uuid;
  run uuid;
  prod uuid;
  primo_prod uuid;
  conv uuid;
  lotto uuid;
  i int;
begin
  org := create_organization_for_user('33333333-0000-0000-0000-000000000001', 'Tele', 'tele');
  altra := create_organization_for_user('33333333-0000-0000-0000-000000000002', 'Tele Due', 'tele-due');
  recente := create_organization_for_user('33333333-0000-0000-0000-000000000003', 'Tele Tre', 'tele-tre');

  insert into batches (organization_id, name) values (org, 'Batch telemetria') returning id into batch;

  for i in 1..3 loop
    insert into generation_runs (organization_id, batch_id, run_type, provider, model,
                                 prompt_version, status, estimated_cost, input_tokens, output_tokens)
    values (org, batch, 'product_copy', 'test', 'test', 'v1', 'completed', 0.10, 1000, 500)
    returning id into run;
  end loop;

  for i in 1..5 loop
    insert into products (organization_id, batch_id, sku, raw_input_json, canonical_attributes_json)
    values (org, batch, 'TEL-' || i, '{}', '{}') returning id into prod;
    if i = 1 then primo_prod := prod; end if;
    insert into product_generations (organization_id, product_id, generation_run_id, input_hash, generated_content_json)
    values (org, prod, run, 'h' || i, '{}');
  end loop;

  -- La prima scheda è stata rifatta due volte: 7 generazioni su 5 schede.
  insert into product_generations (organization_id, product_id, generation_run_id, input_hash, generated_content_json)
  values (org, primo_prod, run, 'h1-bis', '{}'), (org, primo_prod, run, 'h1-ter', '{}');

  -- L'assistente: dodici messaggi scritti da una persona, tre risposte del
  -- modello (che non contano), tre correzioni con il perché.
  insert into configuration_conversations (organization_id, entity_type)
  values (org, 'category') returning id into conv;
  for i in 1..12 loop
    insert into configuration_messages (conversation_id, role, content) values (conv, 'user', 'ciao ' || i);
  end loop;
  for i in 1..3 loop
    insert into configuration_messages (conversation_id, role, content) values (conv, 'assistant', 'risposta ' || i);
  end loop;
  for i in 1..3 loop
    insert into output_corrections (organization_id, field_key, reason)
    values (org, 'generated_title', 'suonava male');
  end loop;

  -- Gli acquisti: entrambe 120 giorni fa, una sola ricompra a 60.
  insert into credit_lots (organization_id, source, granted, created_at)
  values (org, 'pack', 50, now() - interval '120 days') returning id into lotto;
  insert into credit_ledger (organization_id, amount, entry_type, lot_id, created_at)
  values (org, 50, 'purchase', lotto, now() - interval '120 days');

  insert into credit_lots (organization_id, source, granted, created_at)
  values (org, 'pack', 50, now() - interval '60 days') returning id into lotto;
  insert into credit_ledger (organization_id, amount, entry_type, lot_id, created_at)
  values (org, 50, 'purchase', lotto, now() - interval '60 days');

  insert into credit_lots (organization_id, source, granted, created_at)
  values (altra, 'pack', 50, now() - interval '120 days') returning id into lotto;
  insert into credit_ledger (organization_id, amount, entry_type, lot_id, created_at)
  values (altra, 50, 'purchase', lotto, now() - interval '120 days');

  -- La terza ha comprato ieri: è troppo presto per dire se ricomprerà.
  insert into credit_lots (organization_id, source, granted, created_at)
  values (recente, 'pack', 50, now() - interval '1 day') returning id into lotto;
  insert into credit_ledger (organization_id, amount, entry_type, lot_id, created_at)
  values (recente, 50, 'purchase', lotto, now() - interval '1 day');
end $$;

-- =====================================================================
-- TEST 1: quanto costa una scheda
-- =====================================================================
do $$
declare
  v record;
begin
  select * into v from telemetry_cost_per_card where mese = date_trunc('month', now());
  if v.mese is null then
    raise exception 'FALLITO T1: la vista non ha una riga per questo mese';
  end if;
  if v.schede <> 5 then
    raise exception 'FALLITO T1: schede = %, attese 5', v.schede;
  end if;
  if v.costo_stimato <> 0.30 then
    raise exception 'FALLITO T1: costo stimato = %, atteso 0,30', v.costo_stimato;
  end if;
  -- Il punto di tutto: il costo NON va moltiplicato per le generazioni. Un
  -- `join` fra esecuzioni e generazioni conterebbe 0,30 sette volte.
  if v.costo_per_scheda <> 0.06 then
    raise exception 'FALLITO T1: costo per scheda = %, atteso 0,06', v.costo_per_scheda;
  end if;
  if v.token_ingresso <> 3000 or v.token_uscita <> 1500 then
    raise exception 'FALLITO T1: token % / %, attesi 3000 / 1500', v.token_ingresso, v.token_uscita;
  end if;
  raise notice 'OK T1: costo per scheda 0,06 € — e il costo non si moltiplica per le rigenerazioni';
end $$;

-- =====================================================================
-- TEST 2: quante volte si rigenera
-- =====================================================================
do $$
declare
  v record;
begin
  select * into v from telemetry_regenerations_per_card where mese = date_trunc('month', now());
  if v.mese is null then
    raise exception 'FALLITO T2: la vista non ha una riga per questo mese';
  end if;
  if v.schede <> 5 then
    raise exception 'FALLITO T2: schede = %, attese 5', v.schede;
  end if;
  if v.generazioni_medie <> 1.40 then
    raise exception 'FALLITO T2: generazioni medie = %, attese 1,40', v.generazioni_medie;
  end if;
  if v.massimo <> 3 then
    raise exception 'FALLITO T2: massimo = %, atteso 3', v.massimo;
  end if;
  if v.al_primo_colpo <> 4 or v.percento_al_primo_colpo <> 80.0 then
    raise exception 'FALLITO T2: al primo colpo % su 5, percentuale %, attesi 4 e 80',
      v.al_primo_colpo, v.percento_al_primo_colpo;
  end if;
  raise notice 'OK T2: 1,4 generazioni per scheda, 4 su 5 al primo colpo';
end $$;

-- =====================================================================
-- TEST 3: l'assistente, per scheda e contro la dotazione
-- =====================================================================
do $$
declare
  v record;
  org uuid;
begin
  select id into org from organizations where slug = 'tele';
  select * into v from telemetry_assistant_per_card
   where mese = date_trunc('month', now()) and organization_id = org;

  if v.organization_id is null then
    raise exception 'FALLITO T3: nessuna riga per l''organizzazione seminata';
  end if;
  -- Dodici messaggi di persona + tre correzioni. Le tre risposte del modello
  -- non sono richieste: contarle gonfierebbe la cifra del 20%.
  if v.richieste <> 15 then
    raise exception 'FALLITO T3: richieste = %, attese 15', v.richieste;
  end if;
  if v.schede <> 5 then
    raise exception 'FALLITO T3: schede = %, attese 5', v.schede;
  end if;
  if v.dotazione <> 100 then
    raise exception 'FALLITO T3: dotazione = %, attesa 100 (il minimo)', v.dotazione;
  end if;
  if v.richieste_per_scheda <> 3.00 then
    raise exception 'FALLITO T3: richieste per scheda = %, attese 3', v.richieste_per_scheda;
  end if;
  if v.oltre_la_dotazione then
    raise exception 'FALLITO T3: 15 richieste risultano oltre una dotazione di 100';
  end if;
  raise notice 'OK T3: 15 richieste, 3 per scheda, dentro la dotazione';
end $$;

-- =====================================================================
-- TEST 4: chi ricompra entro novanta giorni
-- =====================================================================
do $$
declare
  v record;
begin
  select * into v from telemetry_repurchase_90d
   where coorte = date_trunc('month', now() - interval '120 days');

  if v.coorte is null then
    raise exception 'FALLITO T4: nessuna coorte per chi ha comprato 120 giorni fa';
  end if;
  if v.organizzazioni <> 2 then
    raise exception 'FALLITO T4: organizzazioni nella coorte = %, attese 2', v.organizzazioni;
  end if;
  if v.hanno_ricomprato <> 1 or v.percento <> 50.0 then
    raise exception 'FALLITO T4: riacquisti %, percentuale %, attesi 1 e 50', v.hanno_ricomprato, v.percento;
  end if;

  -- E la terza organizzazione, che ha comprato ieri, non compare da nessuna
  -- parte: novanta giorni non sono ancora passati, e contarla come «non ha
  -- ricomprato» abbasserebbe la cifra proprio nei mesi in cui si vende di più.
  if exists (
    select 1 from telemetry_repurchase_90d
    where coorte = date_trunc('month', now() - interval '1 day')
  ) then
    raise exception 'FALLITO T4: nella coorte c''è chi ha comprato ieri, e non ha ancora avuto tempo';
  end if;

  raise notice 'OK T4: 1 su 2 ha ricomprato entro novanta giorni, e i troppo recenti restano fuori';
end $$;

rollback;

do $$ begin raise notice 'TUTTI I TEST DELLA TELEMETRIA SUPERATI'; end $$;
