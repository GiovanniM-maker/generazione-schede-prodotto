-- =====================================================================
-- Test dei crediti: lotti, scadenze, prenotazioni, assistente.
-- =====================================================================
-- Come eseguirlo:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/crediti.test.sql
--
-- `ON_ERROR_STOP=1` non è un ornamento: senza, psql stampa l'errore e tira
-- dritto, e lo script esce con successo mentre le prove non sono passate.
--
-- Tutto gira in una transazione che finisce sempre in `rollback`: non resta
-- niente.
--
-- IL TEMPO
--
-- Nessuna di queste funzioni prende una data: leggono `now()`, che dentro una
-- transazione non si muove. La fine di un ciclo si simula per quello che è —
-- portando la scadenza di un lotto nel passato e passando la scopa — non
-- fingendo un orologio diverso. È la stessa cosa che succede alle 00:00 del
-- giorno di rinnovo, solo compressa.
-- =====================================================================

begin;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'a@example.com'),
  ('11111111-0000-0000-0000-000000000002', 'b@example.com'),
  ('11111111-0000-0000-0000-000000000003', 'c@example.com');

-- =====================================================================
-- TEST 1: chi si iscrive riceve dieci crediti di prova, che scadono
-- =====================================================================
do $$
declare
  org uuid;
  lotto credit_lots;
  saldo int;
begin
  org := create_organization_for_user('11111111-0000-0000-0000-000000000001', 'Uno', 'uno');

  select * into lotto from credit_lots where organization_id = org;
  -- Prima di ogni confronto: che il lotto ci sia. Su una riga assente ogni
  -- `<>` vale NULL, e un `if` su NULL non entra — il test passerebbe proprio
  -- nel caso peggiore, cioè nessun credito concesso a nessuno.
  if lotto.id is null then
    raise exception 'FALLITO T1: nessun lotto di benvenuto per l''organizzazione appena creata';
  end if;
  if lotto.source <> 'trial' then
    raise exception 'FALLITO T1: il lotto di benvenuto è «%», non «trial»', lotto.source;
  end if;
  if lotto.granted <> 10 then
    raise exception 'FALLITO T1: crediti di benvenuto = %, attesi 10', lotto.granted;
  end if;
  -- Trenta giorni, con un margine di un'ora per non dipendere dal minuto in
  -- cui gira il test.
  if lotto.expires_at is null
     or lotto.expires_at < now() + interval '29 days 23 hours'
     or lotto.expires_at > now() + interval '30 days 1 hour' then
    raise exception 'FALLITO T1: scadenza del lotto di prova = %, attesa fra 30 giorni', lotto.expires_at;
  end if;

  saldo := get_credit_balance(org);
  if saldo <> 10 then
    raise exception 'FALLITO T1: saldo = %, atteso 10', saldo;
  end if;

  -- Idempotente: due chiamate, un lotto solo.
  perform grant_welcome_credits(org, 10);
  if (select count(*) from credit_lots where organization_id = org) <> 1 then
    raise exception 'FALLITO T1: i crediti di benvenuto sono stati concessi due volte';
  end if;

  raise notice 'OK T1: dieci crediti di prova, con scadenza a trenta giorni';
end $$;

-- =====================================================================
-- TEST 2: il registro non si corregge — né in update né in delete
-- =====================================================================
do $$
declare
  riga uuid;
begin
  select id into riga from credit_ledger limit 1;

  begin
    update credit_ledger set amount = 9999 where id = riga;
    raise exception 'FALLITO T2: una riga del registro è stata modificata';
  exception when raise_exception then
    if sqlerrm like 'FALLITO T2%' then raise; end if;
  end;

  begin
    delete from credit_ledger where id = riga;
    raise exception 'FALLITO T2: una riga del registro è stata cancellata';
  exception when raise_exception then
    if sqlerrm like 'FALLITO T2%' then raise; end if;
  end;

  raise notice 'OK T2: il registro è append-only, anche per chi ha tutti i permessi';
end $$;

