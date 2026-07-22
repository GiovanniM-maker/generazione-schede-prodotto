-- Istruzione "come si riconosce" per categoria: aiuta l'AI a scegliere la
-- categoria giusta dalle foto (classificazione), oltre al solo nome.
alter table categories add column if not exists recognition_hint text;
