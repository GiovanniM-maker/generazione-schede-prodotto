-- ---------------------------------------------------------------------------
-- I crediti diventano lotti, e i lotti scadono.
--
-- COM'ERA
--
-- Il saldo era `sum(amount)` sul registro: un numero solo, senza provenienza e
-- senza data di morte. Funziona finché tutti i crediti sono uguali. Non lo sono
-- più:
--
--   · i pacchetti (50/200/500) valgono dodici mesi;
--   · i 150 crediti mensili dell'abbonamento valgono fino a fine ciclo;
--   · i crediti di benvenuto valgono trenta giorni.
--
-- Con un numero solo, «quanto mi scade a fine mese» non è una domanda
-- rispondibile — e nemmeno «ho consumato l'abbonamento o il pacchetto che ho
-- comprato a marzo». Servono i lotti.
--
-- COM'È ADESSO
--
-- Un lotto è una concessione: quanti crediti, da dove, entro quando. Il
-- registro resta l'unica verità sui movimenti — un lotto non ha un contatore
-- «rimanenti» da tenere allineato: quello che resta è la somma delle righe che
-- puntano a lui. Un contatore in più sarebbe un secondo posto dove il saldo può
-- sbagliare.
--
--   rimanenti(lotto) = sum(credit_ledger.amount where lot_id = lotto)
--   saldo(org)       = somma delle righe dei lotti non scaduti
--
-- ORDINE DI CONSUMO
--
--   1. abbonamento — scade comunque a fine ciclo, sprecarlo è la perdita certa
--   2. scadenza più vicina
--   3. il più vecchio
--
-- È l'ordine che fa perdere meno al cliente. Il contrario (prima quello che
-- dura di più) farebbe scadere per primi i crediti pagati, e sarebbe una scelta
-- a nostro favore fatta in silenzio.
--
-- LA SCADENZA È UNA RIGA, NON UN FILTRO
--
-- Quando un lotto scade, `expire_credit_lots` scrive una riga `expiry` di segno
-- negativo pari a quello che restava. Così il saldo continua a essere una
-- somma, e la scomparsa di quei crediti è leggibile: quanti, quando, di quale
-- lotto. `get_credit_balance` esclude comunque i lotti scaduti anche prima che
-- la scopa sia passata, altrimenti il saldo resterebbe gonfio fino al prossimo
-- passaggio.
--
-- IL REGISTRO NON SI CORREGGE
--
-- Fino a oggi «append-only» era una convenzione: nessun codice faceva `update`
-- sul registro, ma niente lo impediva. Adesso lo impedisce un trigger, e vale
-- anche per `service_role`. Un registro contabile che si può correggere non è
-- un registro contabile: uno sbaglio si aggiusta con una riga in più, mai
-- riscrivendo quella prima.
--
-- CHI HA GIÀ DEI CREDITI NON LI PERDE
--
-- Il saldo di ogni organizzazione diventa un lotto `manual` **senza scadenza**.
-- Non con una `update` sulle righe vecchie — quelle restano come sono — ma con
-- due righe che si annullano: −saldo sul secchio senza lotto, +saldo sul lotto
-- nuovo. Il saldo non si muove di un credito, e da qui in avanti ogni movimento
-- ha un lotto.
-- ---------------------------------------------------------------------------

-- =====================================================================
-- I lotti
-- =====================================================================

create table if not exists credit_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source credit_lot_source not null,
  granted int not null check (granted > 0),
  -- Vuoto = non scade. È il caso dei lotti di migrazione: nessuno ha comprato
  -- quei crediti sapendo che avevano una scadenza, e non gliela mettiamo dopo.
  expires_at timestamptz,
  -- Valorizzato quando il lotto è esaurito o scaduto: serve a non riesaminarlo
  -- a ogni prelievo, non a decidere se è ancora valido.
  closed_at timestamptz,
  reference_type text,
  reference_id uuid,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists credit_lots_org_idx on credit_lots(organization_id);
