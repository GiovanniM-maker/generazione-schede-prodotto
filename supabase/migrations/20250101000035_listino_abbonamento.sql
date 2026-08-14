-- ---------------------------------------------------------------------------
-- L'abbonamento entra nel listino.
--
-- `billing_products` conteneva tre righe, tutte pacchetti, e niente che
-- distinguesse un acquisto da un canone. Aggiungere l'abbonamento come quarta
-- riga senza dirlo avrebbe avuto due conseguenze silenziose:
--
--   · la pagina della fatturazione lo avrebbe disegnato come un quarto
--     pacchetto, con lo stesso pulsante «Acquista»;
--   · il wizard, che davanti a un ammanco suggerisce «il pacchetto più piccolo
--     che basta», avrebbe potuto suggerire **un abbonamento** a chi voleva solo
--     finire un batch — cioè vendere un canone a chi ha chiesto un caffè.
--
-- Quindi la riga porta scritto cosa è. `kind` vale 'pack' o 'subscription', e
-- il valore predefinito è 'pack' perché è quello che sono le tre righe
-- esistenti.
--
-- Il prezzo è un segnaposto come gli altri: sta nel database e non nel codice,
-- così si cambia senza un rilascio. `stripe_price_id` resta vuoto finché non
-- viene creato il prezzo ricorrente su Stripe — e finché è vuoto il prodotto
-- non lo offre, invece di mandare la gente su un checkout che fallisce.
-- ---------------------------------------------------------------------------

do $$ begin
  create type billing_product_kind as enum ('pack', 'subscription');
exception when duplicate_object then null; end $$;

alter table billing_products
  add column if not exists kind billing_product_kind not null default 'pack';

comment on column billing_products.kind is
  'pack = si compra una volta e vale dodici mesi. subscription = canone mensile, i crediti scadono a fine ciclo.';

-- 99 €/mese, 150 crediti al mese che scadono a fine ciclo.
--
-- `active = false`: la riga esiste ma non si vende finché non c'è il prezzo
-- ricorrente su Stripe. Offrire un abbonamento che al primo clic sbatte contro
-- «prezzo non configurato» è peggio che non offrirlo.
insert into billing_products (key, name, credits, price_cents, currency, kind, active)
values ('subscription', 'Abbonamento mensile', 150, 9900, 'EUR', 'subscription', false)
on conflict (key) do nothing;
