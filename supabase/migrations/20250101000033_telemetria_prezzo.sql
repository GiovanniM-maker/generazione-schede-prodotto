-- ---------------------------------------------------------------------------
-- Le quattro cifre che dicono se il prezzo regge.
--
-- Fissare 99 €/mese senza queste è tirare a indovinare in vetrina. Tre delle
-- quattro sono già nel database da mesi — `generation_runs` registra costo
-- stimato e token da sempre — e nessuno le aveva mai guardate.
--
--   1. QUANTO COSTA UNA SCHEDA          telemetry_cost_per_card
--      Costo dei modelli diviso schede prodotte, al mese. È il pavimento sotto
--      cui il prezzo non può andare. Con 150 crediti a 99 € il margine lordo è
--      99 − 150 × (questa cifra).
--
--   2. QUANTE VOLTE SI RIGENERA          telemetry_regenerations_per_card
--      Una scheda rigenerata quattro volte costa quattro volte e si fattura una
--      volta: la media qui moltiplica la cifra 1. Se sale, il prezzo non tiene —
--      ma prima ancora vuol dire che il prodotto sbaglia le schede.
--
--   3. QUANTE RICHIESTE ALL'ASSISTENTE   telemetry_assistant_per_card
--      La dotazione è `max(100, 5 × schede)`. Questa vista dice se cinque per
--      scheda sono generosi o stretti, e quante organizzazioni vanno oltre.
--      Se quasi nessuno supera la dotazione, la regola del credito ogni cinque
--      richieste non serve e va tolta invece di restare a fare rumore.
--
--   4. QUANTI RICOMPRANO A 90 GIORNI     telemetry_repurchase_90d
--      Chi ricompra dice che il prodotto vale il prezzo. Chi compra una volta
--      sola l'ha provato. Questa cifra decide se ha senso spingere il pacchetto
--      o l'abbonamento.
--
-- Le viste non sono leggibili dall'applicazione: `revoke` esplicito su `anon` e
-- `authenticated`, perché sono aggregati di **tutte** le organizzazioni e i
-- privilegi predefiniti dello schema le darebbero in lettura a chiunque abbia
-- un account. Si guardano da `service_role`, cioè dal pannello di servizio o
-- dall'editor SQL.
-- ---------------------------------------------------------------------------

-- 1 -------------------------------------------------------------------------
drop view if exists telemetry_cost_per_card;
create view telemetry_cost_per_card as
with costi as (
  select date_trunc('month', created_at) as mese,
         sum(estimated_cost) as costo,
         sum(input_tokens) as token_ingresso,
         sum(output_tokens) as token_uscita,
         count(*) as esecuzioni,
         count(*) filter (where status = 'failed') as esecuzioni_fallite
  from generation_runs
  group by 1
),
schede as (
  select date_trunc('month', created_at) as mese,
         count(distinct product_id) as schede
  from product_generations
  group by 1
)
select
  coalesce(c.mese, s.mese) as mese,
  coalesce(s.schede, 0) as schede,
  coalesce(c.esecuzioni, 0) as esecuzioni,
  coalesce(c.esecuzioni_fallite, 0) as esecuzioni_fallite,
  coalesce(c.costo, 0) as costo_stimato,
  round(coalesce(c.costo, 0) / nullif(s.schede, 0), 4) as costo_per_scheda,
  coalesce(c.token_ingresso, 0) as token_ingresso,
  coalesce(c.token_uscita, 0) as token_uscita
from costi c
full outer join schede s on s.mese = c.mese
order by 1 desc;

comment on view telemetry_cost_per_card is
  'Cifra 1: costo dei modelli per scheda prodotta, al mese. Il pavimento del prezzo.';

-- 2 -------------------------------------------------------------------------
drop view if exists telemetry_regenerations_per_card;
create view telemetry_regenerations_per_card as
with per_scheda as (
  select product_id,
         date_trunc('month', min(created_at)) as mese,
         count(*) as generazioni
  from product_generations
  group by 1
)
select
  mese,
  count(*) as schede,
  round(avg(generazioni), 2) as generazioni_medie,
  percentile_cont(0.5) within group (order by generazioni) as mediana,
  percentile_cont(0.9) within group (order by generazioni) as nona_decima,
  max(generazioni) as massimo,
  count(*) filter (where generazioni = 1) as al_primo_colpo,
  round(
    100.0 * count(*) filter (where generazioni = 1) / nullif(count(*), 0), 1
  ) as percento_al_primo_colpo