-- =====================================================================
-- TEST 3: ogni riga nuova ha un lotto
-- =====================================================================
do $$
declare
  org uuid;
begin
  select id into org from organizations where slug = 'uno';
  begin
    insert into credit_ledger (organization_id, amount, entry_type)
    values (org, 100, 'admin_adjustment');
    raise exception 'FALLITO T3: accreditati 100 crediti senza un lotto da cui vengano';
  exception when check_violation then
    null;
  end;
  raise notice 'OK T3: nessun credito senza provenienza';
end $$;

-- =====================================================================
-- TEST 4: l'ordine di consumo — abbonamento, poi scadenza più vicina
-- =====================================================================
do $$
declare
  org uuid;
  l_abbo uuid; l_vicino uuid; l_lontano uuid; l_eterno uuid;
  preso int;
begin
  -- Un'organizzazione senza crediti di benvenuto: qui si guarda l'ordine, e un
  -- lotto in più che nessuno ha messo apposta lo renderebbe illeggibile.
  insert into organizations (name, slug) values ('Ordine', 'ordine') returning id into org;

  -- Quattro lotti da 5, in ordine di creazione volutamente sbagliato rispetto
  -- all'ordine in cui vanno consumati.
  insert into credit_lots (organization_id, source, granted, expires_at)
  values (org, 'pack', 5, now() + interval '300 days') returning id into l_lontano;
  insert into credit_lots (organization_id, source, granted, expires_at)
  values (org, 'manual', 5, null) returning id into l_eterno;
  insert into credit_lots (organization_id, source, granted, expires_at)
  values (org, 'subscription', 5, now() + interval '20 days') returning id into l_abbo;
  insert into credit_lots (organization_id, source, granted, expires_at)
  values (org, 'pack', 5, now() + interval '10 days') returning id into l_vicino;

  insert into credit_ledger (organization_id, amount, entry_type, lot_id) values
    (org, 5, 'admin_adjustment', l_lontano),
    (org, 5, 'admin_adjustment', l_eterno),
    (org, 5, 'subscription_grant', l_abbo),
    (org, 5, 'purchase', l_vicino);

  -- 12 crediti: 5 dall'abbonamento, 5 dal lotto che scade prima, 2 dal
  -- pacchetto lontano. Il lotto senza scadenza si tocca per ultimo.
  if not reserve_credits(org, 12, 'test', gen_random_uuid()) then
    raise exception 'FALLITO T4: la prenotazione di 12 crediti è stata rifiutata';
  end if;

  select -coalesce(sum(amount), 0) into preso from credit_ledger
   where lot_id = l_abbo and entry_type = 'reservation';
  if preso <> 5 then raise exception 'FALLITO T4: dall''abbonamento presi %, attesi 5', preso; end if;

  select -coalesce(sum(amount), 0) into preso from credit_ledger
   where lot_id = l_vicino and entry_type = 'reservation';
  if preso <> 5 then raise exception 'FALLITO T4: dal lotto in scadenza presi %, attesi 5', preso; end if;

  select -coalesce(sum(amount), 0) into preso from credit_ledger
   where lot_id = l_lontano and entry_type = 'reservation';
  if preso <> 2 then raise exception 'FALLITO T4: dal pacchetto lontano presi %, attesi 2', preso; end if;

  select -coalesce(sum(amount), 0) into preso from credit_ledger
   where lot_id = l_eterno and entry_type = 'reservation';
  if preso <> 0 then raise exception 'FALLITO T4: toccato il lotto senza scadenza (%)', preso; end if;

  raise notice 'OK T4: prima l''abbonamento, poi la scadenza più vicina, per ultimo quello che non scade';
end $$;

-- =====================================================================
-- TEST 5: consumo e restituzione tornano al lotto giusto
-- =====================================================================
do $$
declare
  org uuid;
  lotto uuid;
  rif uuid := gen_random_uuid();
  saldo_prima int; saldo_dopo int;
  consumati int; rimasto int;
