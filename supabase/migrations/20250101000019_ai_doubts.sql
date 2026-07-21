-- Inbox dei "dubbi" dell'AI: quando un dato è stato letto con bassa confidenza,
-- l'AI chiede conferma all'utente. Accesso solo via service client (server),
-- con controllo esplicito dell'organizzazione: RLS abilitata senza policy.
create table if not exists ai_doubts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid references batches(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  attribute_id uuid references attributes(id) on delete set null,
  field_key text not null,
  field_label text,
  question text not null,
  suggested_value text,
  confidence numeric,
  -- open | answered | dismissed
  status text not null default 'open',
  answer text,
  answered_at timestamptz,
  answered_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists ai_doubts_org_status_idx on ai_doubts (organization_id, status);
create unique index if not exists ai_doubts_unique_open
  on ai_doubts (product_id, field_key)
  where status = 'open';

alter table ai_doubts enable row level security;

-- Flag per generare i dubbi una sola volta a fine batch.
alter table batches add column if not exists doubts_generated_at timestamptz;