create index if not exists credit_lots_aperti_idx
  on credit_lots(organization_id, expires_at) where closed_at is null;

alter table credit_lots enable row level security;

-- Sola lettura per i membri: «cosa ho e quando scade» è una domanda legittima.
-- Scrivere sui lotti resta delle funzioni e di `service_role`.
drop policy if exists credit_lots_select on credit_lots;
create policy credit_lots_select on credit_lots
  for select to authenticated using (is_organization_member(organization_id));

-- =====================================================================
-- Il registro impara due colonne
-- =====================================================================

alter table credit_ledger
  add column if not exists lot_id uuid references credit_lots(id) on delete restrict,
  add column if not exists idempotency_key text;

comment on column credit_ledger.lot_id is
  'Il lotto da cui questa riga toglie o a cui aggiunge. Obbligatorio dalle righe nuove in poi.';
comment on column credit_ledger.idempotency_key is
  'Chiave del fatto esterno che ha causato la riga (evento Stripe, richiesta). Unica: due consegne dello stesso evento scrivono una riga sola.';

create index if not exists credit_ledger_lot_idx on credit_ledger(lot_id);
create unique index if not exists credit_ledger_idem_idx
  on credit_ledger(idempotency_key) where idempotency_key is not null;

-- Append-only, per davvero.
create or replace function credit_ledger_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'credit_ledger è append-only: % non è ammessa. Per correggere, aggiungi una riga di rettifica.',
    tg_op;
end;
$$;

drop trigger if exists credit_ledger_no_update on credit_ledger;
create trigger credit_ledger_no_update
  before update or delete on credit_ledger
  for each row execute function credit_ledger_is_append_only();

-- =====================================================================
-- Chi ha già dei crediti li porta con sé
-- =====================================================================

do $$
declare
  o record;
  nuovo uuid;
begin
  for o in
    select organization_id, sum(amount)::int as saldo
    from credit_ledger
    where lot_id is null
    group by organization_id
    having sum(amount) > 0
  loop
    insert into credit_lots (organization_id, source, granted, expires_at, reference_type, metadata_json)
    values (o.organization_id, 'manual', o.saldo, null, 'lot_migration',
            jsonb_build_object('motivo', 'saldo precedente al modello a lotti'))
    returning id into nuovo;

    -- Due righe che si annullano: il saldo non cambia, la provenienza sì.
    insert into credit_ledger
      (organization_id, amount, entry_type, reference_type, reference_id, lot_id, metadata_json)
    values
      (o.organization_id, -o.saldo, 'admin_adjustment', 'lot_migration', nuovo, null,
       jsonb_build_object('motivo', 'chiusura del saldo senza lotto')),
      (o.organization_id,  o.saldo, 'admin_adjustment', 'lot_migration', nuovo, nuovo,
       jsonb_build_object('motivo', 'apertura del lotto di migrazione'));
  end loop;
end $$;

-- Da qui in avanti ogni riga ha un lotto. `not valid` vuol dire: le righe
-- vecchie restano com'erano (compresa la −saldo qui sopra, che il secchio
-- vecchio lo chiude e quindi un lotto non ce l'ha), le nuove no.
do $$ begin
  alter table credit_ledger
    add constraint credit_ledger_ha_un_lotto check (lot_id is not null) not valid;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Saldo e scadenze
-- =====================================================================

-- I lotti scaduti non contano, anche se la scopa non è ancora passata.
create or replace function get_credit_balance(org uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(cl.amount), 0)::int
  from credit_ledger cl
  left join credit_lots lo on lo.id = cl.lot_id
  where cl.organization_id = org
    and (lo.id is null or lo.expires_at is null or lo.expires_at > now());
$$;

/**
 * Scrive la scomparsa dei crediti scaduti e chiude i lotti. Restituisce quanti
 * crediti sono stati bruciati.
 *
 * È idempotente per costruzione, non per una chiave: dopo il primo passaggio i
 * rimanenti di quel lotto sono zero, quindi il secondo non scrive niente.
 */
