-- Completezza della scheda generata (parziale/insufficiente/bloccata) + attributi mancanti.
alter table product_generations add column if not exists completeness_json jsonb null;
