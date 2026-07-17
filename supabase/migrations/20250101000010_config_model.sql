-- =====================================================================
-- Nuovo modello relazionale di CONFIGURAZIONE del catalogo prodotti.
--
-- Multi-settore, multi-tenant. Introduce settori, categorie, attributi
-- (libreria condivisa di sistema + estensioni per organizzazione), preset
-- versionati e le conversazioni/bozze di configurazione guidata.
--
-- Convenzioni (allineate alle migrazioni esistenti):
--   * chiavi primarie uuid con default gen_random_uuid()
--   * created_at / updated_at come timestamptz not null default now()
--   * trigger set_updated_at() sulle tabelle con updated_at
--   * enum creati in blocchi idempotenti (duplicate_object -> null)
--   * RLS via is_organization_member() / is_organization_owner()
--
-- IMPORTANTE: ogni statement deve essere sicuro se eseguito in blocco via
-- Supabase Management API (create ... if not exists, on conflict, guardie).
-- =====================================================================


-- =====================================================================
-- 0. Gestione collisione con il VECCHIO modello presets / preset_versions
-- =====================================================================
-- Le vecchie tabelle presets/preset_versions (schema diverso) vengono
-- sostituite da questo redesign. Non ci sono dati reali (un batch draft,
-- zero prodotti). Sganciamo le FK che le referenziano, rendiamo nullable le
-- colonne e rimuoviamo le vecchie tabelle. Le colonne preset_version_id di
-- batches/import_mappings restano come uuid nullable "sciolti": il flusso
-- batch verra' rilavorato in seguito e non ricollega FK ai nuovi preset ora.

alter table batches drop constraint if exists batches_preset_version_id_fkey;
alter table batches alter column preset_version_id drop not null;

alter table import_mappings drop constraint if exists import_mappings_preset_version_id_fkey;
alter table import_mappings alter column preset_version_id drop not null;

drop table if exists preset_versions cascade;
drop table if exists presets cascade;


-- =====================================================================
-- 1. Enum (idempotenti)
-- =====================================================================

do $$ begin
  create type attribute_kind as enum ('factual', 'derived', 'generative');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attribute_data_type as enum (
    'text', 'long_text', 'integer', 'decimal', 'boolean', 'date',
    'enum', 'multi_enum', 'measurement', 'percentage', 'currency', 'json'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type config_entity_type as enum ('category', 'attribute', 'preset');
exception when duplicate_object then null; end $$;

do $$ begin
  create type config_draft_status as enum (
    'draft', 'awaiting_information', 'ready_for_confirmation',
    'confirmed', 'published', 'discarded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type config_conversation_status as enum ('active', 'completed', 'discarded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type catalog_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;


-- =====================================================================
-- 2. Colonna di onboarding sulle organizzazioni
-- =====================================================================

alter table organizations add column if not exists onboarding_completed_at timestamptz;


-- =====================================================================
-- 3. Tabelle (in ordine di dipendenza)
-- =====================================================================

-- --- Settori -----------------------------------------------------------
create table if not exists sectors (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  description text,
  icon text,
  is_system boolean not null default true,
  status catalog_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --- Settori abilitati per organizzazione ------------------------------
create table if not exists organization_sectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sector_id uuid not null references sectors(id) on delete cascade,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, sector_id)
);

create index if not exists organization_sectors_org_idx on organization_sectors(organization_id);
create index if not exists organization_sectors_sector_idx on organization_sectors(sector_id);

-- --- Categorie (di sistema o custom di organizzazione) -----------------
-- owner_organization_id null => categoria di sistema (immutabile lato client).
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references sectors(id) on delete cascade,
  owner_organization_id uuid references organizations(id) on delete cascade,
  parent_category_id uuid references categories(id) on delete set null,
  source_category_id uuid references categories(id) on delete set null,
  key text,
  name text not null,
  description text,
  is_system boolean not null default false,
  status catalog_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists categories_sector_idx on categories(sector_id);
create index if not exists categories_owner_org_idx on categories(owner_organization_id);
create index if not exists categories_parent_idx on categories(parent_category_id);
create index if not exists categories_source_idx on categories(source_category_id);

-- --- Categorie abilitate per organizzazione ----------------------------
create table if not exists organization_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, category_id)
);

create index if not exists organization_categories_org_idx on organization_categories(organization_id);
create index if not exists organization_categories_category_idx on organization_categories(category_id);

