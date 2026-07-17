-- Modello dati sorgenti batch (SKU-centrico). Le sorgenti (CSV/XLSX, immagini,
-- Google Drive) producono source_items; i prodotti sono collegati via SKU esatto;
-- i valori attributo mantengono fonte, stato e provenienza.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type batch_source_type as enum ('images_upload', 'spreadsheet_upload', 'google_drive', 'pdf_future');
exception when duplicate_object then null; end $$;

do $$ begin
  create type source_item_status as enum ('valid', 'missing_sku', 'unsupported_format', 'duplicate_file', 'empty_file', 'unmatched', 'imported');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_link_type as enum ('sku_exact', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attribute_value_state as enum (
    'provided', 'extracted_from_file', 'extracted_from_image', 'inferred_visual',
    'derived', 'missing', 'not_applicable', 'needs_confirmation', 'invalid',
    'confirmed', 'rejected'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- SKU universale sui prodotti
-- ---------------------------------------------------------------------------
alter table products add column if not exists sku text;
alter table products add column if not exists preset_version_id uuid;
create index if not exists products_sku_idx on products(organization_id, sku);

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists batch_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  source_type batch_source_type not null,
  status text not null default 'pending',
  configuration_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists batch_sources_batch_idx on batch_sources(batch_id);

create table if not exists source_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_source_id uuid not null references batch_sources(id) on delete cascade,
  source_file_id uuid null references source_files(id) on delete set null,
  external_source_id text null,
  filename text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  sha256 text null,
  detected_sku text null,
  status source_item_status not null default 'valid',
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists source_items_source_idx on source_items(batch_source_id);
create index if not exists source_items_sku_idx on source_items(organization_id, detected_sku);

create table if not exists product_source_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  source_item_id uuid not null references source_items(id) on delete cascade,
  link_type product_link_type not null default 'sku_exact',
  created_at timestamptz not null default now(),
  unique(product_id, source_item_id)
);
create index if not exists product_source_links_product_idx on product_source_links(product_id);

create table if not exists product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  attribute_id uuid not null references attributes(id) on delete cascade,
  value_json jsonb null,
  status attribute_value_state not null default 'missing',
  source_type text not null default 'manual',
  source_item_id uuid null references source_items(id) on delete set null,
  source_locator text null,
  confidence numeric null,
  confirmed_by uuid null references auth.users(id),
  confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, attribute_id)
);
create index if not exists pav_product_idx on product_attribute_values(product_id);

-- Trigger updated_at
create trigger set_updated_at_batch_sources before update on batch_sources for each row execute function set_updated_at();
create trigger set_updated_at_pav before update on product_attribute_values for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table batch_sources enable row level security;
alter table source_items enable row level security;
alter table product_source_links enable row level security;
alter table product_attribute_values enable row level security;

drop policy if exists batch_sources_all on batch_sources;
create policy batch_sources_all on batch_sources for all to authenticated
  using (is_organization_member(organization_id)) with check (is_organization_member(organization_id));

drop policy if exists source_items_all on source_items;
create policy source_items_all on source_items for all to authenticated
  using (is_organization_member(organization_id)) with check (is_organization_member(organization_id));

drop policy if exists product_source_links_all on product_source_links;
create policy product_source_links_all on product_source_links for all to authenticated
  using (is_organization_member(organization_id)) with check (is_organization_member(organization_id));

drop policy if exists product_attribute_values_select on product_attribute_values;
create policy product_attribute_values_select on product_attribute_values for select to authenticated
  using (is_organization_member(organization_id));
drop policy if exists product_attribute_values_write on product_attribute_values;
create policy product_attribute_values_write on product_attribute_values for all to authenticated
  using (is_organization_member(organization_id)) with check (is_organization_member(organization_id));