begin
  insert into organizations (name, slug) values ('Ritorno', 'ritorno') returning id into org;

  insert into credit_lots (organization_id, source, granted, expires_at)
  values (org, 'pack', 4, now() + interval '100 days') returning id into lotto;
  insert into credit_ledger (organization_id, amount, entry_type, lot_id)
  values (org, 4, 'purchase', lotto);

  saldo_prima := get_credit_balance(org);
  if not reserve_credits(org, 4, 'batch', rif) then
    raise exception 'FALLITO T5: prenotazione rifiutata';
  end if;

  -- Due schede riuscite, due fallite.
  perform consume_reserved_credit(org, 'batch', rif);
  perform consume_reserved_credit(org, 'batch', rif);
  perform release_credits(org, 2, 'batch', rif);

  saldo_dopo := get_credit_balance(org);
  if saldo_dopo <> saldo_prima - 2 then
    raise exception 'FALLITO T5: saldo % → %, attesi due crediti in meno', saldo_prima, saldo_dopo;
  end if;

  select count(*) into consumati from credit_ledger
   where reference_id = rif and entry_type = 'consumption';
  if consumati <> 2 then
    raise exception 'FALLITO T5: righe di consumo = %, attese 2', consumati;
  end if;

  -- E i due restituiti sono tornati dentro a un lotto, non nel vuoto.
  select coalesce(sum(amount), 0) into rimasto from credit_ledger
   where reference_id = rif and entry_type in ('reservation', 'release');
  if rimasto <> 0 then
    raise exception 'FALLITO T5: restano % unità prenotate e mai chiuse', -rimasto;
  end if;

  raise notice 'OK T5: due consumate, due restituite, nessuna unità sospesa';
end $$;

-- =====================================================================
-- TEST 6: quello che scade sparisce dal saldo, e resta scritto
-- =====================================================================
do $$
declare
  org uuid;
  lotto uuid;
  saldo_prima int; saldo_dopo int; bruciati int;
  riga int;
begin
  org := create_organization_for_user('11111111-0000-0000-0000-000000000002', 'Due', 'due');
  select id into lotto from credit_lots where organization_id = org;

  saldo_prima := get_credit_balance(org);
  if saldo_prima <> 10 then
    raise exception 'FALLITO T6: saldo iniziale %, atteso 10', saldo_prima;
  end if;

  -- Trenta giorni dopo.
  update credit_lots set expires_at = now() - interval '1 second' where id = lotto;

  -- Il saldo lo sa subito, prima ancora che passi la scopa.
  saldo_dopo := get_credit_balance(org);
  if saldo_dopo <> 0 then
    raise exception 'FALLITO T6: dopo la scadenza il saldo è %, atteso 0', saldo_dopo;
  end if;

  bruciati := expire_credit_lots(org);
  if bruciati <> 10 then
    raise exception 'FALLITO T6: bruciati %, attesi 10', bruciati;
  end if;

  select count(*) into riga from credit_ledger
   where lot_id = lotto and entry_type = 'expiry' and amount = -10;
  if riga <> 1 then
    raise exception 'FALLITO T6: righe di scadenza = %, attesa 1', riga;
  end if;

  -- Due passate della scopa non bruciano due volte.
  if expire_credit_lots(org) <> 0 then
    raise exception 'FALLITO T6: la seconda passata ha bruciato altri crediti';
  end if;

  if get_credit_balance(org) <> 0 then
    raise exception 'FALLITO T6: saldo non nullo dopo la scadenza';
  end if;

  raise notice 'OK T6: i crediti scaduti spariscono dal saldo e restano nel registro';
end $$;

-- =====================================================================
-- TEST 7: senza crediti non si prenota, e non si scrive niente
-- =====================================================================
do $$
declare
  org uuid;
  righe_prima int; righe_dopo int;
begin
  select id into org from organizations where slug = 'due';
  select count(*) into righe_prima from credit_ledger where organization_id = org;

  if reserve_credits(org, 500, 'batch', gen_random_uuid()) then
    raise exception 'FALLITO T7: prenotati 500 crediti con saldo zero';
  end if;

  select count(*) into righe_dopo from credit_ledger where organization_id = org;
  if righe_dopo <> righe_prima then
    raise exception 'FALLITO T7: la prenotazione rifiutata ha scritto % righe', righe_dopo - righe_prima;
  end if;

  raise notice 'OK T7: prenotazione rifiutata senza lasciare tracce';