-- --- Attributi (libreria condivisa di sistema + estensioni org) --------
-- owner_organization_id null => attributo di sistema (immutabile lato client).
create table if not exists attributes (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references sectors(id) on delete cascade,
  owner_organization_id uuid references organizations(id) on delete cascade,
  source_attribute_id uuid references attributes(id) on delete set null,
  key text,
  name text not null,
  description text,
  attribute_kind attribute_kind not null default 'factual',
  data_type attribute_data_type not null default 'text',
  unit text,
  enum_values_json jsonb,
  default_extraction_instruction text,
  default_generation_instruction text,
  validation_rules_json jsonb not null default '{}',
  normalization_rules_json jsonb not null default '{}',
  allowed_sources_json jsonb not null default '["csv","xlsx","manual"]',
  is_system boolean not null default false,
  status catalog_status not null default 'active',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists attributes_sector_idx on attributes(sector_id);
create index if not exists attributes_owner_org_idx on attributes(owner_organization_id);
create index if not exists attributes_source_idx on attributes(source_attribute_id);

-- --- Attributi abilitati per organizzazione ----------------------------
create table if not exists organization_attributes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  attribute_id uuid not null references attributes(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, attribute_id)
);

create index if not exists organization_attributes_org_idx on organization_attributes(organization_id);
create index if not exists organization_attributes_attribute_idx on organization_attributes(attribute_id);

-- --- Legami categoria -> attributo (con override) ----------------------
create table if not exists category_attributes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  attribute_id uuid not null references attributes(id) on delete cascade,
  is_required boolean not null default false,
  display_order int not null default 0,
  extraction_instruction_override text,
  generation_instruction_override text,
  validation_rules_override_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, attribute_id)
);

create index if not exists category_attributes_category_idx on category_attributes(category_id);
create index if not exists category_attributes_attribute_idx on category_attributes(attribute_id);

-- --- Preset (sempre di proprieta' di un'organizzazione) -----------------
create table if not exists presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sector_id uuid not null references sectors(id) on delete cascade,
  name text not null,
  description text,
  status catalog_status not null default 'active',
  active_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists presets_org_idx on presets(organization_id);
create index if not exists presets_sector_idx on presets(sector_id);

-- --- Versioni di preset -------------------------------------------------
create table if not exists preset_versions (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references presets(id) on delete cascade,
  version int not null,
  name text,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (preset_id, version)
);

create index if not exists preset_versions_preset_idx on preset_versions(preset_id);

-- FK differita: active_version_id definita dopo preset_versions.
do $$ begin
  alter table presets
    add constraint presets_active_version_fk
    foreign key (active_version_id) references preset_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

