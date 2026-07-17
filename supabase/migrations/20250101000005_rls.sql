-- Row Level Security.
--
-- NOTA IMPORTANTE: la service_role key bypassa completamente RLS. Worker e
-- webhook (Stripe, generazione, export) usano la service_role e non sono quindi
-- vincolati da queste policy. Le policy qui definite proteggono gli accessi dal
-- client "authenticated" (app web). L'autorizzazione si basa SEMPRE sulla
-- tabella organization_members tramite le funzioni SECURITY DEFINER, mai su
-- claim del JWT controllabili dal client.

-- =====================================================================
-- Abilita RLS su tutte le tabelle tenant
-- =====================================================================

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table presets enable row level security;
alter table preset_versions enable row level security;
alter table brand_profiles enable row level security;
alter table brand_profile_versions enable row level security;
alter table brand_examples enable row level security;
alter table batches enable row level security;
alter table source_files enable row level security;
alter table import_mappings enable row level security;
alter table batch_imports enable row level security;
alter table products enable row level security;
alter table product_variants enable row level security;
alter table product_assets enable row level security;
alter table attribute_evidence enable row level security;
alter table generation_runs enable row level security;
alter table product_generations enable row level security;
alter table job_items enable row level security;
alter table exports enable row level security;
alter table billing_products enable row level security;
alter table credit_ledger enable row level security;
alter table stripe_events enable row level security;
alter table app_events enable row level security;

-- =====================================================================
-- Organizations
-- =====================================================================

drop policy if exists organizations_select on organizations;
create policy organizations_select on organizations
  for select to authenticated
  using (is_organization_member(id));
-- Nessuna policy INSERT/UPDATE/DELETE: mutazioni solo via funzioni SECURITY
-- DEFINER (create_organization_for_user) o service_role.

-- =====================================================================
-- Organization members
-- =====================================================================

drop policy if exists organization_members_select on organization_members;
create policy organization_members_select on organization_members
  for select to authenticated
  using (is_organization_member(organization_id));

-- =====================================================================
-- Presets / preset_versions (sola lettura per authenticated)
-- =====================================================================

drop policy if exists presets_select on presets;
create policy presets_select on presets
  for select to authenticated
  using (is_system = true or is_organization_member(owner_organization_id));

drop policy if exists preset_versions_select on preset_versions;
create policy preset_versions_select on preset_versions
  for select to authenticated
  using (
    exists (
      select 1 from presets p
      where p.id = preset_versions.preset_id
        and (p.is_system = true or is_organization_member(p.owner_organization_id))
    )
  );

-- =====================================================================
-- Brand profiles / versioni / esempi
-- Lettura: qualsiasi membro. Scrittura: solo owner.
-- =====================================================================

drop policy if exists brand_profiles_select on brand_profiles;
create policy brand_profiles_select on brand_profiles
  for select to authenticated
  using (is_organization_member(organization_id));

drop policy if exists brand_profiles_insert on brand_profiles;
create policy brand_profiles_insert on brand_profiles
  for insert to authenticated
  with check (is_organization_owner(organization_id));

drop policy if exists brand_profiles_update on brand_profiles;
create policy brand_profiles_update on brand_profiles
  for update to authenticated
  using (is_organization_owner(organization_id))
  with check (is_organization_owner(organization_id));

drop policy if exists brand_profiles_delete on brand_profiles;
create policy brand_profiles_delete on brand_profiles
  for delete to authenticated
  using (is_organization_owner(organization_id));

drop policy if exists brand_profile_versions_select on brand_profile_versions;
create policy brand_profile_versions_select on brand_profile_versions
  for select to authenticated
  using (
    exists (
      select 1 from brand_profiles bp
      where bp.id = brand_profile_versions.brand_profile_id
        and is_organization_member(bp.organization_id)
    )
  );

drop policy if exists brand_profile_versions_insert on brand_profile_versions;
create policy brand_profile_versions_insert on brand_profile_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from brand_profiles bp
      where bp.id = brand_profile_versions.brand_profile_id
        and is_organization_owner(bp.organization_id)
    )
  );

drop policy if exists brand_profile_versions_update on brand_profile_versions;
create policy brand_profile_versions_update on brand_profile_versions
  for update to authenticated
  using (
    exists (
      select 1 from brand_profiles bp
      where bp.id = brand_profile_versions.brand_profile_id
        and is_organization_owner(bp.organization_id)
    )
  )
  with check (
    exists (
      select 1 from brand_profiles bp
      where bp.id = brand_profile_versions.brand_profile_id
        and is_organization_owner(bp.organization_id)
    )
  );

drop policy if exists brand_profile_versions_delete on brand_profile_versions;
create policy brand_profile_versions_delete on brand_profile_versions
  for delete to authenticated
  using (
    exists (
      select 1 from brand_profiles bp
      where bp.id = brand_profile_versions.brand_profile_id
        and is_organization_owner(bp.organization_id)
    )
  );

drop policy if exists brand_examples_select on brand_examples;
create policy brand_examples_select on brand_examples
  for select to authenticated
  using (
    exists (
      select 1 from brand_profile_versions v
      join brand_profiles bp on bp.id = v.brand_profile_id
      where v.id = brand_examples.brand_profile_version_id
        and is_organization_member(bp.organization_id)
    )
  );

drop policy if exists brand_examples_insert on brand_examples;
create policy brand_examples_insert on brand_examples
  for insert to authenticated
  with check (
    exists (
      select 1 from brand_profile_versions v
      join brand_profiles bp on bp.id = v.brand_profile_id
      where v.id = brand_examples.brand_profile_version_id
        and is_organization_owner(bp.organization_id)
    )
  );