end $$;

-- =====================================================================
-- TEST 8: lo stesso evento Stripe non accredita due volte
-- =====================================================================
do $$
declare
  org uuid;
  evento uuid := gen_random_uuid();
  lotti int;
  lotto credit_lots;
begin
  select id into org from organizations where slug = 'due';

  perform apply_credit_purchase(org, 50, evento, 'pack_50');
  perform apply_credit_purchase(org, 50, evento, 'pack_50');

  select count(*) into lotti from credit_lots
   where organization_id = org and source = 'pack';
  if lotti <> 1 then
    raise exception 'FALLITO T8: lotti creati = %, atteso 1', lotti;
  end if;
  if get_credit_balance(org) <> 50 then
    raise exception 'FALLITO T8: saldo = %, atteso 50', get_credit_balance(org);
  end if;

  select * into lotto from credit_lots where organization_id = org and source = 'pack';
  if lotto.expires_at is null then
    raise exception 'FALLITO T8: il pacchetto non scade mai';
  end if;
  if lotto.expires_at < now() + interval '360 days' then
    raise exception 'FALLITO T8: il pacchetto scade il %, attesi dodici mesi', lotto.expires_at;
  end if;

  raise notice 'OK T8: acquisto idempotente, pacchetto valido dodici mesi';
end $$;

-- =====================================================================
-- TEST 9: l'assistente è compreso — cento richieste anche a chi non genera
-- =====================================================================
do $$
declare
  org uuid;
  esito jsonb;
  i int;
  saldo_prima int;
begin
  select id into org from organizations where slug = 'due';
  saldo_prima := get_credit_balance(org);

  for i in 1..100 loop
    esito := record_assistant_request(org);
    if not (esito->>'covered')::boolean then
      raise exception 'FALLITO T9: la richiesta numero % è già fuori dotazione (%)', i, esito;
    end if;
  end loop;

  if (esito->>'allowance')::int <> 100 then
    raise exception 'FALLITO T9: dotazione = %, attesa 100', esito->>'allowance';
  end if;
  if get_credit_balance(org) <> saldo_prima then
    raise exception 'FALLITO T9: cento richieste comprese hanno tolto crediti';
  end if;

  -- La 101ª esce dalla dotazione ma non costa: si paga sulla quinta.
  esito := record_assistant_request(org);
  if (esito->>'covered')::boolean or (esito->>'charged')::boolean then
    raise exception 'FALLITO T9: la 101ª richiesta è stata addebitata subito (%)', esito;
  end if;

  for i in 1..4 loop esito := record_assistant_request(org); end loop;
  if not (esito->>'charged')::boolean then
    raise exception 'FALLITO T9: la quinta richiesta fuori dotazione non ha addebitato (%)', esito;
  end if;
  if get_credit_balance(org) <> saldo_prima - 1 then
    raise exception 'FALLITO T9: addebitati % crediti, atteso 1', saldo_prima - get_credit_balance(org);
  end if;

  raise notice 'OK T9: cento richieste comprese, poi un credito ogni cinque';
end $$;

-- =====================================================================
-- TEST 10: chi genera di più ha più assistente
-- =====================================================================
do $$
declare
  org uuid;
  lotto uuid;
  run uuid;
  prodotto uuid;
  batch uuid;
  c record;
  dotazione int;
  i int;
