-- =====================================================================
-- Seed del catalogo di CONFIGURAZIONE di sistema per il settore "Moda".
--
-- Idempotente: usa id fissi (deterministici) con on conflict (id) do nothing
-- e on conflict sulle chiavi naturali dove presenti. Rieseguibile in blocco
-- via Supabase Management API.
--
-- Struttura:
--   1. Settore "moda"
--   2. Libreria condivisa di attributi di sistema (owner null) - creati UNA
--      sola volta e riutilizzati tra le categorie via category_attributes.
--   3. 13 categorie di sistema (owner null)
--   4. Legami categoria -> attributo (sottoinsiemi sensati, niente duplicati)
-- =====================================================================


-- =====================================================================
-- 1. Settore Moda
-- =====================================================================

insert into sectors (id, key, name, description, icon, is_system, status)
values (
  '00000000-0000-0000-0001-000000000001',
  'moda',
  'Moda',
  'Abbigliamento, calzature e accessori moda.',
  'shirt',
  true,
  'active'
)
on conflict (id) do nothing;


-- =====================================================================
-- 2. Libreria condivisa di attributi (attributi di sistema, owner null)
-- =====================================================================
-- Ogni attributo esiste una sola volta ed e' riutilizzato dalle categorie.
-- attribute_kind = 'factual' per tutti (dati verificabili, non generati).
-- default_extraction_instruction in italiano: estrazione conservativa.

insert into attributes (
  id, sector_id, owner_organization_id, key, name, description,
  attribute_kind, data_type, unit, default_extraction_instruction,
  is_system, status
)
values
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', null,
   'materiale', 'Materiale', 'Materiale principale del capo.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000001', null,
   'composizione', 'Composizione', 'Composizione tessile completa (es. 100% cotone).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0001-000000000001', null,
   'colore', 'Colore', 'Colore principale.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0001-000000000001', null,
   'colore_secondario', 'Colore secondario', 'Eventuale colore secondario.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0001-000000000001', null,
   'fantasia', 'Fantasia', 'Fantasia o stampa (es. tinta unita, rigato, floreale).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000006', '00000000-0000-0000-0001-000000000001', null,
   'vestibilita', 'Vestibilita', 'Vestibilita del capo (es. slim, regular, oversize).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0001-000000000001', null,
   'scollo', 'Scollo', 'Tipo di scollatura.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000008', '00000000-0000-0000-0001-000000000001', null,
   'lunghezza_manica', 'Lunghezza manica', 'Lunghezza della manica.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000009', '00000000-0000-0000-0001-000000000001', null,
   'lunghezza_capo', 'Lunghezza capo', 'Lunghezza complessiva del capo.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000000a', '00000000-0000-0000-0001-000000000001', null,
   'chiusura', 'Chiusura', 'Tipo di chiusura (es. bottoni, zip, lacci).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000000b', '00000000-0000-0000-0001-000000000001', null,
   'fodera', 'Fodera', 'Presenza e materiale della fodera.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000000c', '00000000-0000-0000-0001-000000000001', null,
   'tasche', 'Tasche', 'Numero e tipo di tasche.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000000d', '00000000-0000-0000-0001-000000000001', null,
   'dettagli', 'Dettagli', 'Dettagli distintivi del capo.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000000e', '00000000-0000-0000-0001-000000000001', null,
   'istruzioni_lavaggio', 'Istruzioni di lavaggio', 'Istruzioni di lavaggio e manutenzione.',
   'factual', 'long_text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000000f', '00000000-0000-0000-0001-000000000001', null,
   'vita', 'Vita', 'Altezza della vita (es. alta, regolare, bassa).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000010', '00000000-0000-0000-0001-000000000001', null,
   'tipo_gamba', 'Tipo di gamba', 'Taglio della gamba (es. dritto, skinny, wide).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000011', '00000000-0000-0000-0001-000000000001', null,
   'tipologia', 'Tipologia', 'Tipologia specifica del prodotto.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000012', '00000000-0000-0000-0001-000000000001', null,
   'materiale_tomaia', 'Materiale tomaia', 'Materiale della tomaia (calzature).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000013', '00000000-0000-0000-0001-000000000001', null,
   'materiale_interno', 'Materiale interno', 'Materiale interno/fodera (calzature).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000014', '00000000-0000-0000-0001-000000000001', null,
   'materiale_suola', 'Materiale suola', 'Materiale della suola (calzature).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000015', '00000000-0000-0000-0001-000000000001', null,
   'altezza_tacco', 'Altezza tacco', 'Altezza del tacco in centimetri.',
   'factual', 'measurement', 'cm', 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000016', '00000000-0000-0000-0001-000000000001', null,
   'forma_punta', 'Forma punta', 'Forma della punta (calzature).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000017', '00000000-0000-0000-0001-000000000001', null,
   'dimensioni', 'Dimensioni', 'Dimensioni (es. LxAxP) del prodotto.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000018', '00000000-0000-0000-0001-000000000001', null,
   'tracolla', 'Tracolla', 'Presenza e caratteristiche della tracolla (borse).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-000000000019', '00000000-0000-0000-0001-000000000001', null,
   'manici', 'Manici', 'Presenza e caratteristiche dei manici (borse).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000001a', '00000000-0000-0000-0001-000000000001', null,
   'scomparti', 'Scomparti', 'Numero e tipo di scomparti interni (borse).',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000001b', '00000000-0000-0000-0001-000000000001', null,
   'paese_origine', 'Paese di origine', 'Paese di produzione/origine.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active'),

  ('00000000-0000-0000-0002-00000000001c', '00000000-0000-0000-0001-000000000001', null,
   'sostenibilita', 'Sostenibilita', 'Claim o certificazioni di sostenibilita.',
   'factual', 'text', null, 'Estrai esclusivamente il valore presente nei dati; non stimare.', true, 'active')
