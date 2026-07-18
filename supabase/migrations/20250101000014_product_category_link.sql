-- =====================================================================
-- Collegamento prodotto -> categoria merceologica (entità).
--
-- Finora products.category era solo testo libero (dalla colonna mappata).
-- Aggiungiamo un FK opzionale alla categoria reale, così l'import può
-- "mappare" i prodotti alle categorie dell'organizzazione (per nome) e la
-- configurazione per-categoria del preset diventa utilizzabile per-prodotto.
-- =====================================================================

alter table products
  add column if not exists category_id uuid references categories(id) on delete set null;

create index if not exists products_category_id_idx on products(category_id);