begin
  select id into org from organizations where slug = 'due';
  select cycle_start, cycle_end into c from current_cycle(org);

  insert into batches (id, organization_id, name)
  values (gen_random_uuid(), org, 'Batch dotazione') returning id into batch;
  insert into generation_runs (organization_id, batch_id, run_type, provider, model, prompt_version)
  values (org, batch, 'product_copy', 'test', 'test', 'v1') returning id into run;

  -- Quaranta schede: la dotazione diventa 200, non più 100.
  for i in 1..40 loop
    insert into products (organization_id, batch_id, sku, raw_input_json, canonical_attributes_json)
    values (org, batch, 'SKU-' || i, '{}', '{}') returning id into prodotto;
    insert into product_generations
      (organization_id, product_id, generation_run_id, input_hash, generated_content_json)
    values (org, prodotto, run, 'h' || i, '{}');
  end loop;

  dotazione := assistant_allowance(org, c.cycle_start, c.cycle_end);
  if dotazione <> 200 then
    raise exception 'FALLITO T10: dotazione = % con 40 schede, attesa 200', dotazione;
  end if;

  -- E una scheda rigenerata resta una scheda.
  insert into product_generations
    (organization_id, product_id, generation_run_id, input_hash, generated_content_json)
  values (org, prodotto, run, 'h-bis', '{}');
  if assistant_allowance(org, c.cycle_start, c.cycle_end) <> 200 then
    raise exception 'FALLITO T10: la rigenerazione ha aumentato la dotazione';
  end if;

  raise notice 'OK T10: dotazione = max(100, 5 × schede), le rigenerazioni non contano';
end $$;

-- =====================================================================
-- TEST 11: il rinnovo dell'abbonamento — scade il vecchio, arriva il nuovo
-- =====================================================================
do $$
declare
  org uuid;
  vecchio uuid;
  saldo int;
begin
  org := create_organization_for_user('11111111-0000-0000-0000-000000000003', 'Tre', 'tre');

  insert into org_subscriptions (organization_id, stripe_subscription_id, status, monthly_credits,
                             current_period_start, current_period_end)
  values (org, 'sub_test', 'active', 150, now() - interval '30 days', now() + interval '1 hour');

  perform grant_subscription_credits(org, 150, gen_random_uuid(), now() + interval '1 hour');
  select id into vecchio from credit_lots where organization_id = org and source = 'subscription';

  -- Ne consuma 20 su 150, poi il ciclo finisce.
  if not reserve_credits(org, 20, 'batch', gen_random_uuid()) then
    raise exception 'FALLITO T11: prenotazione rifiutata con 160 crediti disponibili';
  end if;

  update credit_lots set expires_at = now() - interval '1 second' where id = vecchio;
  perform roll_subscription_cycle(org, gen_random_uuid(), now(), now() + interval '30 days');

  -- I 130 avanzati sono spariti: 150 nuovi + i 10 di benvenuto.
  saldo := get_credit_balance(org);
  if saldo <> 160 then
    raise exception 'FALLITO T11: dopo il rinnovo il saldo è %, atteso 160 (150 nuovi + 10 di prova)', saldo;
  end if;

  if (select count(*) from credit_ledger where lot_id = vecchio and entry_type = 'expiry') <> 1 then
    raise exception 'FALLITO T11: il ciclo vecchio non ha lasciato una riga di scadenza';
  end if;

  raise notice 'OK T11: al rinnovo il residuo scade e i crediti nuovi arrivano, in una transazione sola';
end $$;

-- =====================================================================
-- TEST 12: tre organizzazioni, tre mesi
-- =====================================================================
-- Non è un test di una funzione: è il modello di prezzo messo in moto. Se una
-- delle tre righe finali non torna, la regola che sembrava giusta scritta a
-- parole non lo è nei numeri.
--
--   A — solo la prova. Genera 6 schede su 10 e poi sparisce: dopo trenta
--       giorni i 4 avanzati non ci sono più.
--   B — compra un pacchetto da 50. Ne usa 20 al mese: al terzo mese resta a
--       secco a metà, e il quarto batch va rifiutato prima di partire.
--   C — abbonata. 150 al mese che scadono a fine ciclo. Nel mese in cui ne
--       servono 160 compra un pacchetto, ma i 10 in più escono dai crediti di
--       prova, che scadono prima: il pacchetto resta intero. È l'ordine giusto,
--       e va visto sui numeri perché a parole sembra sbagliato.
-- =====================================================================
do $$
declare
  a uuid; b uuid; c uuid;
  lotto uuid;
  rif uuid;
  i int;
  saldo int;
  usati int;