on conflict (id) do nothing;


-- =====================================================================
-- 3. Categorie di sistema (owner null) del settore Moda
-- =====================================================================

insert into categories (
  id, sector_id, owner_organization_id, key, name, description, is_system, status
)
values
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000001', null,
   'tshirt', 'T-shirt e magliette', 'Magliette a maniche corte o lunghe in maglina.', true, 'active'),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0001-000000000001', null,
   'camicie', 'Camicie', 'Camicie in tessuto con abbottonatura.', true, 'active'),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0001-000000000001', null,
   'felpe', 'Felpe', 'Felpe in cotone garzato, con o senza cappuccio.', true, 'active'),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0001-000000000001', null,
   'maglioni', 'Maglioni', 'Maglieria pesante (pullover, cardigan).', true, 'active'),
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0001-000000000001', null,
   'giacche', 'Giacche', 'Giacche e blazer.', true, 'active'),
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0001-000000000001', null,
   'cappotti', 'Cappotti', 'Capispalla pesanti (cappotti, trench).', true, 'active'),
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0001-000000000001', null,
   'pantaloni', 'Pantaloni', 'Pantaloni in tessuto.', true, 'active'),
  ('00000000-0000-0000-0003-000000000008', '00000000-0000-0000-0001-000000000001', null,
   'jeans', 'Jeans', 'Pantaloni in denim.', true, 'active'),
  ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0001-000000000001', null,
   'gonne', 'Gonne', 'Gonne di ogni lunghezza e taglio.', true, 'active'),
  ('00000000-0000-0000-0003-00000000000a', '00000000-0000-0000-0001-000000000001', null,
   'abiti', 'Abiti', 'Abiti e vestiti interi.', true, 'active'),
  ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0001-000000000001', null,
   'scarpe', 'Scarpe', 'Calzature di ogni tipo.', true, 'active'),
  ('00000000-0000-0000-0003-00000000000c', '00000000-0000-0000-0001-000000000001', null,
   'borse', 'Borse', 'Borse e accessori di pelletteria.', true, 'active'),
  ('00000000-0000-0000-0003-00000000000d', '00000000-0000-0000-0001-000000000001', null,
   'accessori', 'Accessori', 'Accessori moda vari (cinture, cappelli, sciarpe).', true, 'active')
on conflict (id) do nothing;


