-- =====================================================================
-- Seed del catalogo di CONFIGURAZIONE di sistema per i settori
-- "Food" e "Pharma".
--
-- Idempotente: usa id fissi (deterministici) con on conflict (id) do nothing
-- e on conflict sulle chiavi naturali dove presenti. Rieseguibile in blocco
-- via Supabase Management API (Postgres 17, endpoint database/query).
--
-- Range uuid DISTINTI da Moda per evitare collisioni:
--   Moda usa il 4o gruppo 0001 (settore), 0002 (attributi), 0003 (categorie).
--   Food  usa 0f01 (settore), 0f02 (attributi), 0f03 (categorie).
--   Pharma usa 0f04 (settore), 0f05 (attributi), 0f06 (categorie).
-- Nessun uuid qui usa i gruppi 0001/0002/0003, quindi nessuna sovrapposizione
-- con il seed Moda (seed_config.sql).
--
-- NOTA sui join per chiave: attributes.key e categories.key NON sono uniche
-- globalmente (unicita' solo logica per settore). Poiche' Food e Pharma
-- condividono alcune chiavi (es. 'conservazione', 'produttore'), i legami
-- category_attributes filtrano SEMPRE per sector_id per non incrociare
-- attributi/categorie di settori diversi.
--
-- =====================================================================
-- REGOLE DI SICUREZZA PHARMA (vincolanti per il settore 'pharma')
-- =====================================================================
--   * NESSUN consiglio medico e NESSUNA diagnosi.
--   * NESSUNA indicazione terapeutica inventata o dedotta.
--   * NESSUNA modifica di dosaggi, posologie o modalita' d'uso.
--   * NESSUN claim di efficacia, sicurezza o beneficio per la salute.
--   * NESSUNA inferenza clinica: si copiano/normalizzano solo i dati
--     DICHIARATI dal produttore, senza cambiarne il significato.
--   * Si preserva sempre l'evidenza e la provenienza del dato dichiarato.
-- Tutte le default_extraction_instruction degli attributi Pharma ribadiscono
-- che il dato e' DICHIARATO e va copiato/normalizzato senza alterarne il
-- significato, e che non sono ammessi claim clinici o inferenze sanitarie.
-- =====================================================================


-- #####################################################################
-- SETTORE FOOD
-- #####################################################################

-- =====================================================================
-- 1. Settore Food
-- =====================================================================

insert into sectors (id, key, name, description, icon, is_system, status)
values (
  '00000000-0000-0000-0f01-000000000001',
  'food',
  'Food',
  'Prodotti alimentari e bevande.',
  'utensils',
  true,
  'active'
)
on conflict (id) do nothing;


-- =====================================================================
-- 2. Libreria condivisa di attributi Food (attributi di sistema, owner null)
-- =====================================================================
-- Ogni attributo esiste una sola volta ed e' riutilizzato dalle categorie.
-- attribute_kind = 'factual' (dati verificabili dichiarati, non generati).
-- default_extraction_instruction: estrazione conservativa dal dato dichiarato.

insert into attributes (
  id, sector_id, owner_organization_id, key, name, description,
  attribute_kind, data_type, unit, default_extraction_instruction,
  is_system, status
)
values
  -- --- Attributi condivisi ---
  ('00000000-0000-0000-0f02-000000000001', '00000000-0000-0000-0f01-000000000001', null,
   'denominazione_alimento', 'Denominazione alimento', 'Denominazione legale di vendita del prodotto.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000002', '00000000-0000-0000-0f01-000000000001', null,
   'ingredienti', 'Ingredienti', 'Elenco completo degli ingredienti dichiarati.',
   'factual', 'long_text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000003', '00000000-0000-0000-0f01-000000000001', null,
   'allergeni', 'Allergeni', 'Allergeni dichiarati in etichetta.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000004', '00000000-0000-0000-0f01-000000000001', null,
   'peso_netto', 'Peso netto', 'Peso netto del prodotto.',
   'factual', 'measurement', 'g', 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000005', '00000000-0000-0000-0f01-000000000001', null,
   'conservazione', 'Conservazione', 'Modalita di conservazione dichiarate.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000006', '00000000-0000-0000-0f01-000000000001', null,
   'origine', 'Origine', 'Paese o luogo di origine dichiarato.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000007', '00000000-0000-0000-0f01-000000000001', null,
   'produttore', 'Produttore', 'Produttore o operatore responsabile dichiarato.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000008', '00000000-0000-0000-0f01-000000000001', null,
   'valori_nutrizionali', 'Valori nutrizionali', 'Tabella dei valori nutrizionali dichiarati.',
   'factual', 'long_text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000009', '00000000-0000-0000-0f01-000000000001', null,
   'scadenza', 'Scadenza', 'Termine minimo di conservazione o data di scadenza dichiarata.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-00000000000a', '00000000-0000-0000-0f01-000000000001', null,
   'lotto', 'Lotto', 'Numero di lotto dichiarato.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  -- --- Attributi specifici ---
  ('00000000-0000-0000-0f02-00000000000b', '00000000-0000-0000-0f01-000000000001', null,
   'gradazione_alcolica', 'Gradazione alcolica', 'Titolo alcolometrico volumico dichiarato.',
   'factual', 'percentage', '% vol', 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-00000000000c', '00000000-0000-0000-0f01-000000000001', null,
   'vitigno', 'Vitigno', 'Vitigno o uvaggio dichiarato.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-00000000000d', '00000000-0000-0000-0f01-000000000001', null,
   'annata', 'Annata', 'Anno di vendemmia dichiarato.',
   'factual', 'integer', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-00000000000e', '00000000-0000-0000-0f01-000000000001', null,
   'ibu', 'IBU', 'Indice di amaro (International Bitterness Units) dichiarato.',
   'factual', 'integer', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-00000000000f', '00000000-0000-0000-0f01-000000000001', null,
   'formato_bottiglia', 'Formato bottiglia', 'Formato o capacita della bottiglia/contenitore.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active'),

  ('00000000-0000-0000-0f02-000000000010', '00000000-0000-0000-0f01-000000000001', null,
   'tempo_cottura', 'Tempo di cottura', 'Tempo di cottura dichiarato.',
   'factual', 'text', null, 'Estrai esclusivamente il valore dichiarato in etichetta o nei dati forniti; non stimare e non inventare.', true, 'active')
on conflict (id) do nothing;


-- =====================================================================
-- 3. Categorie di sistema (owner null) del settore Food
-- =====================================================================

insert into categories (
  id, sector_id, owner_organization_id, key, name, description, is_system, status
)
values
  ('00000000-0000-0000-0f03-000000000001', '00000000-0000-0000-0f01-000000000001', null,
   'pasta_riso', 'Pasta e riso', 'Paste alimentari, riso e cereali secchi.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000002', '00000000-0000-0000-0f01-000000000001', null,
   'conserve', 'Conserve', 'Conserve alimentari in barattolo, vasetto o scatola.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000003', '00000000-0000-0000-0f01-000000000001', null,
   'salse_condimenti', 'Salse e condimenti', 'Salse, sughi e condimenti.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000004', '00000000-0000-0000-0f01-000000000001', null,
   'dolci', 'Dolci', 'Prodotti dolciari e da forno.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000005', '00000000-0000-0000-0f01-000000000001', null,
   'snack', 'Snack', 'Snack salati e dolci.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000006', '00000000-0000-0000-0f01-000000000001', null,
   'bevande_analcoliche', 'Bevande analcoliche', 'Bevande analcoliche, acque e succhi.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000007', '00000000-0000-0000-0f01-000000000001', null,
   'vini', 'Vini', 'Vini fermi, spumanti e frizzanti.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000008', '00000000-0000-0000-0f01-000000000001', null,
   'birre', 'Birre', 'Birre di ogni stile.', true, 'active'),
  ('00000000-0000-0000-0f03-000000000009', '00000000-0000-0000-0f01-000000000001', null,
   'liquori_distillati', 'Liquori e distillati', 'Liquori, amari e distillati.', true, 'active'),
  ('00000000-0000-0000-0f03-00000000000a', '00000000-0000-0000-0f01-000000000001', null,
   'oli', 'Oli', 'Oli alimentari e condimenti a base di olio.', true, 'active'),
  ('00000000-0000-0000-0f03-00000000000b', '00000000-0000-0000-0f01-000000000001', null,
   'freschi', 'Prodotti freschi', 'Prodotti freschi deperibili refrigerati.', true, 'active'),
  ('00000000-0000-0000-0f03-00000000000c', '00000000-0000-0000-0f01-000000000001', null,
   'surgelati', 'Prodotti surgelati', 'Prodotti surgelati e congelati.', true, 'active')
on conflict (id) do nothing;


-- =====================================================================
-- 4. Legami categoria -> attributo (category_attributes) del settore Food
-- =====================================================================
-- Sottoinsiemi sensati per categoria. denominazione_alimento e ingredienti
-- is_required dove appropriato. display_order sequenziale. Nessun duplicato:
-- si riutilizzano le righe attributo condivise. Join filtrato per sector_id.

insert into category_attributes (category_id, attribute_id, is_required, display_order)
select c.id, a.id, x.is_required, x.display_order
from (values
  -- Pasta e riso
  ('pasta_riso', 'denominazione_alimento', true,  1),
  ('pasta_riso', 'ingredienti',            true,  2),
  ('pasta_riso', 'allergeni',              false, 3),
  ('pasta_riso', 'peso_netto',             false, 4),
  ('pasta_riso', 'tempo_cottura',          false, 5),
  ('pasta_riso', 'conservazione',          false, 6),
  ('pasta_riso', 'origine',                false, 7),
  ('pasta_riso', 'produttore',             false, 8),
  ('pasta_riso', 'valori_nutrizionali',    false, 9),
  ('pasta_riso', 'scadenza',               false, 10),
  ('pasta_riso', 'lotto',                  false, 11),

  -- Conserve
  ('conserve', 'denominazione_alimento', true,  1),
  ('conserve', 'ingredienti',            true,  2),
  ('conserve', 'allergeni',              false, 3),
  ('conserve', 'peso_netto',             false, 4),
  ('conserve', 'conservazione',          false, 5),
  ('conserve', 'origine',                false, 6),
  ('conserve', 'produttore',             false, 7),
  ('conserve', 'valori_nutrizionali',    false, 8),
  ('conserve', 'scadenza',               false, 9),
  ('conserve', 'lotto',                  false, 10),

  -- Salse e condimenti
  ('salse_condimenti', 'denominazione_alimento', true,  1),
  ('salse_condimenti', 'ingredienti',            true,  2),
  ('salse_condimenti', 'allergeni',              false, 3),
  ('salse_condimenti', 'peso_netto',             false, 4),
  ('salse_condimenti', 'conservazione',          false, 5),
  ('salse_condimenti', 'origine',                false, 6),
  ('salse_condimenti', 'produttore',             false, 7),
  ('salse_condimenti', 'valori_nutrizionali',    false, 8),
  ('salse_condimenti', 'scadenza',               false, 9),
  ('salse_condimenti', 'lotto',                  false, 10),

  -- Dolci
  ('dolci', 'denominazione_alimento', true,  1),
  ('dolci', 'ingredienti',            true,  2),
  ('dolci', 'allergeni',              false, 3),
  ('dolci', 'peso_netto',             false, 4),
  ('dolci', 'conservazione',          false, 5),
  ('dolci', 'origine',                false, 6),
  ('dolci', 'produttore',             false, 7),
  ('dolci', 'valori_nutrizionali',    false, 8),
  ('dolci', 'scadenza',               false, 9),
  ('dolci', 'lotto',                  false, 10),

  -- Snack
  ('snack', 'denominazione_alimento', true,  1),
  ('snack', 'ingredienti',            true,  2),
  ('snack', 'allergeni',              false, 3),
  ('snack', 'peso_netto',             false, 4),
  ('snack', 'conservazione',          false, 5),
  ('snack', 'origine',                false, 6),
  ('snack', 'produttore',             false, 7),
  ('snack', 'valori_nutrizionali',    false, 8),
  ('snack', 'scadenza',               false, 9),
  ('snack', 'lotto',                  false, 10),

  -- Bevande analcoliche
  ('bevande_analcoliche', 'denominazione_alimento', true,  1),
  ('bevande_analcoliche', 'ingredienti',            true,  2),
  ('bevande_analcoliche', 'allergeni',              false, 3),
  ('bevande_analcoliche', 'conservazione',          false, 4),
  ('bevande_analcoliche', 'origine',                false, 5),
  ('bevande_analcoliche', 'produttore',             false, 6),
  ('bevande_analcoliche', 'valori_nutrizionali',    false, 7),
  ('bevande_analcoliche', 'formato_bottiglia',      false, 8),
  ('bevande_analcoliche', 'scadenza',               false, 9),
  ('bevande_analcoliche', 'lotto',                  false, 10),

  -- Vini
  ('vini', 'denominazione_alimento', true,  1),
  ('vini', 'allergeni',              false, 2),
  ('vini', 'conservazione',          false, 3),
  ('vini', 'origine',                false, 4),
  ('vini', 'produttore',             false, 5),
  ('vini', 'gradazione_alcolica',    true,  6),
  ('vini', 'vitigno',                false, 7),
  ('vini', 'annata',                 false, 8),
  ('vini', 'formato_bottiglia',      false, 9),
  ('vini', 'lotto',                  false, 10),

  -- Birre
  ('birre', 'denominazione_alimento', true,  1),
  ('birre', 'ingredienti',            false, 2),
  ('birre', 'allergeni',              false, 3),
  ('birre', 'conservazione',          false, 4),
  ('birre', 'origine',                false, 5),
  ('birre', 'produttore',             false, 6),
  ('birre', 'gradazione_alcolica',    true,  7),
  ('birre', 'ibu',                    false, 8),
  ('birre', 'formato_bottiglia',      false, 9),
  ('birre', 'lotto',                  false, 10),

  -- Liquori e distillati
  ('liquori_distillati', 'denominazione_alimento', true,  1),
  ('liquori_distillati', 'ingredienti',            false, 2),
  ('liquori_distillati', 'allergeni',              false, 3),
  ('liquori_distillati', 'conservazione',          false, 4),
  ('liquori_distillati', 'origine',                false, 5),
  ('liquori_distillati', 'produttore',             false, 6),
  ('liquori_distillati', 'gradazione_alcolica',    true,  7),
  ('liquori_distillati', 'formato_bottiglia',      false, 8),
  ('liquori_distillati', 'lotto',                  false, 9),

  -- Oli
  ('oli', 'denominazione_alimento', true,  1),
  ('oli', 'ingredienti',            false, 2),
  ('oli', 'allergeni',              false, 3),
  ('oli', 'peso_netto',             false, 4),
  ('oli', 'conservazione',          false, 5),
  ('oli', 'origine',                false, 6),
  ('oli', 'produttore',             false, 7),
  ('oli', 'valori_nutrizionali',    false, 8),
  ('oli', 'scadenza',               false, 9),
  ('oli', 'lotto',                  false, 10),

  -- Prodotti freschi
  ('freschi', 'denominazione_alimento', true,  1),
  ('freschi', 'ingredienti',            true,  2),
  ('freschi', 'allergeni',              false, 3),
  ('freschi', 'peso_netto',             false, 4),
  ('freschi', 'conservazione',          false, 5),
  ('freschi', 'origine',                false, 6),
  ('freschi', 'produttore',             false, 7),
  ('freschi', 'valori_nutrizionali',    false, 8),
  ('freschi', 'scadenza',               false, 9),
  ('freschi', 'lotto',                  false, 10),

  -- Prodotti surgelati
  ('surgelati', 'denominazione_alimento', true,  1),
  ('surgelati', 'ingredienti',            true,  2),
  ('surgelati', 'allergeni',              false, 3),
  ('surgelati', 'peso_netto',             false, 4),
  ('surgelati', 'conservazione',          false, 5),
  ('surgelati', 'origine',                false, 6),
  ('surgelati', 'produttore',             false, 7),
  ('surgelati', 'valori_nutrizionali',    false, 8),
  ('surgelati', 'scadenza',               false, 9),
  ('surgelati', 'lotto',                  false, 10)
) as x(cat_key, attr_key, is_required, display_order)
join categories c
  on c.key = x.cat_key
 and c.sector_id = '00000000-0000-0000-0f01-000000000001'
 and c.owner_organization_id is null
join attributes a
  on a.key = x.attr_key
 and a.sector_id = '00000000-0000-0000-0f01-000000000001'
 and a.owner_organization_id is null
on conflict (category_id, attribute_id) do nothing;


-- #####################################################################
-- SETTORE PHARMA
-- #####################################################################
-- Vedi il blocco "REGOLE DI SICUREZZA PHARMA" in testa al file: nessun
-- consiglio medico, nessuna diagnosi, nessuna indicazione terapeutica
-- inventata, nessuna modifica di dosaggi, nessun claim di efficacia; si
-- copiano solo i dati DICHIARATI preservandone provenienza ed evidenza.

-- =====================================================================
-- 5. Settore Pharma
-- =====================================================================

insert into sectors (id, key, name, description, icon, is_system, status)
values (
  '00000000-0000-0000-0f04-000000000001',
  'pharma',
  'Pharma',
  'Prodotti parafarmaceutici, integratori, cosmetici e catalogo OTC (solo dati dichiarati).',
  'pill',
  true,
  'active'
)
on conflict (id) do nothing;


-- =====================================================================
-- 6. Libreria condivisa di attributi Pharma (attributi di sistema, owner null)
-- =====================================================================
-- attribute_kind = 'factual'. Ogni istruzione di estrazione ribadisce che il
-- dato e' DICHIARATO dal produttore, va copiato/normalizzato senza alterarne
-- il significato, e VIETA claim clinici, dosaggi, indicazioni terapeutiche o
-- inferenze sanitarie.

insert into attributes (
  id, sector_id, owner_organization_id, key, name, description,
  attribute_kind, data_type, unit, default_extraction_instruction,
  is_system, status
)
values
  ('00000000-0000-0000-0f05-000000000001', '00000000-0000-0000-0f04-000000000001', null,
   'nome_commerciale', 'Nome commerciale', 'Nome commerciale dichiarato del prodotto.',
   'factual', 'text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza senza modificarne il significato. Non generare indicazioni terapeutiche, dosaggi, controindicazioni o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000002', '00000000-0000-0000-0f04-000000000001', null,
   'forma', 'Forma', 'Forma del prodotto dichiarata (es. compressa, crema, sciroppo).',
   'factual', 'text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza senza modificarne il significato. Non generare indicazioni terapeutiche, dosaggi, controindicazioni o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000003', '00000000-0000-0000-0f04-000000000001', null,
   'formato', 'Formato', 'Formato dichiarato (es. numero di unita, volume, peso).',
   'factual', 'text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza senza modificarne il significato. Non generare indicazioni terapeutiche, dosaggi, controindicazioni o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000004', '00000000-0000-0000-0f04-000000000001', null,
   'confezione', 'Confezione', 'Tipo di confezione dichiarato.',
   'factual', 'text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza senza modificarne il significato. Non generare indicazioni terapeutiche, dosaggi, controindicazioni o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000005', '00000000-0000-0000-0f04-000000000001', null,
   'composizione_dichiarata', 'Composizione dichiarata', 'Composizione/ingredienti come dichiarati in etichetta.',
   'factual', 'long_text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza la composizione senza modificarne il significato e senza aggiungere elementi. NON inventare ingredienti, quantita o proprieta; non generare indicazioni terapeutiche, dosaggi o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000006', '00000000-0000-0000-0f04-000000000001', null,
   'modalita_uso_dichiarata', 'Modalita d uso dichiarata', 'Modalita d uso come dichiarate dal produttore.',
   'factual', 'long_text', null,
   'Dato DICHIARATO dal produttore: riporta le modalita d uso esattamente come dichiarate, senza modificarle. NON modificare ne suggerire dosaggi o posologie; non generare indicazioni terapeutiche o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000007', '00000000-0000-0000-0f04-000000000001', null,
   'avvertenze_dichiarate', 'Avvertenze dichiarate', 'Avvertenze e precauzioni come dichiarate in etichetta.',
   'factual', 'long_text', null,
   'Dato DICHIARATO dal produttore: riporta le avvertenze esattamente come dichiarate. NON inventare, ampliare o attenuare avvertenze, controindicazioni o effetti; non generare indicazioni terapeutiche, dosaggi o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000008', '00000000-0000-0000-0f04-000000000001', null,
   'conservazione', 'Conservazione', 'Modalita di conservazione dichiarate.',
   'factual', 'text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza senza modificarne il significato. Non generare indicazioni terapeutiche, dosaggi, controindicazioni o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-000000000009', '00000000-0000-0000-0f04-000000000001', null,
   'produttore', 'Produttore', 'Produttore o distributore dichiarato.',
   'factual', 'text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza senza modificarne il significato. Non generare indicazioni terapeutiche, dosaggi, controindicazioni o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active'),

  ('00000000-0000-0000-0f05-00000000000a', '00000000-0000-0000-0f04-000000000001', null,
   'codice_identificativo', 'Codice identificativo', 'Codice identificativo dichiarato (es. AIC, EAN, codice prodotto).',
   'factual', 'text', null,
   'Dato DICHIARATO dal produttore: copia o normalizza senza modificarne il significato. Non generare indicazioni terapeutiche, dosaggi, controindicazioni o claim di efficacia o sicurezza; nessuna inferenza clinica; preserva la provenienza del dato.',
   true, 'active')
on conflict (id) do nothing;


-- =====================================================================
-- 7. Categorie di sistema (owner null) del settore Pharma
-- =====================================================================

insert into categories (
  id, sector_id, owner_organization_id, key, name, description, is_system, status
)
values
  ('00000000-0000-0000-0f06-000000000001', '00000000-0000-0000-0f04-000000000001', null,
   'integratori', 'Integratori', 'Integratori alimentari (solo dati dichiarati).', true, 'active'),
  ('00000000-0000-0000-0f06-000000000002', '00000000-0000-0000-0f04-000000000001', null,
   'cosmetici', 'Cosmetici', 'Prodotti cosmetici (solo dati dichiarati).', true, 'active'),
  ('00000000-0000-0000-0f06-000000000003', '00000000-0000-0000-0f04-000000000001', null,
   'dispositivi_medici', 'Dispositivi medici', 'Dispositivi medici a catalogo (solo dati dichiarati).', true, 'active'),
  ('00000000-0000-0000-0f06-000000000004', '00000000-0000-0000-0f04-000000000001', null,
   'igiene', 'Prodotti per igiene', 'Prodotti per l igiene personale (solo dati dichiarati).', true, 'active'),
  ('00000000-0000-0000-0f06-000000000005', '00000000-0000-0000-0f04-000000000001', null,
   'otc_info', 'Informazioni catalogo OTC', 'Informazioni descrittive di catalogo per prodotti OTC (solo dati dichiarati, nessun consiglio medico).', true, 'active'),
  ('00000000-0000-0000-0f06-000000000006', '00000000-0000-0000-0f04-000000000001', null,
   'dermocosmesi', 'Dermocosmesi', 'Prodotti dermocosmetici (solo dati dichiarati).', true, 'active')
on conflict (id) do nothing;


-- =====================================================================
-- 8. Legami categoria -> attributo (category_attributes) del settore Pharma
-- =====================================================================
-- Tutti gli attributi condivisi Pharma sono collegati a tutte le categorie
-- Pharma (cross join filtrato per sector_id). nome_commerciale is_required;
-- gli altri opzionali. composizione_dichiarata e avvertenze_dichiarate sono
-- presenti ma le loro istruzioni vietano l invenzione di dati.

insert into category_attributes (category_id, attribute_id, is_required, display_order)
select c.id, a.id, x.is_required, x.display_order
from (values
  ('nome_commerciale',        true,  1),
  ('forma',                   false, 2),
  ('formato',                 false, 3),
  ('confezione',              false, 4),
  ('composizione_dichiarata', false, 5),
  ('modalita_uso_dichiarata', false, 6),
  ('avvertenze_dichiarate',   false, 7),
  ('conservazione',           false, 8),
  ('produttore',              false, 9),
  ('codice_identificativo',   false, 10)
) as x(attr_key, is_required, display_order)
join attributes a
  on a.key = x.attr_key
 and a.sector_id = '00000000-0000-0000-0f04-000000000001'
 and a.owner_organization_id is null
join categories c
  on c.sector_id = '00000000-0000-0000-0f04-000000000001'
 and c.owner_organization_id is null
on conflict (category_id, attribute_id) do nothing;
