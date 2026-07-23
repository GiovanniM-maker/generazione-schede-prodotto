-- Override "come si riconosce" a livello di PRESET: così è sempre modificabile
-- (anche per categorie di sistema) e specifico del preset, come già avviene per
-- le istruzioni degli attributi (preset_attributes.*_override).
alter table preset_categories add column if not exists recognition_hint text;
