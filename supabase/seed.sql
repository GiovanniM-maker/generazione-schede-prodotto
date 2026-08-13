-- Seed dati di sistema.
-- Idempotente: usa on conflict do nothing / id fissi.

-- =====================================================================
-- Il preset di sistema "Moda" NON sta piu' qui.
--
-- Questo file inseriva `presets (owner_organization_id, key, category,
-- is_system)` e la sua `preset_versions`. Sono le colonne del PRIMO modello:
-- la migrazione `20250101000010_config_model.sql` fa `drop table ... cascade`
-- su entrambe le tabelle e le ricrea con un altro schema
-- (`organization_id`, `sector_id`, versioni con `published_at`).
--
-- Da allora questo seed era rotto: su un database nuovo si fermava con
-- «column "owner_organization_id" of relation "presets" does not exist», e
-- quindi NON arrivava nemmeno alle righe sotto — i pacchetti crediti e la coda.
-- In pratica, da questo repository non si poteva tirare su un database locale
-- funzionante. Non se n'era accorto nessuno perche' tutto girava contro il
-- Supabase ospitato, gia' migrato a mano.
--
-- L'ha trovato la prima esecuzione della suite del browser in CI, che e'
-- esattamente quello che doveva fare.
--
-- Il catalogo di configurazione sta ora in `seed_config.sql` (moda) e
-- `seed_config_food_pharma.sql` (food, pharma), applicati dopo questo file
-- secondo l'ordine dichiarato in `config.toml`.
-- =====================================================================

-- =====================================================================
-- Pacchetti crediti (billing_products)
-- stripe_price_id resta null: valorizzato in deploy reale da variabili d'ambiente.
--
-- I PREZZI SONO SEGNAPOSTO. Vanno decisi prima di vendere. Stanno qui e non
-- nel codice perche' cambiarli non deve richiedere un rilascio — e perche' un
-- pacchetto senza prezzo non e' acquistabile: meglio che non compaia, piuttosto
-- che comparire senza dire quanto costa.
-- =====================================================================

insert into billing_products (key, name, credits, price_cents, currency, stripe_price_id, active)
values
  ('pack_50', 'Pacchetto 50 crediti', 50, 2900, 'EUR', null, true),
  ('pack_200', 'Pacchetto 200 crediti', 200, 9900, 'EUR', null, true),
  ('pack_500', 'Pacchetto 500 crediti', 500, 19900, 'EUR', null, true)
on conflict (key) do nothing;

-- =====================================================================
-- Coda PGMQ per i job di generazione
-- =====================================================================

do $$
begin
  perform pgmq.create('generation_jobs');
exception
  when others then
    -- La coda esiste gia' oppure pgmq gestisce internamente il caso: ignora.
    raise notice 'pgmq.create(generation_jobs): %', sqlerrm;
end $$;