from per_scheda
group by 1
order by 1 desc;

comment on view telemetry_regenerations_per_card is
  'Cifra 2: quante generazioni servono per scheda. Moltiplica il costo della cifra 1.';

-- 3 -------------------------------------------------------------------------
-- Una «richiesta all'assistente» è un messaggio scritto da una persona in una
-- conversazione di configurazione, più ogni correzione di output con un perché:
-- sono i due punti in cui il cliente chiede all'AI di rifare qualcosa.
drop view if exists telemetry_assistant_per_card;
create view telemetry_assistant_per_card as
with messaggi as (
  select date_trunc('month', m.created_at) as mese,
         c.organization_id,
         count(*) as n
  from configuration_messages m
  join configuration_conversations c on c.id = m.conversation_id
  where m.role = 'user'
  group by 1, 2
),
correzioni as (
  select date_trunc('month', created_at) as mese, organization_id, count(*) as n
  from output_corrections
  group by 1, 2
),
schede as (
  select date_trunc('month', created_at) as mese,
         organization_id,
         count(distinct product_id) as n
  from product_generations
  group by 1, 2
),
unione as (
  select mese, organization_id from messaggi
  union select mese, organization_id from correzioni
  union select mese, organization_id from schede
)
select
  u.mese,
  u.organization_id,
  coalesce(m.n, 0) + coalesce(k.n, 0) as richieste,
  coalesce(s.n, 0) as schede,
  greatest(100, 5 * coalesce(s.n, 0)) as dotazione,
  round((coalesce(m.n, 0) + coalesce(k.n, 0))::numeric / nullif(s.n, 0), 2) as richieste_per_scheda,
  (coalesce(m.n, 0) + coalesce(k.n, 0)) > greatest(100, 5 * coalesce(s.n, 0)) as oltre_la_dotazione
from unione u
left join messaggi m on m.mese = u.mese and m.organization_id = u.organization_id
left join correzioni k on k.mese = u.mese and k.organization_id = u.organization_id
left join schede s on s.mese = u.mese and s.organization_id = u.organization_id
order by 1 desc, 3 desc;

comment on view telemetry_assistant_per_card is
  'Cifra 3: richieste all''assistente per scheda, organizzazione per organizzazione, con la dotazione a confronto.';

-- 4 -------------------------------------------------------------------------
drop view if exists telemetry_repurchase_90d;
create view telemetry_repurchase_90d as
with acquisti as (
  select organization_id, created_at
  from credit_ledger
  where entry_type in ('purchase', 'subscription_grant')
),
primo as (
  select organization_id, min(created_at) as primo_acquisto
  from acquisti
  group by 1
),
maturi as (
  select p.organization_id, p.primo_acquisto,
         exists (
           select 1 from acquisti a
           where a.organization_id = p.organization_id
             and a.created_at > p.primo_acquisto
             and a.created_at <= p.primo_acquisto + interval '90 days'
         ) as ha_ricomprato
  from primo p
  where p.primo_acquisto <= now() - interval '90 days'
)
select
  date_trunc('month', primo_acquisto) as coorte,
  count(*) as organizzazioni,
  count(*) filter (where ha_ricomprato) as hanno_ricomprato,
  round(100.0 * count(*) filter (where ha_ricomprato) / nullif(count(*), 0), 1) as percento
from maturi
group by 1
order by 1 desc;

comment on view telemetry_repurchase_90d is
  'Cifra 4: quota di chi ricompra entro novanta giorni dal primo acquisto, per coorte mensile.';

-- Aggregati di tutte le organizzazioni: non li vede chi ha un account.
revoke all on telemetry_cost_per_card from anon, authenticated;
revoke all on telemetry_regenerations_per_card from anon, authenticated;
revoke all on telemetry_assistant_per_card from anon, authenticated;
revoke all on telemetry_repurchase_90d from anon, authenticated;

grant select on telemetry_cost_per_card to service_role;
grant select on telemetry_regenerations_per_card to service_role;
grant select on telemetry_assistant_per_card to service_role;
grant select on telemetry_repurchase_90d to service_role;