begin
  insert into auth.users (id, email) values
    ('22222222-0000-0000-0000-000000000001', 'sim-a@example.com'),
    ('22222222-0000-0000-0000-000000000002', 'sim-b@example.com'),
    ('22222222-0000-0000-0000-000000000003', 'sim-c@example.com');

  a := create_organization_for_user('22222222-0000-0000-0000-000000000001', 'Sim A', 'sim-a');
  b := create_organization_for_user('22222222-0000-0000-0000-000000000002', 'Sim B', 'sim-b');
  c := create_organization_for_user('22222222-0000-0000-0000-000000000003', 'Sim C', 'sim-c');

  -- ---- A: mese 1 ----------------------------------------------------
  rif := gen_random_uuid();
  if not reserve_credits(a, 6, 'batch', rif) then
    raise exception 'FALLITO T12/A: 6 schede rifiutate con 10 crediti di prova';
  end if;
  for i in 1..6 loop perform consume_reserved_credit(a, 'batch', rif); end loop;
  if get_credit_balance(a) <> 4 then
    raise exception 'FALLITO T12/A: dopo 6 schede restano %, attesi 4', get_credit_balance(a);
  end if;

  -- ---- A: mese 2, la prova è scaduta --------------------------------
  update credit_lots set expires_at = now() - interval '1 second' where organization_id = a;
  perform expire_credit_lots(a);
  if get_credit_balance(a) <> 0 then
    raise exception 'FALLITO T12/A: dopo trenta giorni restano % crediti di prova', get_credit_balance(a);
  end if;
  if reserve_credits(a, 1, 'batch', gen_random_uuid()) then
    raise exception 'FALLITO T12/A: una scheda generata con la prova scaduta';
  end if;

  -- ---- B: compra 50, ne usa 20 al mese -------------------------------
  perform apply_credit_purchase(b, 50, gen_random_uuid(), 'pack_50');
  for i in 1..3 loop
    rif := gen_random_uuid();
    if i <= 2 then
      if not reserve_credits(b, 20, 'batch', rif) then
        raise exception 'FALLITO T12/B: batch del mese % rifiutato', i;
      end if;
      for usati in 1..20 loop perform consume_reserved_credit(b, 'batch', rif); end loop;
    else
      -- Terzo mese: restano 20 crediti (10 di prova + 50 comprati − 40 usati).
      -- Un batch da 30 righe non parte: si dice prima, non a metà.
      if reserve_credits(b, 30, 'batch', rif) then
        raise exception 'FALLITO T12/B: partito un batch da 30 con % crediti', get_credit_balance(b);
      end if;
      if not reserve_credits(b, 20, 'batch', rif) then
        raise exception 'FALLITO T12/B: rifiutato un batch da 20 con % crediti', get_credit_balance(b);
      end if;
      for usati in 1..20 loop perform consume_reserved_credit(b, 'batch', rif); end loop;
    end if;
  end loop;
  -- I 10 di benvenuto sono stati consumati per primi (scadono prima).
  if get_credit_balance(b) <> 0 then
    raise exception 'FALLITO T12/B: saldo finale %, atteso 0', get_credit_balance(b);
  end if;

  -- ---- C: abbonata, e un mese le servono 160 -------------------------
  insert into org_subscriptions (organization_id, stripe_subscription_id, status, monthly_credits,
                             current_period_start, current_period_end)
  values (c, 'sub_sim_c', 'active', 150, now() - interval '1 day', now() + interval '29 days');

  for i in 1..3 loop
    perform grant_subscription_credits(c, 150, gen_random_uuid(), now() + interval '29 days');
    select id into lotto from credit_lots
     where organization_id = c and source = 'subscription' and closed_at is null
     order by created_at desc limit 1;

    rif := gen_random_uuid();
    if i = 2 then
      -- Il mese di punta: 160 schede. Ne mancano 10, e li compra.
      perform apply_credit_purchase(c, 50, gen_random_uuid(), 'pack_50');
      if not reserve_credits(c, 160, 'batch', rif) then
        raise exception 'FALLITO T12/C: batch da 160 rifiutato dopo l''acquisto';
      end if;
      for usati in 1..160 loop perform consume_reserved_credit(c, 'batch', rif); end loop;
    else
      if not reserve_credits(c, 100, 'batch', rif) then
        raise exception 'FALLITO T12/C: batch da 100 rifiutato al mese %', i;
      end if;
      for usati in 1..100 loop perform consume_reserved_credit(c, 'batch', rif); end loop;
    end if;

    -- Fine ciclo: quello che avanza dell'abbonamento scade.
    update credit_lots set expires_at = now() - interval '1 second' where id = lotto;
    perform expire_credit_lots(c);
  end loop;

  -- Conto finale di C: 510 concessi (10 di prova + 450 di abbonamento + 50
  -- comprati), 360 consumati, 100 scaduti — i 50 avanzati del mese 1 e i 50 del
  -- mese 3, mentre il mese 2 è stato usato tutto. Restano 50, ed è il
  -- pacchetto: nel mese di punta i 10 mancanti sono usciti dalla prova, che
  -- scadeva prima, non dal pacchetto comprato apposta. È l'ordine giusto —
  -- prima quello che sta per morire — e vale anche quando il cliente ha appena
  -- pagato per l'altro.
  saldo := get_credit_balance(c);
  if saldo <> 50 then
    raise exception 'FALLITO T12/C: saldo finale %, attesi 50 del pacchetto', saldo;
  end if;

  select count(*) into usati from credit_lots
   where organization_id = c and source = 'pack' and closed_at is null;
  if usati <> 1 then
    raise exception 'FALLITO T12/C: il pacchetto risulta chiuso, ma ha ancora 50 crediti';
  end if;

  -- E i 100 scaduti sono scritti, non semplicemente scomparsi.
  select coalesce(-sum(amount), 0) into usati from credit_ledger
   where organization_id = c and entry_type = 'expiry';
  if usati <> 100 then
    raise exception 'FALLITO T12/C: risultano scaduti % crediti, attesi 100', usati;
  end if;

  raise notice 'OK T12: tre organizzazioni, tre mesi, i conti tornano';
