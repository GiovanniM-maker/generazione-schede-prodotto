-- Indici sulle foreign key non coperte da indice.
-- Servono a mantenere veloci le cancellazioni a cascata (batch, organizzazione,
-- sorgenti, varianti) quando i volumi crescono: senza indice, ogni ON DELETE
-- CASCADE / verifica FK fa una scansione completa della tabella figlia.

-- Cancellazione batch (source_files/source_items → link/asset/evidence, dubbi)
create index if not exists product_source_links_source_item_idx on product_source_links(source_item_id);
create index if not exists source_items_source_file_idx on source_items(source_file_id);
create index if not exists product_assets_source_file_idx on product_assets(source_file_id);
create index if not exists attribute_evidence_source_file_idx on attribute_evidence(source_file_id);
create index if not exists batch_imports_source_file_idx on batch_imports(source_file_id);
create index if not exists batch_imports_mapping_idx on batch_imports(import_mapping_id);
create index if not exists ai_doubts_batch_idx on ai_doubts(batch_id);
create index if not exists ai_doubts_attribute_idx on ai_doubts(attribute_id);
create index if not exists output_corrections_batch_idx on output_corrections(batch_id);
create index if not exists output_corrections_generation_idx on output_corrections(generation_id);
create index if not exists output_corrections_preset_version_idx on output_corrections(preset_version_id);

-- Cancellazione organizzazione / account (tabelle più grandi)
create index if not exists pav_org_idx on product_attribute_values(organization_id);
create index if not exists pav_attribute_idx on product_attribute_values(attribute_id);
create index if not exists pav_source_item_idx on product_attribute_values(source_item_id);
create index if not exists product_source_links_org_idx on product_source_links(organization_id);
create index if not exists batch_sources_org_idx on batch_sources(organization_id);

-- Cancellazione varianti
create index if not exists attribute_evidence_variant_idx on attribute_evidence(variant_id);
create index if not exists product_assets_variant_idx on product_assets(variant_id);

-- Versioni brand
create index if not exists brand_examples_bpv_idx on brand_examples(brand_profile_version_id);
