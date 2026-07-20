-- Traduzioni multilingua dell'output generato: mappa lingua -> copy tradotta.
alter table product_generations
  add column if not exists translations_json jsonb not null default '{}'::jsonb;