-- --- Categorie incluse in una versione di preset -----------------------
create table if not exists preset_categories (
  id uuid primary key default gen_random_uuid(),
  preset_version_id uuid not null references preset_versions(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  display_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (preset_version_id, category_id)
);

create index if not exists preset_categories_preset_version_idx on preset_categories(preset_version_id);
create index if not exists preset_categories_category_idx on preset_categories(category_id);

-- --- Attributi inclusi in una versione di preset (con override) --------
-- category_id null => l'attributo si applica globalmente al preset.
create table if not exists preset_attributes (
  id uuid primary key default gen_random_uuid(),
  preset_version_id uuid not null references preset_versions(id) on delete cascade,
  attribute_id uuid not null references attributes(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  is_required boolean not null default false,
  display_order int not null default 0,
  extraction_instruction_override text,
  generation_instruction_override text,
  validation_rules_override_json jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (preset_version_id, attribute_id, category_id)
);

create index if not exists preset_attributes_preset_version_idx on preset_attributes(preset_version_id);
create index if not exists preset_attributes_attribute_idx on preset_attributes(attribute_id);
create index if not exists preset_attributes_category_idx on preset_attributes(category_id);

-- --- Campi generati definiti da una versione di preset -----------------
create table if not exists preset_generated_fields (
  id uuid primary key default gen_random_uuid(),
  preset_version_id uuid not null references preset_versions(id) on delete cascade,
  field_key text not null,
  label text,
  display_order int not null default 0,
  enabled boolean not null default true,
  config_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (preset_version_id, field_key)
);

create index if not exists preset_generated_fields_preset_version_idx on preset_generated_fields(preset_version_id);

-- --- Conversazioni di configurazione guidata ---------------------------
create table if not exists configuration_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_type config_entity_type not null,
  entity_draft_id uuid,
  status config_conversation_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists configuration_conversations_org_idx on configuration_conversations(organization_id);

-- --- Messaggi delle conversazioni di configurazione --------------------
create table if not exists configuration_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references configuration_conversations(id) on delete cascade,
  role text not null,
  content text not null,
  transcript_source_file_id uuid,
  tool_calls_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists configuration_messages_conversation_idx on configuration_messages(conversation_id);

-- --- Bozze di configurazione (categorie/attributi/preset) --------------
create table if not exists configuration_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_type config_entity_type not null,
  entity_id uuid,
  draft_data_json jsonb not null default '{}',
  status config_draft_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  published_at timestamptz
);

create index if not exists configuration_drafts_org_idx on configuration_drafts(organization_id);


-- =====================================================================
-- 4. Trigger set_updated_at() sulle tabelle con updated_at
-- =====================================================================
-- set_updated_at() e' gia' definita da 20250101000004_functions.sql.

do $$
declare
  t text;
  tables text[] := array[
    'sectors', 'categories', 'organization_categories', 'attributes',
    'organization_attributes', 'category_attributes', 'presets',
    'configuration_conversations', 'configuration_drafts'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists set_updated_at on %I;', t);
    execute format(
      'create trigger set_updated_at before update on %I
         for each row execute function set_updated_at();', t);
  end loop;
end $$;


-- =====================================================================
-- 5. Row Level Security
-- =====================================================================
-- NOTA: la service_role bypassa RLS (worker/webhook). Le policy proteggono
-- l'accesso dal client "authenticated". Le righe di sistema
-- (owner_organization_id null) sono leggibili da tutti gli autenticati ma
-- mai modificabili dal client.

alter table sectors enable row level security;
alter table organization_sectors enable row level security;
alter table categories enable row level security;
alter table organization_categories enable row level security;
alter table attributes enable row level security;
alter table organization_attributes enable row level security;
alter table category_attributes enable row level security;
alter table presets enable row level security;
alter table preset_versions enable row level security;
alter table preset_categories enable row level security;
alter table preset_attributes enable row level security;
alter table preset_generated_fields enable row level security;
alter table configuration_conversations enable row level security;
alter table configuration_messages enable row level security;
alter table configuration_drafts enable row level security;

-- --- sectors: catalogo pubblico in sola lettura ------------------------
drop policy if exists sectors_select on sectors;
create policy sectors_select on sectors
  for select to authenticated using (true);
-- Nessuna policy di scrittura: gestiti solo via seed/service_role.

-- --- organization_sectors: membership -----------------------------------
drop policy if exists organization_sectors_select on organization_sectors;
create policy organization_sectors_select on organization_sectors
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists organization_sectors_insert on organization_sectors;
create policy organization_sectors_insert on organization_sectors
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists organization_sectors_update on organization_sectors;
create policy organization_sectors_update on organization_sectors
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));
drop policy if exists organization_sectors_delete on organization_sectors;
create policy organization_sectors_delete on organization_sectors
  for delete to authenticated using (is_organization_member(organization_id));

-- --- categories: sistema (owner null) leggibili da tutti; custom gestite
--     solo dai membri dell'org proprietaria. Righe di sistema immutabili.
drop policy if exists categories_select on categories;
create policy categories_select on categories
  for select to authenticated
  using (owner_organization_id is null or is_organization_member(owner_organization_id));
drop policy if exists categories_insert on categories;
create policy categories_insert on categories
  for insert to authenticated
  with check (owner_organization_id is not null and is_organization_member(owner_organization_id));
drop policy if exists categories_update on categories;
create policy categories_update on categories
  for update to authenticated
  using (owner_organization_id is not null and is_organization_member(owner_organization_id))
  with check (owner_organization_id is not null and is_organization_member(owner_organization_id));
drop policy if exists categories_delete on categories;
create policy categories_delete on categories
  for delete to authenticated
  using (owner_organization_id is not null and is_organization_member(owner_organization_id));

-- --- organization_categories: membership --------------------------------
drop policy if exists organization_categories_select on organization_categories;
create policy organization_categories_select on organization_categories
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists organization_categories_insert on organization_categories;
create policy organization_categories_insert on organization_categories
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists organization_categories_update on organization_categories;
create policy organization_categories_update on organization_categories
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));
drop policy if exists organization_categories_delete on organization_categories;
create policy organization_categories_delete on organization_categories
  for delete to authenticated using (is_organization_member(organization_id));

