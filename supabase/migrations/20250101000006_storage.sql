-- Storage: bucket privati e policy multi-tenant su storage.objects.
--
-- Convenzione dei path: ogni oggetto e' salvato con prefisso
--   <organization_id>/<...resto del path>
-- La prima "cartella" del name deve corrispondere a un'organizzazione di cui
-- l'utente e' membro. La service_role bypassa comunque queste policy.

-- =====================================================================
-- Bucket privati
-- =====================================================================

insert into storage.buckets (id, name, public)
values
  ('source-files', 'source-files', false),
  ('product-assets', 'product-assets', false),
  ('exports', 'exports', false)
on conflict (id) do nothing;

-- =====================================================================
-- Policy su storage.objects, limitate ai tre bucket applicativi.
-- Primo segmento del path = organization_id di cui l'utente e' membro.
-- =====================================================================

drop policy if exists app_objects_select on storage.objects;
create policy app_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('source-files', 'product-assets', 'exports')
    and is_organization_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists app_objects_insert on storage.objects;
create policy app_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('source-files', 'product-assets', 'exports')
    and is_organization_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists app_objects_update on storage.objects;
create policy app_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('source-files', 'product-assets', 'exports')
    and is_organization_member((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id in ('source-files', 'product-assets', 'exports')
    and is_organization_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists app_objects_delete on storage.objects;
create policy app_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('source-files', 'product-assets', 'exports')
    and is_organization_member((split_part(name, '/', 1))::uuid)
  );
