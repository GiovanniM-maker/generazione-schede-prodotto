-- La fonte «Lista SKU»: il valore di enum e il registro delle risoluzioni.
--
-- Il valore di enum sta qui da solo per la ragione di sempre: `alter type ...
-- add value` non si può usare nella stessa transazione che lo aggiunge. Il
-- resto della migrazione lo usa solo come stringa dentro una colonna di testo,
-- mai come valore del tipo, quindi convivono.

alter type batch_source_type add value if not exists 'sku_list';

-- Il registro, per riga.
--
-- Serve a tre cose che senza di esso non si possono fare, e sono tutte nella
-- specifica: dire a chi ha lanciato la lavorazione perché un codice non è stato
-- trovato; riprendere una lavorazione interrotta senza rifare le righe già
-- fatte; e non pagare due volte la stessa ricerca.
create table if not exists sku_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid references batches(id) on delete cascade,
  product_id uuid references products(id) on delete set null,

  -- La chiave della cache: il codice normalizzato più la marca. Due lavorazioni
  -- che cercano lo stesso codice della stessa marca cercano la stessa cosa.
  codice_normalizzato text not null,
  marca_normalizzata text not null default '',
  -- Il codice come l'ha scritto il cliente: è quello che deve rivedere nel
  -- registro, non la nostra versione maiuscola.
  codice_originale text not null,

  -- 'risolto' | 'risolto-con-riserva' | 'coda-conferma' | 'non-trovato' | 'errore'
  esito text not null,
  punteggio_identita numeric(4,3) not null default 0,
  url_scelto text,
  dominio_scelto text,
  livello_dominio text,
  -- I candidati valutati, com'erano al momento della decisione: è quello che la
  -- schermata di conferma mostra, e non si può ricostruire dopo perché le
  -- pagine cambiano.
  candidati_json jsonb not null default '[]',
  motivo text,

  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create index if not exists sku_resolutions_org_idx on sku_resolutions(organization_id);
create index if not exists sku_resolutions_batch_idx on sku_resolutions(batch_id);
-- La cache si legge per (organizzazione, codice, marca): l'indice è unico
-- perché due righe per la stessa chiave vorrebbero dire due risposte diverse
-- alla stessa domanda, e non si saprebbe quale vale.
create unique index if not exists sku_resolutions_cache_uidx
  on sku_resolutions(organization_id, codice_normalizzato, marca_normalizzata, batch_id);

alter table sku_resolutions enable row level security;

drop policy if exists sku_resolutions_all on sku_resolutions;
create policy sku_resolutions_all on sku_resolutions
  for all to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

comment on table sku_resolutions is
  'Il registro per riga della fonte «Lista SKU»: cosa è stato cercato, cosa si è '
  'trovato, e perché si è deciso così. È anche la cache — rilanciare la stessa '
  'lavorazione non paga due volte la stessa ricerca — e il punto da cui si '
  'riprende una lavorazione interrotta.';