end $$;

-- =====================================================================
-- TEST 13: l'omaggio è una data, e si prolunga invece di riscriversi
-- =====================================================================
-- Il travaso una-tantum della migrazione — tre mesi a chi c'era già — non è
-- verificabile qui dentro: le organizzazioni di questo file nascono dopo la
-- migrazione, e un controllo su «quelle di prima» in un database appena creato
-- non troverebbe niente e passerebbe per questo. Si prova la funzione che il
-- travaso chiama, che è dove sta la regola.
do $$
declare
  org uuid;
  senza int;
  primo timestamptz;
  secondo timestamptz;
begin
  insert into organizations (name, slug) values ('Omaggio', 'omaggio') returning id into org;

  select count(*) into senza from organizations where id = org and comp_until is null;
  if senza <> 1 then
    raise exception 'FALLITO T13: un''organizzazione nuova nasce già in omaggio';
  end if;

  primo := grant_comp_period(org, 3);
  if primo is null then
    raise exception 'FALLITO T13: l''omaggio non è arrivato a nessuno';
  end if;
  if primo < now() + interval '89 days' or primo > now() + interval '93 days' then
    raise exception 'FALLITO T13: tre mesi di omaggio scadono il %', primo;
  end if;

  -- Altri tre mesi a chi ne ha ancora tre fanno sei, non tre.
  secondo := grant_comp_period(org, 3);
  if secondo < primo + interval '89 days' then
    raise exception 'FALLITO T13: il secondo omaggio ha riscritto il primo (% → %)', primo, secondo;
  end if;

  raise notice 'OK T13: l''omaggio è una data, e si prolunga senza cancellare quella prima';
end $$;

