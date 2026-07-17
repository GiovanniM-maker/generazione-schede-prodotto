-- Tipi enumerati del dominio applicativo.
-- Gli identificatori SQL sono in inglese; i valori sono stabili e referenziati dal codice.
-- Ogni creazione è avvolta in un blocco idempotente (crea solo se il tipo non esiste).

do $$ begin
  create type batch_status as enum (
    'draft', 'uploaded', 'mapping', 'input_review', 'tone_setup',
    'sample_pending', 'sample_ready', 'approved', 'queued', 'processing',
    'completed', 'partial_failed', 'failed', 'canceled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type attribute_status as enum (
    'provided', 'extracted', 'inferred_visual', 'needs_review', 'confirmed', 'rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_generation_status as enum (
    'generated', 'needs_review', 'accepted', 'rejected', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_item_status as enum (
    'pending', 'queued', 'processing', 'completed', 'needs_review', 'failed', 'canceled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type credit_entry_type as enum (
    'purchase', 'welcome', 'reservation', 'release', 'consumption', 'refund', 'admin_adjustment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type org_role as enum ('owner', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type source_file_status as enum ('pending', 'scanned', 'ready', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type export_format as enum ('csv', 'xlsx');
exception when duplicate_object then null; end $$;

do $$ begin
  create type run_type as enum (
    'brand_profile', 'sample', 'product_copy', 'visual_extraction', 'fact_audit'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type generation_run_status as enum ('pending', 'running', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_source_type as enum ('csv', 'xlsx', 'manual', 'image', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asset_match_method as enum (
    'sku_filename', 'external_id_filename', 'manual', 'unmatched'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type stripe_event_status as enum ('pending', 'processed', 'failed');
exception when duplicate_object then null; end $$;
