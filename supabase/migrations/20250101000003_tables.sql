-- Schema tabellare completo del dominio applicativo.
-- Convenzioni:
--   * chiavi primarie uuid con default gen_random_uuid()
--   * created_at / updated_at come timestamptz not null default now()
--   * colonne *_json come jsonb
--   * FK dei figli "tenant-owned" con on delete cascade
--   * riferimenti utente verso auth.users(id)

-- =====================================================================
-- Organizzazioni e membership
-- =====================================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists organization_members_user_id_idx on organization_members(user_id);
create index if not exists organization_members_org_id_idx on organization_members(organization_id);

-- =====================================================================
-- Preset (schemi di categoria) e loro versioni
-- =====================================================================

create table if not exists presets (
  id uuid primary key default gen_random_uuid(),
  owner_organization_id uuid references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  category text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists presets_owner_org_idx on presets(owner_organization_id);

create table if not exists preset_versions (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references presets(id) on delete cascade,
  version int not null,
  fact_schema_json jsonb not null,
  content_schema_json jsonb not null,
  validation_rules_json jsonb not null,
  inference_policy_json jsonb not null,
  header_synonyms_json jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (preset_id, version)
);

-- =====================================================================
-- Brand profile (tono di voce) e versioni
-- =====================================================================

create table if not exists brand_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_profiles_org_idx on brand_profiles(organization_id);

create table if not exists brand_profile_versions (
  id uuid primary key default gen_random_uuid(),
  brand_profile_id uuid not null references brand_profiles(id) on delete cascade,
  version int not null,
  profile_json jsonb not null,
  source_type text not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (brand_profile_id, version)
);

-- FK differita dell'active_version_id (definita dopo la tabella delle versioni)
do $$ begin
  alter table brand_profiles
    add constraint brand_profiles_active_version_fk
    foreign key (active_version_id) references brand_profile_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists brand_examples (
  id uuid primary key default gen_random_uuid(),
  brand_profile_version_id uuid not null references brand_profile_versions(id) on delete cascade,
  original_text text not null,
  source_url text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Batch (lotti di lavorazione)
-- =====================================================================

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  preset_version_id uuid not null references preset_versions(id),
  brand_profile_version_id uuid references brand_profile_versions(id) on delete set null,
  name text not null,
  status batch_status not null default 'draft',
  source_type text,
  total_products int not null default 0,
  valid_products int not null default 0,
  invalid_products int not null default 0,
  processed_products int not null default 0,
  failed_products int not null default 0,
  credits_reserved int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists batches_org_idx on batches(organization_id);
create index if not exists batches_status_idx on batches(status);

-- =====================================================================
-- File sorgente (CSV/XLSX/immagini) e import
-- =====================================================================

create table if not exists source_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid references batches(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  status source_file_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists source_files_org_idx on source_files(organization_id);
create index if not exists source_files_batch_idx on source_files(batch_id);

create table if not exists import_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  preset_version_id uuid not null references preset_versions(id),
  name text not null,
  mapping_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_mappings_org_idx on import_mappings(organization_id);

create table if not exists batch_imports (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  source_file_id uuid not null references source_files(id) on delete cascade,
  import_mapping_id uuid references import_mappings(id) on delete set null,
  detected_headers_json jsonb not null,
  confirmed_mapping_json jsonb not null,
  parse_summary_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists batch_imports_batch_idx on batch_imports(batch_id);

-- =====================================================================
-- Prodotti, varianti, asset
-- =====================================================================

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  external_id text,
  parent_external_id text,
  name text,
  product_type text,
  category text,
  raw_input_json jsonb not null,
  canonical_attributes_json jsonb not null,
  input_hash text,
  data_quality_score int not null default 0,
  verification_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_org_idx on products(organization_id);
create index if not exists products_batch_idx on products(batch_id);
create index if not exists products_external_id_idx on products(batch_id, external_id);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  external_id text,
  sku text,
  color text,
  size text,
  variant_attributes_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_variants_product_idx on product_variants(product_id);

create table if not exists product_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  source_file_id uuid not null references source_files(id) on delete cascade,
  asset_type text not null,
  sort_order int not null default 0,
  match_method asset_match_method not null,
  created_at timestamptz not null default now()
);

create index if not exists product_assets_org_idx on product_assets(organization_id);
create index if not exists product_assets_product_idx on product_assets(product_id);

-- =====================================================================
-- Evidenze degli attributi (provenienza dei fatti)
-- =====================================================================

create table if not exists attribute_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  field_key text not null,
  value_json jsonb,
  source_type evidence_source_type not null,
  source_file_id uuid references source_files(id) on delete set null,
  source_locator text,
  evidence_text text,
  confidence numeric,
  status attribute_status not null default 'provided',
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists attribute_evidence_org_idx on attribute_evidence(organization_id);
create index if not exists attribute_evidence_product_idx on attribute_evidence(product_id);

-- =====================================================================
-- Run di generazione e output per prodotto
-- =====================================================================

create table if not exists generation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  run_type run_type not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status generation_run_status not null default 'pending',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated_cost numeric not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists generation_runs_org_idx on generation_runs(organization_id);
create index if not exists generation_runs_batch_idx on generation_runs(batch_id);

create table if not exists product_generations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  generation_run_id uuid not null references generation_runs(id) on delete cascade,
  input_hash text not null,
  generated_content_json jsonb not null,
  edited_content_json jsonb,
  audit_json jsonb,
  status product_generation_status not null default 'generated',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_generations_org_idx on product_generations(organization_id);
create index if not exists product_generations_product_idx on product_generations(product_id);
create index if not exists product_generations_run_idx on product_generations(generation_run_id);

-- =====================================================================
-- Job items (coda di lavorazione per prodotto)
-- =====================================================================

create table if not exists job_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  status job_item_status not null default 'pending',
  attempts int not null default 0,
  last_error_code text,
  last_error_message text,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_items_org_idx on job_items(organization_id);
create index if not exists job_items_batch_idx on job_items(batch_id);

-- Un prodotto non puo' avere due job_item "attivi" contemporaneamente.
create unique index if not exists job_items_active_product_uidx
  on job_items(product_id)
  where status in ('pending', 'queued', 'processing');

-- =====================================================================
-- Export
-- =====================================================================

create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  format export_format not null,
  mapping_json jsonb not null,
  storage_bucket text not null,
  storage_path text not null,
  row_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists exports_org_idx on exports(organization_id);
create index if not exists exports_batch_idx on exports(batch_id);

-- =====================================================================
-- Billing e crediti
-- =====================================================================

create table if not exists billing_products (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  stripe_price_id text,
  credits int not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  amount int not null,
  entry_type credit_entry_type not null,
  reference_type text,
  reference_id uuid,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_org_idx on credit_ledger(organization_id);
create index if not exists credit_ledger_reference_idx on credit_ledger(reference_type, reference_id);

create table if not exists stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  event_type text not null,
  processed_at timestamptz,
  payload_hash text,
  status stripe_event_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Eventi applicativi (analytics/audit leggero)
-- =====================================================================

create table if not exists app_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  user_id uuid,
  event_name text not null,
  batch_id uuid,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists app_events_org_idx on app_events(organization_id);
create index if not exists app_events_name_idx on app_events(event_name);
