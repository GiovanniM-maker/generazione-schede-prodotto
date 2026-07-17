-- Estensioni richieste dalla piattaforma.
-- pgcrypto: fornisce gen_random_uuid() per le chiavi primarie.
-- pgmq: code di messaggi per l'orchestrazione dei job di generazione.

create extension if not exists pgcrypto;

-- pgmq viene installato nello schema dedicato "pgmq".
create extension if not exists pgmq;
