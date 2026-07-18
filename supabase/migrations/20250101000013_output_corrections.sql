-- =====================================================================
-- Correzioni degli output (apprendimento del prompt dalle modifiche).
--
-- Quando l'utente modifica una scheda generata e spiega il PERCHÉ, la
-- correzione viene registrata qui. Le correzioni "in sospeso" (non ancora
-- assorbite in un miglioramento del prompt) alimentano l'azione
-- "Migliora il prompt", che propone istruzioni migliori per il preset.
-- Nessuna auto-sovrascrittura: il miglioramento crea una BOZZA di preset.
-- =====================================================================

create table if not exists output_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid references batches(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  generation_id uuid references product_generations(id) on delete set null,
  -- Preset di riferimento: le correzioni migliorano il prompt di QUESTO preset.
  preset_id uuid references presets(id) on delete set null,
  preset_version_id uuid references preset_versions(id) on delete set null,
  -- Campo di output corretto: generated_title, short_description, ...
  field_key text not null,
  original_value text,
  corrected_value text,
  -- Il "perché" scritto dall'utente: è il segnale che addestra il prompt.
  reason text,
  -- true quando la correzione è già stata assorbita in un miglioramento.
  applied_to_prompt boolean not null default false,
  applied_at timestamptz,
  -- Bozza/versione preset generata dal miglioramento che ha usato questa riga.
  improvement_version_id uuid references preset_versions(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists output_corrections_org_idx on output_corrections(organization_id);
create index if not exists output_corrections_preset_idx on output_corrections(preset_id);
create index if not exists output_corrections_pending_idx
  on output_corrections(preset_id, applied_to_prompt);
create index if not exists output_corrections_product_idx on output_corrections(product_id);

alter table output_corrections enable row level security;

drop policy if exists output_corrections_select on output_corrections;
create policy output_corrections_select on output_corrections
  for select to authenticated
  using (is_organization_member(organization_id));

drop policy if exists output_corrections_insert on output_corrections;
create policy output_corrections_insert on output_corrections
  for insert to authenticated
  with check (is_organization_member(organization_id));

drop policy if exists output_corrections_update on output_corrections;
create policy output_corrections_update on output_corrections
  for update to authenticated
  using (is_organization_member(organization_id))
  with check (is_organization_member(organization_id));

drop policy if exists output_corrections_delete on output_corrections;
create policy output_corrections_delete on output_corrections
  for delete to authenticated
  using (is_organization_member(organization_id));