-- =====================================================================
-- 4. Legami categoria -> attributo (category_attributes)
-- =====================================================================
-- Guidati dalle chiavi naturali (robusto e riutilizzabile). Sottoinsiemi
-- sensati per categoria; gli attributi core (materiale/composizione/colore,
-- o tipologia/materiale_tomaia per calzature) sono is_required. display_order
-- sequenziale. Nessun duplicato: si riutilizzano le righe attributo condivise.

insert into category_attributes (category_id, attribute_id, is_required, display_order)
select c.id, a.id, x.is_required, x.display_order
from (values
  -- T-shirt e magliette
  ('tshirt', 'materiale',           true,  1),
  ('tshirt', 'composizione',        true,  2),
  ('tshirt', 'colore',              true,  3),
  ('tshirt', 'fantasia',            false, 4),
  ('tshirt', 'vestibilita',         false, 5),
  ('tshirt', 'scollo',              false, 6),
  ('tshirt', 'lunghezza_manica',    false, 7),
  ('tshirt', 'lunghezza_capo',      false, 8),
  ('tshirt', 'dettagli',            false, 9),
  ('tshirt', 'istruzioni_lavaggio', false, 10),

  -- Camicie
  ('camicie', 'materiale',           true,  1),
  ('camicie', 'composizione',        true,  2),
  ('camicie', 'colore',              true,  3),
  ('camicie', 'fantasia',            false, 4),
  ('camicie', 'vestibilita',         false, 5),
  ('camicie', 'scollo',              false, 6),
  ('camicie', 'lunghezza_manica',    false, 7),
  ('camicie', 'chiusura',            false, 8),
  ('camicie', 'tasche',              false, 9),
  ('camicie', 'dettagli',            false, 10),
  ('camicie', 'istruzioni_lavaggio', false, 11),

  -- Felpe
  ('felpe', 'materiale',           true,  1),
  ('felpe', 'composizione',        true,  2),
  ('felpe', 'colore',              true,  3),
  ('felpe', 'fantasia',            false, 4),
  ('felpe', 'vestibilita',         false, 5),
  ('felpe', 'scollo',              false, 6),
  ('felpe', 'lunghezza_manica',    false, 7),
  ('felpe', 'chiusura',            false, 8),
  ('felpe', 'tasche',              false, 9),
  ('felpe', 'dettagli',            false, 10),
  ('felpe', 'istruzioni_lavaggio', false, 11),

  -- Maglioni
  ('maglioni', 'materiale',           true,  1),
  ('maglioni', 'composizione',        true,  2),
  ('maglioni', 'colore',              true,  3),
  ('maglioni', 'fantasia',            false, 4),
  ('maglioni', 'vestibilita',         false, 5),
  ('maglioni', 'scollo',              false, 6),
  ('maglioni', 'lunghezza_manica',    false, 7),
  ('maglioni', 'dettagli',            false, 8),
  ('maglioni', 'istruzioni_lavaggio', false, 9),

  -- Giacche
  ('giacche', 'materiale',           true,  1),
  ('giacche', 'composizione',        true,  2),
  ('giacche', 'colore',              true,  3),
  ('giacche', 'vestibilita',         false, 4),
  ('giacche', 'chiusura',            false, 5),
  ('giacche', 'fodera',              false, 6),
  ('giacche', 'tasche',              false, 7),
  ('giacche', 'lunghezza_manica',    false, 8),
  ('giacche', 'lunghezza_capo',      false, 9),
  ('giacche', 'dettagli',            false, 10),
  ('giacche', 'istruzioni_lavaggio', false, 11),

  -- Cappotti
  ('cappotti', 'materiale',           true,  1),
  ('cappotti', 'composizione',        true,  2),
  ('cappotti', 'colore',              true,  3),
  ('cappotti', 'vestibilita',         false, 4),
  ('cappotti', 'chiusura',            false, 5),
  ('cappotti', 'fodera',              false, 6),
  ('cappotti', 'tasche',              false, 7),
  ('cappotti', 'lunghezza_manica',    false, 8),
  ('cappotti', 'lunghezza_capo',      false, 9),
  ('cappotti', 'dettagli',            false, 10),
  ('cappotti', 'istruzioni_lavaggio', false, 11),

  -- Pantaloni
  ('pantaloni', 'materiale',           true,  1),
  ('pantaloni', 'composizione',        true,  2),
  ('pantaloni', 'colore',              true,  3),
  ('pantaloni', 'vestibilita',         false, 4),
  ('pantaloni', 'vita',                false, 5),
  ('pantaloni', 'lunghezza_capo',      false, 6),
  ('pantaloni', 'tipo_gamba',          false, 7),
  ('pantaloni', 'chiusura',            false, 8),
  ('pantaloni', 'tasche',              false, 9),
  ('pantaloni', 'dettagli',            false, 10),
  ('pantaloni', 'istruzioni_lavaggio', false, 11),

  -- Jeans
  ('jeans', 'materiale',           true,  1),
  ('jeans', 'composizione',        true,  2),
  ('jeans', 'colore',              true,  3),
  ('jeans', 'vestibilita',         false, 4),
  ('jeans', 'vita',                false, 5),
  ('jeans', 'lunghezza_capo',      false, 6),
  ('jeans', 'tipo_gamba',          false, 7),
  ('jeans', 'chiusura',            false, 8),
  ('jeans', 'tasche',              false, 9),
  ('jeans', 'dettagli',            false, 10),
  ('jeans', 'istruzioni_lavaggio', false, 11),

  -- Gonne
  ('gonne', 'materiale',           true,  1),
  ('gonne', 'composizione',        true,  2),
  ('gonne', 'colore',              true,  3),
  ('gonne', 'fantasia',            false, 4),
  ('gonne', 'vestibilita',         false, 5),
  ('gonne', 'vita',                false, 6),
  ('gonne', 'lunghezza_capo',      false, 7),
  ('gonne', 'chiusura',            false, 8),
  ('gonne', 'dettagli',            false, 9),
  ('gonne', 'istruzioni_lavaggio', false, 10),

  -- Abiti
  ('abiti', 'materiale',           true,  1),
  ('abiti', 'composizione',        true,  2),
  ('abiti', 'colore',              true,  3),
  ('abiti', 'fantasia',            false, 4),
  ('abiti', 'vestibilita',         false, 5),
  ('abiti', 'scollo',              false, 6),
  ('abiti', 'lunghezza_manica',    false, 7),
  ('abiti', 'lunghezza_capo',      false, 8),
  ('abiti', 'chiusura',            false, 9),
  ('abiti', 'fodera',              false, 10),
  ('abiti', 'dettagli',            false, 11),
  ('abiti', 'istruzioni_lavaggio', false, 12),

  -- Scarpe
  ('scarpe', 'tipologia',         true,  1),
  ('scarpe', 'materiale_tomaia',  true,  2),
  ('scarpe', 'materiale_interno', false, 3),
  ('scarpe', 'materiale_suola',   false, 4),
  ('scarpe', 'colore',            true,  5),
  ('scarpe', 'chiusura',          false, 6),
  ('scarpe', 'altezza_tacco',     false, 7),
  ('scarpe', 'forma_punta',       false, 8),
  ('scarpe', 'vestibilita',       false, 9),
  ('scarpe', 'dettagli',          false, 10),

  -- Borse
  ('borse', 'tipologia',  true,  1),
  ('borse', 'materiale',  true,  2),
  ('borse', 'colore',     true,  3),
  ('borse', 'dimensioni', false, 4),
  ('borse', 'chiusura',   false, 5),
  ('borse', 'tracolla',   false, 6),
  ('borse', 'manici',     false, 7),
  ('borse', 'scomparti',  false, 8),
  ('borse', 'dettagli',   false, 9),

  -- Accessori
  ('accessori', 'tipologia',  true,  1),
  ('accessori', 'materiale',  false, 2),
  ('accessori', 'colore',     true,  3),
  ('accessori', 'dimensioni', false, 4),
  ('accessori', 'dettagli',   false, 5)
) as x(cat_key, attr_key, is_required, display_order)
join categories c on c.key = x.cat_key and c.owner_organization_id is null
join attributes a on a.key = x.attr_key and a.owner_organization_id is null
on conflict (category_id, attribute_id) do nothing;