-- =====================================================================
-- TEST 14: `entitlements` dice tutto, e nell'ordine giusto
-- =====================================================================
-- È la fonte unica su cui si disegna l'interfaccia: se sbaglia qui, sbaglia
-- nell'intestazione, nella pagina della fatturazione e nel controllo prima di
-- avviare un batch — tutti insieme e allo stesso modo, che è il modo peggiore.
do $$
declare
  org uuid;
  d jsonb;
  scaduto uuid;
  esaurito uuid;
begin
  insert into auth.users (id, email) values
    ('55555555-0000-0000-0000-000000000001', 'diritti@example.com');
  org := create_organization_for_user('55555555-0000-0000-0000-000000000001', 'Diritti', 'diritti');

  -- Un pacchetto (scade fra un anno), un lotto già scaduto e uno esaurito.
  perform apply_credit_purchase(org, 50, gen_random_uuid(), 'pack_50');
  insert into credit_lots (organization_id, source, granted, expires_at)
  values (org, 'manual', 99, now() - interval '1 day') returning id into scaduto;
  insert into credit_ledger (organization_id, amount, entry_type, lot_id)
  values (org, 99, 'admin_adjustment', scaduto);

  -- Un lotto valido ma finito: non ha crediti da mostrare, e una riga «0» in
  -- un elenco intitolato «i tuoi crediti» è solo un modo di far contare male.
  insert into credit_lots (organization_id, source, granted, expires_at)
  values (org, 'manual', 5, now() + interval '200 days') returning id into esaurito;
  insert into credit_ledger (organization_id, amount, entry_type, lot_id) values
    (org,  5, 'admin_adjustment', esaurito),
    (org, -5, 'consumption', esaurito);

  d := entitlements(org);

  -- Il saldo esclude lo scaduto: 10 di prova + 50 comprati.
  if (d->>'balance')::int <> 60 then
    raise exception 'FALLITO T14: saldo = %, atteso 60 (lo scaduto non conta)', d->>'balance';
  end if;

  if jsonb_array_length(d->'lots') <> 2 then
    raise exception 'FALLITO T14: lotti = %, attesi 2 (lo scaduto non si mostra)',
      jsonb_array_length(d->'lots');
  end if;

  -- Nell'ordine in cui si consumano: prima la prova, che scade fra trenta
  -- giorni, poi il pacchetto, che scade fra dodici mesi.
  if d->'lots'->0->>'source' <> 'trial' or d->'lots'->1->>'source' <> 'pack' then
    raise exception 'FALLITO T14: ordine dei lotti sbagliato: % poi %',
      d->'lots'->0->>'source', d->'lots'->1->>'source';
  end if;
  if (d->'lots'->0->>'remaining')::int <> 10 then
    raise exception 'FALLITO T14: nel lotto di prova risultano % crediti', d->'lots'->0->>'remaining';
  end if;

  -- L'assistente c'è sempre, anche senza abbonamento: la dotazione vale per
  -- tutti, e senza questo pezzo l'interfaccia non saprebbe cosa dire.
  --
  -- `is null` da solo non basta: un `null` DENTRO il json non è NULL in SQL, e
  -- il confronto successivo su una chiave assente vale NULL — cioè un `if` che
  -- non entra e un test che passa proprio quando il pezzo è sparito.
  if jsonb_typeof(d->'assistant') <> 'object'
     or coalesce((d->'assistant'->>'allowance')::int, -1) <> 100 then
    raise exception 'FALLITO T14: stato dell''assistente = %', d->'assistant';
  end if;

  if d->>'subscription' is not null then
    raise exception 'FALLITO T14: risulta un abbonamento che non c''è';
  end if;

  -- `now` viene dal database, non dall'orologio di chi guarda: le scadenze si
  -- confrontano con quello.
  if d->>'now' is null then
    raise exception 'FALLITO T14: manca l''istante di riferimento';
  end if;

  raise notice 'OK T14: i diritti in una risposta sola, senza gli scaduti e nell''ordine di consumo';
end $$;

rollback;

do $$ begin raise notice 'TUTTI I TEST DEI CREDITI SUPERATI'; end $$;