-- --- attributes: come categories ----------------------------------------
drop policy if exists attributes_select on attributes;
create policy attributes_select on attributes
  for select to authenticated
  using (owner_organization_id is null or is_organization_member(owner_organization_id));
drop policy if exists attributes_insert on attributes;
create policy attributes_insert on attributes
  for insert to authenticated
  with check (owner_organization_id is not null and is_organization_member(owner_organization_id));
drop policy if exists attributes_update on attributes;
create policy attributes_update on attributes
  for update to authenticated
  using (owner_organization_id is not null and is_organization_member(owner_organization_id))
  with check (owner_organization_id is not null and is_organization_member(owner_organization_id));
drop policy if exists attributes_delete on attributes;
create policy attributes_delete on attributes
  for delete to authenticated
  using (owner_organization_id is not null and is_organization_member(owner_organization_id));

-- --- organization_attributes: membership --------------------------------
drop policy if exists organization_attributes_select on organization_attributes;
create policy organization_attributes_select on organization_attributes
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists organization_attributes_insert on organization_attributes;
create policy organization_attributes_insert on organization_attributes
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists organization_attributes_update on organization_attributes;
create policy organization_attributes_update on organization_attributes
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));
drop policy if exists organization_attributes_delete on organization_attributes;
create policy organization_attributes_delete on organization_attributes
  for delete to authenticated using (is_organization_member(organization_id));

-- --- category_attributes: SELECT a tutti gli autenticati (servono i legami
--     delle categorie di sistema). Scrittura solo se la categoria e' di
--     un'org di cui l'utente e' membro (i legami di sistema sono immutabili).
drop policy if exists category_attributes_select on category_attributes;
create policy category_attributes_select on category_attributes
  for select to authenticated using (true);
drop policy if exists category_attributes_insert on category_attributes;
create policy category_attributes_insert on category_attributes
  for insert to authenticated
  with check (
    exists (
      select 1 from categories c
      where c.id = category_attributes.category_id
        and c.owner_organization_id is not null
        and is_organization_member(c.owner_organization_id)
    )
  );
drop policy if exists category_attributes_update on category_attributes;
create policy category_attributes_update on category_attributes
  for update to authenticated
  using (
    exists (
      select 1 from categories c
      where c.id = category_attributes.category_id
        and c.owner_organization_id is not null
        and is_organization_member(c.owner_organization_id)
    )
  )
  with check (
    exists (
      select 1 from categories c
      where c.id = category_attributes.category_id
        and c.owner_organization_id is not null
        and is_organization_member(c.owner_organization_id)
    )
  );
drop policy if exists category_attributes_delete on category_attributes;
create policy category_attributes_delete on category_attributes
  for delete to authenticated
  using (
    exists (
      select 1 from categories c
      where c.id = category_attributes.category_id
        and c.owner_organization_id is not null
        and is_organization_member(c.owner_organization_id)
    )
  );

-- --- presets: membership ------------------------------------------------
drop policy if exists presets_select on presets;
create policy presets_select on presets
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists presets_insert on presets;
create policy presets_insert on presets
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists presets_update on presets;
create policy presets_update on presets
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));
drop policy if exists presets_delete on presets;
create policy presets_delete on presets
  for delete to authenticated using (is_organization_member(organization_id));

