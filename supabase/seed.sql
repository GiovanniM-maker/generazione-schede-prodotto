-- Seed dati di sistema.
-- Idempotente: usa on conflict do nothing / id fissi.

-- =====================================================================
-- Preset di sistema "Moda"
-- =====================================================================

insert into presets (id, owner_organization_id, key, name, category, is_system)
values ('00000000-0000-0000-0000-0000000000a1', null, 'moda', 'Moda', 'fashion', true)
on conflict (id) do nothing;

insert into preset_versions (
  preset_id,
  version,
  fact_schema_json,
  content_schema_json,
  validation_rules_json,
  inference_policy_json,
  header_synonyms_json,
  published_at
)
values (
  '00000000-0000-0000-0000-0000000000a1',
  1,
  -- fact_schema_json: campi fattuali del dominio moda.
  '{
    "fields": [
      {"key": "external_id", "label": "Codice esterno", "type": "string"},
      {"key": "parent_external_id", "label": "Codice esterno padre", "type": "string"},
      {"key": "sku", "label": "SKU", "type": "string"},
      {"key": "product_name", "label": "Nome prodotto", "type": "string"},
      {"key": "product_type", "label": "Tipo prodotto", "type": "string"},
      {"key": "category", "label": "Categoria", "type": "string"},
      {"key": "brand", "label": "Brand", "type": "string"},
      {"key": "gender", "label": "Genere", "type": "string"},
      {"key": "collection", "label": "Collezione", "type": "string"},
      {"key": "season", "label": "Stagione", "type": "string"},
      {"key": "color", "label": "Colore", "type": "string"},
      {"key": "secondary_color", "label": "Colore secondario", "type": "string"},
      {"key": "pattern", "label": "Fantasia", "type": "string"},
      {"key": "material", "label": "Materiale", "type": "string"},
      {"key": "composition", "label": "Composizione", "type": "string"},
      {"key": "fit", "label": "Vestibilità", "type": "string"},
      {"key": "neckline", "label": "Scollatura", "type": "string"},
      {"key": "sleeve_length", "label": "Lunghezza manica", "type": "string"},
      {"key": "closure", "label": "Chiusura", "type": "string"},
      {"key": "length", "label": "Lunghezza", "type": "string"},
      {"key": "details", "label": "Dettagli", "type": "string"},
      {"key": "sizes", "label": "Taglie", "type": "array"},
      {"key": "measurements", "label": "Misure", "type": "object"},
      {"key": "care_instructions", "label": "Istruzioni di lavaggio", "type": "string"},
      {"key": "country_of_origin", "label": "Paese di origine", "type": "string"},
      {"key": "sustainability_claims", "label": "Claim di sostenibilità", "type": "array"},
      {"key": "other_facts", "label": "Altri fatti", "type": "object"},
      {"key": "image_names", "label": "Nomi immagini", "type": "array"}
    ]
  }'::jsonb,
  -- content_schema_json: struttura e limiti dell''output generato.
  '{
    "fields": [
      {"key": "generated_title", "label": "Titolo", "type": "string", "max_chars": 80},
      {"key": "short_description", "label": "Descrizione breve", "type": "string", "max_chars": 200},
      {"key": "long_description", "label": "Descrizione lunga", "type": "string", "min_words": 80, "max_words": 120},
      {"key": "bullets", "label": "Punti elenco", "type": "array", "min_items": 3, "max_items": 5},
      {"key": "meta_description", "label": "Meta description", "type": "string", "max_chars": 155},
      {"key": "warnings", "label": "Avvertenze", "type": "array"},
      {"key": "used_fact_keys", "label": "Chiavi fatti utilizzate", "type": "array"}
    ]
  }'::jsonb,
  -- validation_rules_json: requisito minimo di validità di un prodotto.
  '{
    "min_requirements": {
      "identifier": {"any_of": ["external_id", "sku"]},
      "descriptor": {"any_of": ["product_name", "product_type"]},
      "additional_non_empty_factual_attributes": {"min_count": 2}
    },
    "description": "Un prodotto è valido se possiede almeno (external_id OR sku) AND (product_name OR product_type) AND almeno 2 ulteriori attributi fattuali non vuoti."
  }'::jsonb,
  -- inference_policy_json: cosa è inferibile dalle immagini e cosa è vietato.
  '{
    "visual_whitelist": [
      "product_type", "apparent_color", "pattern", "neckline",
      "sleeve_length", "visible_closure", "visible_details", "apparent_length"
    ],
    "require_confirmation_for_inferred_visual": true,
    "forbidden_visual_inferences": [
      "material", "composition", "measurements", "waterproof", "breathable",
      "origin", "sustainability", "quality", "certifications", "care"
    ],
    "description": "Le inferenze visive sono limitate alla whitelist e richiedono sempre conferma umana (inferred_visual -> needs_review). Gli attributi vietati non possono mai essere inferiti dalle immagini."
  }'::jsonb,
  -- header_synonyms_json: sinonimi IT+EN per il mapping automatico delle intestazioni.
  '{
    "external_id": ["external_id", "id esterno", "codice esterno", "id", "external id"],
    "parent_external_id": ["parent_external_id", "codice padre", "id padre", "parent id", "parent external id"],
    "sku": ["sku", "codice", "codice articolo", "codice prodotto", "article code"],
    "product_name": ["nome", "titolo", "nome prodotto", "product name", "title"],
    "product_type": ["tipo", "tipo prodotto", "tipologia", "product type", "type"],
    "category": ["categoria", "category", "reparto"],
    "brand": ["brand", "marca", "marchio"],
    "gender": ["genere", "gender", "sesso", "target"],
    "collection": ["collezione", "collection", "linea"],
    "season": ["stagione", "season", "ss", "fw", "stagionalità"],
    "color": ["colore", "color", "colour"],
    "secondary_color": ["colore secondario", "secondary color", "colore 2"],
    "pattern": ["fantasia", "pattern", "stampa", "motivo"],
    "material": ["materiale", "material", "tessuto", "fabric"],
    "composition": ["composizione", "composizione tessuto", "fabric composition", "composition"],
    "fit": ["fit", "vestibilità", "fitting", "vestibilita"],
    "neckline": ["scollatura", "neckline", "collo", "scollo"],
    "sleeve_length": ["lunghezza manica", "manica", "sleeve length", "sleeve"],
    "closure": ["chiusura", "closure", "allacciatura"],
    "length": ["lunghezza", "length", "altezza"],
    "details": ["dettagli", "details", "particolari"],
    "sizes": ["taglie", "sizes", "size", "taglia"],
    "measurements": ["misure", "measurements", "dimensioni"],
    "care_instructions": ["istruzioni di lavaggio", "lavaggio", "care", "care instructions", "manutenzione"],
    "country_of_origin": ["paese di origine", "origine", "country of origin", "made in"],
    "sustainability_claims": ["sostenibilità", "sustainability", "eco", "claim sostenibilità", "sustainability claims"],
    "other_facts": ["altri fatti", "note", "other facts", "extra"],
    "image_names": ["immagini", "nomi immagini", "image names", "images", "foto"]
  }'::jsonb,
  now()
)
on conflict (preset_id, version) do nothing;

-- =====================================================================
-- Pacchetti crediti (billing_products)
-- stripe_price_id resta null: valorizzato in deploy reale da variabili d'ambiente.
-- =====================================================================

insert into billing_products (key, name, credits, stripe_price_id, active)
values
  ('pack_50', 'Pacchetto 50 crediti', 50, null, true),
  ('pack_200', 'Pacchetto 200 crediti', 200, null, true),
  ('pack_500', 'Pacchetto 500 crediti', 500, null, true)
on conflict (key) do nothing;

-- =====================================================================
-- Coda PGMQ per i job di generazione
-- =====================================================================

do $$
begin
  perform pgmq.create('generation_jobs');
exception
  when others then
    -- La coda esiste gia' oppure pgmq gestisce internamente il caso: ignora.
    raise notice 'pgmq.create(generation_jobs): %', sqlerrm;
end $$;