drop policy if exists brand_examples_delete on brand_examples;
create policy brand_examples_delete on brand_examples
  for delete to authenticated
  using (
    exists (
      select 1 from brand_profile_versions v
      join brand_profiles bp on bp.id = v.brand_profile_id
      where v.id = brand_examples.brand_profile_version_id
        and is_organization_owner(bp.organization_id)
    )
  );

-- =====================================================================
-- Tabelle "di lavoro" del batch: lettura + scrittura per i membri
-- =====================================================================

-- batches
drop policy if exists batches_select on batches;
create policy batches_select on batches
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists batches_insert on batches;
create policy batches_insert on batches
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists batches_update on batches;
create policy batches_update on batches
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

-- source_files
drop policy if exists source_files_select on source_files;
create policy source_files_select on source_files
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists source_files_insert on source_files;
create policy source_files_insert on source_files
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists source_files_update on source_files;
create policy source_files_update on source_files
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

-- import_mappings
drop policy if exists import_mappings_select on import_mappings;
create policy import_mappings_select on import_mappings
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists import_mappings_insert on import_mappings;
create policy import_mappings_insert on import_mappings
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists import_mappings_update on import_mappings;
create policy import_mappings_update on import_mappings
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

-- batch_imports (nessun organization_id diretto: join sul batch)
drop policy if exists batch_imports_select on batch_imports;
create policy batch_imports_select on batch_imports
  for select to authenticated
  using (
    exists (
      select 1 from batches b
      where b.id = batch_imports.batch_id and is_organization_member(b.organization_id)
    )
  );
drop policy if exists batch_imports_insert on batch_imports;
create policy batch_imports_insert on batch_imports
  for insert to authenticated
  with check (
    exists (
      select 1 from batches b
      where b.id = batch_imports.batch_id and is_organization_member(b.organization_id)
    )
  );

-- products
drop policy if exists products_select on products;
create policy products_select on products
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists products_insert on products;
create policy products_insert on products
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists products_update on products;
create policy products_update on products
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

-- product_variants (nessun organization_id diretto: join sul product)
drop policy if exists product_variants_select on product_variants;
create policy product_variants_select on product_variants
  for select to authenticated
  using (
    exists (
      select 1 from products p
      where p.id = product_variants.product_id and is_organization_member(p.organization_id)
    )
  );
drop policy if exists product_variants_insert on product_variants;
create policy product_variants_insert on product_variants
  for insert to authenticated
  with check (
    exists (
      select 1 from products p
      where p.id = product_variants.product_id and is_organization_member(p.organization_id)
    )
  );
drop policy if exists product_variants_update on product_variants;
create policy product_variants_update on product_variants
  for update to authenticated
  using (
    exists (
      select 1 from products p
      where p.id = product_variants.product_id and is_organization_member(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from products p
      where p.id = product_variants.product_id and is_organization_member(p.organization_id)
    )
  );

-- product_assets (ha organization_id diretto, ma valida anche il product via join implicito nell'org)
drop policy if exists product_assets_select on product_assets;
create policy product_assets_select on product_assets
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists product_assets_insert on product_assets;
create policy product_assets_insert on product_assets
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists product_assets_update on product_assets;
create policy product_assets_update on product_assets
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

-- attribute_evidence
drop policy if exists attribute_evidence_select on attribute_evidence;
create policy attribute_evidence_select on attribute_evidence
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists attribute_evidence_insert on attribute_evidence;
create policy attribute_evidence_insert on attribute_evidence
  for insert to authenticated with check (is_organization_member(organization_id));
drop policy if exists attribute_evidence_update on attribute_evidence;
create policy attribute_evidence_update on attribute_evidence
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

-- exports
drop policy if exists exports_select on exports;
create policy exports_select on exports
  for select to authenticated using (is_organization_member(organization_id));
drop policy if exists exports_insert on exports;
create policy exports_insert on exports
  for insert to authenticated with check (is_organization_member(organization_id));

-- =====================================================================
-- Tabelle gestite solo dal server/worker (service_role): sola lettura
-- =====================================================================

-- generation_runs: solo SELECT per i membri; nessuna scrittura da authenticated.
drop policy if exists generation_runs_select on generation_runs;
create policy generation_runs_select on generation_runs
  for select to authenticated using (is_organization_member(organization_id));

-- product_generations: solo SELECT per i membri.
drop policy if exists product_generations_select on product_generations;
create policy product_generations_select on product_generations
  for select to authenticated using (is_organization_member(organization_id));

-- job_items: solo SELECT per i membri.
drop policy if exists job_items_select on job_items;
create policy job_items_select on job_items
  for select to authenticated using (is_organization_member(organization_id));

-- credit_ledger: solo SELECT per i membri; scrittura solo via funzioni/service_role.
drop policy if exists credit_ledger_select on credit_ledger;
create policy credit_ledger_select on credit_ledger
  for select to authenticated using (is_organization_member(organization_id));

-- =====================================================================
-- Billing products (catalogo pubblico dei pacchetti attivi)
-- =====================================================================

drop policy if exists billing_products_select on billing_products;
create policy billing_products_select on billing_products
  for select to authenticated using (active = true);

-- =====================================================================
-- Stripe events: nessun accesso da authenticated (solo service_role)
-- =====================================================================
-- RLS abilitata e nessuna policy => nega tutto agli utenti authenticated/anon.

-- =====================================================================
-- App events
-- =====================================================================

drop policy if exists app_events_select on app_events;
create policy app_events_select on app_events
  for select to authenticated
  using (organization_id is not null and is_organization_member(organization_id));

drop policy if exists app_events_insert on app_events;
create policy app_events_insert on app_events
  for insert to authenticated
  with check (
    (organization_id is not null and is_organization_member(organization_id))
    or user_id = auth.uid()
  );