-- --- preset_versions: via join a presets.organization_id ----------------
drop policy if exists preset_versions_select on preset_versions;
create policy preset_versions_select on preset_versions
  for select to authenticated
  using (
    exists (
      select 1 from presets p
      where p.id = preset_versions.preset_id and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_versions_insert on preset_versions;
create policy preset_versions_insert on preset_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from presets p
      where p.id = preset_versions.preset_id and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_versions_update on preset_versions;
create policy preset_versions_update on preset_versions
  for update to authenticated
  using (
    exists (
      select 1 from presets p
      where p.id = preset_versions.preset_id and is_organization_member(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from presets p
      where p.id = preset_versions.preset_id and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_versions_delete on preset_versions;
create policy preset_versions_delete on preset_versions
  for delete to authenticated
  using (
    exists (
      select 1 from presets p
      where p.id = preset_versions.preset_id and is_organization_member(p.organization_id)
    )
  );

-- --- preset_categories: via join preset_versions -> presets -------------
drop policy if exists preset_categories_select on preset_categories;
create policy preset_categories_select on preset_categories
  for select to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_categories.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_categories_insert on preset_categories;
create policy preset_categories_insert on preset_categories
  for insert to authenticated
  with check (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_categories.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_categories_update on preset_categories;
create policy preset_categories_update on preset_categories
  for update to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_categories.preset_version_id
        and is_organization_member(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_categories.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_categories_delete on preset_categories;
create policy preset_categories_delete on preset_categories
  for delete to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_categories.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );

-- --- preset_attributes: via join preset_versions -> presets -------------
drop policy if exists preset_attributes_select on preset_attributes;
create policy preset_attributes_select on preset_attributes
  for select to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_attributes.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_attributes_insert on preset_attributes;
create policy preset_attributes_insert on preset_attributes
  for insert to authenticated
  with check (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_attributes.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_attributes_update on preset_attributes;
create policy preset_attributes_update on preset_attributes
  for update to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_attributes.preset_version_id
        and is_organization_member(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_attributes.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_attributes_delete on preset_attributes;
create policy preset_attributes_delete on preset_attributes
  for delete to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_attributes.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );

-- --- preset_generated_fields: via join preset_versions -> presets -------
drop policy if exists preset_generated_fields_select on preset_generated_fields;
create policy preset_generated_fields_select on preset_generated_fields
  for select to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_generated_fields.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_generated_fields_insert on preset_generated_fields;
create policy preset_generated_fields_insert on preset_generated_fields
  for insert to authenticated
  with check (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_generated_fields.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_generated_fields_update on preset_generated_fields;
create policy preset_generated_fields_update on preset_generated_fields
  for update to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_generated_fields.preset_version_id
        and is_organization_member(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_generated_fields.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );
drop policy if exists preset_generated_fields_delete on preset_generated_fields;
create policy preset_generated_fields_delete on preset_generated_fields
  for delete to authenticated
  using (
    exists (
      select 1 from preset_versions pv
      join presets p on p.id = pv.preset_id
      where pv.id = preset_generated_fields.preset_version_id
        and is_organization_member(p.organization_id)
    )
  );

-- --- configuration_conversations: membership ----------------------------
drop policy if exists configuration_conversations_select on configuration_conversations;
create policy configuration_conversations_select on configuration_conversations
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists configuration_conversations_insert on configuration_conversations;
create policy configuration_conversations_insert on configuration_conversations
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists configuration_conversations_update on configuration_conversations;
create policy configuration_conversations_update on configuration_conversations
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));
drop policy if exists configuration_conversations_delete on configuration_conversations;
create policy configuration_conversations_delete on configuration_conversations
  for delete to authenticated using (is_organization_member(organization_id));

-- --- configuration_messages: via join alla conversazione ----------------
drop policy if exists configuration_messages_select on configuration_messages;
create policy configuration_messages_select on configuration_messages
  for select to authenticated
  using (
    exists (
      select 1 from configuration_conversations cc
      where cc.id = configuration_messages.conversation_id
        and is_organization_member(cc.organization_id)
    )
  );
drop policy if exists configuration_messages_insert on configuration_messages;
create policy configuration_messages_insert on configuration_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from configuration_conversations cc
      where cc.id = configuration_messages.conversation_id
        and is_organization_member(cc.organization_id)
    )
  );
drop policy if exists configuration_messages_update on configuration_messages;
create policy configuration_messages_update on configuration_messages
  for update to authenticated
  using (
    exists (
      select 1 from configuration_conversations cc
      where cc.id = configuration_messages.conversation_id
        and is_organization_member(cc.organization_id)
    )
  )
  with check (
    exists (
      select 1 from configuration_conversations cc
      where cc.id = configuration_messages.conversation_id
        and is_organization_member(cc.organization_id)
    )
  );
drop policy if exists configuration_messages_delete on configuration_messages;
create policy configuration_messages_delete on configuration_messages
  for delete to authenticated
  using (
    exists (
      select 1 from configuration_conversations cc
      where cc.id = configuration_messages.conversation_id
        and is_organization_member(cc.organization_id)
    )
  );

-- --- configuration_drafts: membership -----------------------------------
drop policy if exists configuration_drafts_select on configuration_drafts;
create policy configuration_drafts_select on configuration_drafts
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists configuration_drafts_insert on configuration_drafts;
create policy configuration_drafts_insert on configuration_drafts
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists configuration_drafts_update on configuration_drafts;
create policy configuration_drafts_update on configuration_drafts
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));
drop policy if exists configuration_drafts_delete on configuration_drafts;
create policy configuration_drafts_delete on configuration_drafts
  for delete to authenticated using (is_organization_member(organization_id));
