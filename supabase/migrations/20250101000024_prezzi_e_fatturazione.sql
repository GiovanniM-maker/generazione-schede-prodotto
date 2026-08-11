-- ---------------------------------------------------------------------------
-- Il prezzo, e i dati per fatturarlo.
--
-- Il prodotto non aveva un prezzo da nessuna parte: non sulla landing (che
-- elencava «50 / 200 / 500 crediti»), non nella pagina crediti, e nemmeno in
-- `billing_products`. La cifra esisteva solo dentro Stripe, e si scopriva dopo
-- essere stati rimbalzati su checkout.stripe.com. Per un SaaS è il difetto più
-- grave possibile: non si compra una cosa di cui non si sa il costo.
--
-- E senza partita IVA e codice destinatario nessun cliente B2B italiano può
-- comprare: la fattura elettronica non è un optional, è come funziona la
-- fatturazione in Italia.
-- ---------------------------------------------------------------------------

-- Prezzo del pacchetto, in centesimi: gli euro in virgola mobile prima o poi
-- fanno sparire un centesimo.
alter table billing_products
  add column if not exists price_cents integer,
  add column if not exists currency text not null default 'EUR';

comment on column billing_products.price_cents is
  'Prezzo IVA esclusa, in centesimi. NULL = pacchetto senza prezzo, non acquistabile.';

-- Dati di fatturazione dell'organizzazione.
--
-- Separati dal nome dell'organizzazione: «Cascina Verde» è come si chiamano,
-- «Cascina Verde S.r.l.» è chi emette la fattura, e i due non coincidono quasi
-- mai.
alter table organizations
  add column if not exists billing_name text,
  add column if not exists vat_number text,
  add column if not exists tax_code text,
  add column if not exists sdi_code text,
  add column if not exists pec_email text,
  add column if not exists billing_address text,
  add column if not exists billing_zip text,
  add column if not exists billing_city text,
  add column if not exists billing_province text,
  add column if not exists billing_country text not null default 'IT';

comment on column organizations.vat_number is 'Partita IVA, senza prefisso paese.';
comment on column organizations.tax_code is 'Codice fiscale: per i privati sostituisce la partita IVA.';
comment on column organizations.sdi_code is
  'Codice destinatario SDI (7 caratteri). In alternativa vale la PEC.';

-- I prezzi di partenza sono SEGNAPOSTO: vanno decisi prima di vendere.
-- Restano espliciti nel database invece che nascosti nel codice, così si
-- cambiano senza un rilascio.
update billing_products set price_cents = 2900  where key = 'pack_50'  and price_cents is null;
update billing_products set price_cents = 9900  where key = 'pack_200' and price_cents is null;
update billing_products set price_cents = 19900 where key = 'pack_500' and price_cents is null;
