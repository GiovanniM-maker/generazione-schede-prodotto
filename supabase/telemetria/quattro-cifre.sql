-- =====================================================================
-- Le quattro cifre, in un colpo solo.
-- =====================================================================
-- Come eseguirlo:
--   psql "$DATABASE_URL" -f supabase/telemetria/quattro-cifre.sql
--
-- Oppure, dall'editor SQL di Supabase, una `select` per volta dalle viste.
-- Sono aggregati di tutte le organizzazioni: non li vede chi ha un account,
-- solo `service_role`.
--
-- Le definizioni stanno in `supabase/migrations/20250101000033_telemetria_prezzo.sql`,
-- col perché di ognuna. Qui c'è solo il modo di guardarle tutte insieme.
--
-- COSA GUARDARE
--
--   1 · costo per scheda × 150 dice quanto costa un mese di abbonamento a
--       pieno uso. Se supera i 30 € circa, 99 € non regge come sembra.
--   2 · generazioni medie moltiplica la cifra 1. Sopra 1,5 il problema non è
--       il prezzo: è che il prodotto sbaglia le schede.
--   3 · se quasi nessuno supera la dotazione dell'assistente, la regola del
--       credito ogni cinque richieste non serve e va tolta.
--   4 · sotto il 20% di riacquisto a novanta giorni, l'abbonamento è una
--       promessa che i numeri non confermano.
-- =====================================================================

\echo ''
\echo '=== 1. Quanto costa una scheda ======================================'
select * from telemetry_cost_per_card limit 12;

\echo ''
\echo '=== 2. Quante volte si rigenera ====================================='
select * from telemetry_regenerations_per_card limit 12;

\echo ''
\echo '=== 3. Assistente: richieste per scheda (ultimi tre mesi) ============'
select *
from telemetry_assistant_per_card
where mese >= date_trunc('month', now()) - interval '2 months'
limit 40;

\echo ''
\echo '=== 3b. Quante organizzazioni superano la dotazione =================='
select mese,
       count(*) as organizzazioni,
       count(*) filter (where oltre_la_dotazione) as oltre,
       round(100.0 * count(*) filter (where oltre_la_dotazione) / nullif(count(*), 0), 1) as percento
from telemetry_assistant_per_card
group by 1
order by 1 desc
limit 12;

\echo ''
\echo '=== 4. Chi ricompra entro novanta giorni ============================='
select * from telemetry_repurchase_90d;