create or replace function expire_credit_lots(org uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  l record;
  rimasto int;
  bruciati int := 0;
begin
  for l in
    select lo.id
    from credit_lots lo
    where lo.organization_id = org
      and lo.expires_at is not null
      and lo.expires_at <= now()
  loop
    select coalesce(sum(cl.amount), 0)::int into rimasto
    from credit_ledger cl where cl.lot_id = l.id;

    if rimasto > 0 then
      insert into credit_ledger
        (organization_id, amount, entry_type, reference_type, reference_id, lot_id, metadata_json)
      values
        (org, -rimasto, 'expiry', 'credit_lot', l.id, l.id,
         jsonb_build_object('scaduti', rimasto));
      bruciati := bruciati + rimasto;
    end if;

    update credit_lots set closed_at = coalesce(closed_at, now()) where id = l.id;
  end loop;

  return bruciati;
end;
$$;

-- =====================================================================
-- Prelievo dai lotti
-- =====================================================================

/**
 * Toglie `amt` crediti dai lotti aperti nell'ordine di consumo, spezzando
 * l'importo fra più lotti se serve. Restituisce `false` senza scrivere niente
 * se non bastano.
 *
 * `idem`, se dato, è il prefisso della chiave di idempotenza: le righe
 * diventano `idem:<lotto>`. Se una riga con quel prefisso c'è già, il prelievo
 * è già avvenuto e la funzione dice di sì senza rifarlo.
 */
create or replace function draw_from_lots(
  org uuid,
  amt int,
  kind credit_entry_type,
  ref_type text,
  ref_id uuid,
  idem text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  l record;
  quota int;
  mancano int := amt;
begin
  if amt <= 0 then
    return true;
  end if;

  if idem is not null and exists (
    select 1 from credit_ledger where idempotency_key like idem || ':%'
  ) then
    return true;
  end if;

  if get_credit_balance(org) < amt then
    return false;
  end if;

  for l in
    select lo.id, coalesce(sum(cl.amount), 0)::int as rimasto
    from credit_lots lo
    left join credit_ledger cl on cl.lot_id = lo.id
    where lo.organization_id = org
      and lo.closed_at is null
      and (lo.expires_at is null or lo.expires_at > now())
    group by lo.id, lo.source, lo.expires_at, lo.created_at
    having coalesce(sum(cl.amount), 0) > 0
    order by (lo.source = 'subscription') desc, lo.expires_at asc nulls last, lo.created_at asc
  loop
    exit when mancano = 0;
    quota := least(l.rimasto, mancano);

    insert into credit_ledger
      (organization_id, amount, entry_type, reference_type, reference_id, lot_id, idempotency_key)
    values
      (org, -quota, kind, ref_type, ref_id, l.id,
       case when idem is null then null else idem || ':' || l.id end);

    if quota = l.rimasto then
      update credit_lots set closed_at = now() where id = l.id;
    end if;
    mancano := mancano - quota;
  end loop;

  -- `get_credit_balance` diceva che bastavano: se siamo qui i lotti non
  -- tornano col registro, ed è meglio saperlo subito che scoprirlo dal saldo.
  if mancano > 0 then
    raise exception 'lotti e registro non concordano per %: mancano % crediti su %', org, mancano, amt;
  end if;

  return true;
end;
$$;

/**
 * Le unità ancora prenotate per un riferimento, lotto per lotto, nell'ordine in
 * cui vanno consumate o restituite.
 *
 * Il conto è `−(prenotazioni + restituzioni)`: una prenotazione vale −1 sul
 * registro e quindi +1 di prenotato, una restituzione +1 e quindi −1. Le righe
 * di consumo non entrano: `consume_reserved_credit` scrive già la restituzione
 * che le fa da coppia, e contarle due volte azzererebbe tutto.
 */
create or replace function reserved_units(org uuid, ref_type text, ref_id uuid)
returns table (lot uuid, units int)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select cl.lot_id, (-sum(cl.amount))::int
  from credit_ledger cl
  join credit_lots lo on lo.id = cl.lot_id
  where cl.organization_id = org
    and cl.reference_type = ref_type
    and cl.reference_id = ref_id
    and cl.entry_type in ('reservation', 'release')
  group by cl.lot_id, lo.source, lo.expires_at, lo.created_at
  having -sum(cl.amount) > 0
  order by (lo.source = 'subscription') desc, lo.expires_at asc nulls last, lo.created_at asc;
$$;

create or replace function reserve_credits(org uuid, amt int, ref_type text, ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Serializza le riserve della stessa organizzazione: due batch avviati
  -- insieme non possono prenotare lo stesso credito.
  perform pg_advisory_xact_lock(hashtext(org::text));
  perform expire_credit_lots(org);
  return draw_from_lots(org, amt, 'reservation', ref_type, ref_id, null);
end;
$$;

create or replace function consume_reserved_credit(org uuid, ref_type text, ref_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  scelto uuid;
begin
  select r.lot into scelto from reserved_units(org, ref_type, ref_id) r limit 1;

  if scelto is null then
    -- Nessuna prenotazione aperta per questo riferimento: il consumo c'è stato
    -- lo stesso, quindi lo si addebita al lotto di turno invece di perderlo.
    perform draw_from_lots(org, 1, 'consumption', ref_type, ref_id, null);
    return;
  end if;

  -- Restituzione +1 e consumo −1 sullo stesso lotto: il saldo non si muove
  -- (era già sceso alla prenotazione), ma il consumo resta scritto.
  insert into credit_ledger
    (organization_id, amount, entry_type, reference_type, reference_id, lot_id)
  values
    (org,  1, 'release',     ref_type, ref_id, scelto),
    (org, -1, 'consumption', ref_type, ref_id, scelto);
end;
$$;

/**
 * Restituisce `amt` unità prenotate ai lotti da cui erano uscite.
 *
 * Se le prenotazioni aperte non bastano a coprire la restituzione — non
 * dovrebbe succedere, ma il rimborso di un lavoro fallito non può dipendere da
 * un «non dovrebbe» — il resto finisce in un lotto di rettifica senza scadenza.
 * Meglio un lotto in più che un credito pagato e sparito.
 */
create or replace function release_credits(org uuid, amt int, ref_type text, ref_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  quota int;
  mancano int := amt;
  rettifica uuid;
begin
  for r in select * from reserved_units(org, ref_type, ref_id) loop
    exit when mancano = 0;
    quota := least(r.units, mancano);

    insert into credit_ledger
      (organization_id, amount, entry_type, reference_type, reference_id, lot_id)
    values (org, quota, 'release', ref_type, ref_id, r.lot);

    -- Un lotto chiuso perché esaurito torna disponibile se non è scaduto.
    update credit_lots set closed_at = null
    where id = r.lot and (expires_at is null or expires_at > now());

    mancano := mancano - quota;
  end loop;

  if mancano > 0 then
    insert into credit_lots (organization_id, source, granted, expires_at, reference_type, reference_id, metadata_json)
    values (org, 'manual', mancano, null, ref_type, ref_id,
            jsonb_build_object('motivo', 'restituzione senza prenotazione aperta'))
    returning id into rettifica;

    insert into credit_ledger
      (organization_id, amount, entry_type, reference_type, reference_id, lot_id, metadata_json)
    values (org, mancano, 'release', ref_type, ref_id, rettifica,
            jsonb_build_object('motivo', 'restituzione senza prenotazione aperta'));
  end if;

  -- Se la restituzione ha riaperto un lotto già scaduto, si richiude subito:
  -- il credito è tornato, ma la sua data era passata comunque.
  perform expire_credit_lots(org);
end;
$$;

-- =====================================================================
-- Le concessioni
-- =====================================================================

-- Quanto vale un pacchetto: dodici mesi. Sta scritto qui e nel listino, e nella
-- pagina dei prezzi deve dire la stessa cosa.
--
-- La firma è quella della migrazione `…000025`, importo e valuta compresi: il
-- webhook passa sei argomenti, e ricreare qui la vecchia versione a quattro
-- lascerebbe due funzioni con lo stesso nome e una chiamata ambigua.
create or replace function apply_credit_purchase(
  org uuid,
  amt int,
  stripe_event uuid,
  price_key text,
  amount_cents int default null,
  currency text default 'EUR'
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  nuovo uuid;
begin
  -- Idempotenza: la stessa consegna dell'evento Stripe non accredita due volte.
  if exists (
    select 1 from credit_ledger
    where organization_id = org and entry_type = 'purchase' and reference_id = stripe_event
  ) then
    return;
  end if;

  insert into credit_lots (organization_id, source, granted, expires_at, reference_type, reference_id, metadata_json)
  values (org, 'pack', amt, now() + interval '12 months', 'stripe_event', stripe_event,
          jsonb_build_object('price_key', price_key))
  returning id into nuovo;

  insert into credit_ledger
    (organization_id, amount, entry_type, reference_type, reference_id, lot_id, idempotency_key, metadata_json)
  values (org, amt, 'purchase', 'stripe_event', stripe_event, nuovo, 'purchase:' || stripe_event,
          jsonb_build_object('price_key', price_key, 'amount_cents', amount_cents, 'currency', currency));
end;
$$;

/**
 * I crediti mensili dell'abbonamento. Scadono a fine ciclo: è il loro punto,
 * non un dettaglio — sono compresi nel canone, non comprati.
 *
 * Idempotente sull'evento Stripe: `invoice.paid` arriva più di una volta, e
 * accreditare due volte 150 crediti è un regalo che poi va tolto a mano.
 */
create or replace function grant_subscription_credits(
  org uuid,
  amt int,
  stripe_event uuid,
  period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  nuovo uuid;
begin
  if exists (
    select 1 from credit_ledger
    where organization_id = org and entry_type = 'subscription_grant' and reference_id = stripe_event
  ) then
    return;
  end if;

  insert into credit_lots (organization_id, source, granted, expires_at, reference_type, reference_id)
  values (org, 'subscription', amt, period_end, 'stripe_event', stripe_event)
  returning id into nuovo;

  insert into credit_ledger
    (organization_id, amount, entry_type, reference_type, reference_id, lot_id, idempotency_key)
  values (org, amt, 'subscription_grant', 'stripe_event', stripe_event, nuovo,
          'subscription:' || stripe_event);
end;
$$;

-- I crediti di benvenuto sono una prova, e una prova ha una fine: trenta
-- giorni. Chi non prova entro un mese non prova più, e tenerli in bilancio per
-- sempre significa promettere un valore che nessuno userà.
create or replace function grant_welcome_credits(org uuid, amt int)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  nuovo uuid;
begin
  if exists (
    select 1 from credit_ledger where organization_id = org and entry_type = 'welcome'
  ) then
    return;
  end if;

  insert into credit_lots (organization_id, source, granted, expires_at, reference_type)
  values (org, 'trial', amt, now() + interval '30 days', 'signup')
  returning id into nuovo;

  insert into credit_ledger
    (organization_id, amount, entry_type, reference_type, lot_id, metadata_json)
  values (org, amt, 'welcome', 'signup', nuovo, jsonb_build_object('granted_at', now()));
end;
$$;

-- La pagina dei prezzi promette dieci schede gratis. Erano tre.
create or replace function create_organization_for_user(
  user_id uuid,
  org_name text,
  org_slug text,
  welcome_amt int default 10
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

grant execute on function get_credit_balance(uuid) to authenticated, service_role;
grant execute on function expire_credit_lots(uuid) to service_role;
grant execute on function draw_from_lots(uuid, int, credit_entry_type, text, uuid, text) to service_role;
grant execute on function reserved_units(uuid, text, uuid) to service_role;
grant execute on function grant_subscription_credits(uuid, int, uuid, timestamptz) to service_role;
