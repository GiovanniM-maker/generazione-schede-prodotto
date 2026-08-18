-- Le varianti smettono di essere una tabella vuota.
--
-- `product_variants` esiste dalla prima migrazione e fino a oggi non ci ha mai
-- scritto nessuno: ogni riga del file diventava un prodotto. Adesso l'import ci
-- scrive davvero, e una tabella che riceve dati vuole i vincoli che una tabella
-- decorativa non aveva bisogno di avere.

-- Uno SKU non può comparire due volte sotto lo stesso prodotto. Senza questo,
-- reimportare lo stesso file raddoppierebbe le varianti in silenzio, e l'export
-- consegnerebbe al cliente due righe identiche per lo stesso codice — che
-- l'importer di Shopify rifiuta a metà caricamento.
create unique index if not exists product_variants_product_sku_uidx
  on product_variants(product_id, sku)
  where sku is not null;

-- Si cerca per SKU: è la chiave con cui il cliente parla del suo catalogo.
create index if not exists product_variants_sku_idx on product_variants(sku);

comment on table product_variants is
  'La singola combinazione acquistabile (colore, taglia, finitura) appesa al prodotto. '
  'Il testo della scheda è del PRODOTTO e si genera una volta sola: qui stanno solo '
  'lo SKU e i fatti su cui le varianti differiscono fra loro.';
