import type { PresetFieldDef } from './types.js';

// ---------------------------------------------------------------------------
// Preset "Moda" — definizione dei campi fattuali e dei sinonimi intestazione.
// Questo è lo stesso contenuto seed-ato in DB (preset_versions v1); qui serve
// alla logica pura di web/worker/test senza round-trip al database.
// ---------------------------------------------------------------------------

export const MODA_PRESET_KEY = 'moda';
export const MODA_PRESET_VERSION = 'moda-v1';

/** Campi fattuali del preset Moda con sinonimi IT/EN. */
export const MODA_FIELDS: PresetFieldDef[] = [
  { key: 'external_id', label: 'ID esterno', factual: true, synonyms: ['external id', 'id', 'id prodotto', 'product id'] },
  { key: 'parent_external_id', label: 'ID padre', factual: true, synonyms: ['parent id', 'codice padre', 'group id', 'id gruppo', 'gruppo', 'parent external id'] },
  { key: 'sku', label: 'SKU', factual: true, synonyms: ['sku', 'codice', 'codice articolo', 'codice prodotto', 'article code', 'cod', 'cod articolo'] },
  { key: 'product_name', label: 'Nome prodotto', factual: true, synonyms: ['nome', 'titolo', 'nome prodotto', 'product name', 'title', 'denominazione'] },
  { key: 'product_type', label: 'Tipologia', factual: true, synonyms: ['tipo', 'tipologia', 'product type', 'type', 'categoria merceologica'] },
  { key: 'category', label: 'Categoria', factual: true, synonyms: ['categoria', 'category', 'reparto'] },
  { key: 'brand', label: 'Brand', factual: true, synonyms: ['brand', 'marca', 'marchio'] },
  { key: 'gender', label: 'Genere', factual: true, synonyms: ['genere', 'gender', 'sesso', 'target'] },
  { key: 'collection', label: 'Collezione', factual: true, synonyms: ['collezione', 'collection', 'linea'] },
  { key: 'season', label: 'Stagione', factual: true, synonyms: ['stagione', 'season', 'stagionalità'] },
  { key: 'color', label: 'Colore', factual: true, synonyms: ['colore', 'color', 'colour', 'colore principale'] },
  { key: 'secondary_color', label: 'Colore secondario', factual: true, synonyms: ['colore secondario', 'secondary color', 'secondary colour'] },
  { key: 'pattern', label: 'Fantasia', factual: true, synonyms: ['fantasia', 'pattern', 'motivo', 'stampa'] },
  { key: 'material', label: 'Materiale', factual: true, synonyms: ['materiale', 'material', 'tessuto', 'fabric'] },
  { key: 'composition', label: 'Composizione', factual: true, synonyms: ['composizione', 'composizione tessuto', 'fabric composition', 'composition', 'composizione materiale'] },
  { key: 'fit', label: 'Vestibilità', factual: true, synonyms: ['fit', 'vestibilità', 'vestibilita', 'fitting', 'taglio'] },
  { key: 'neckline', label: 'Scollo', factual: true, synonyms: ['scollo', 'collo', 'neckline', 'scollatura'] },
  { key: 'sleeve_length', label: 'Lunghezza maniche', factual: true, synonyms: ['maniche', 'lunghezza maniche', 'sleeve length', 'sleeve'] },
  { key: 'closure', label: 'Chiusura', factual: true, synonyms: ['chiusura', 'closure', 'allacciatura'] },
  { key: 'length', label: 'Lunghezza', factual: true, synonyms: ['lunghezza', 'length', 'altezza'] },
  { key: 'details', label: 'Dettagli', factual: true, synonyms: ['dettagli', 'details', 'caratteristiche', 'note'] },
  { key: 'sizes', label: 'Taglie', factual: true, synonyms: ['taglie', 'sizes', 'taglia', 'size'] },
  { key: 'measurements', label: 'Misure', factual: true, synonyms: ['misure', 'measurements', 'dimensioni'] },
  { key: 'care_instructions', label: 'Lavaggio', factual: true, synonyms: ['lavaggio', 'istruzioni di lavaggio', 'care instructions', 'care', 'manutenzione'] },
  { key: 'country_of_origin', label: 'Paese di origine', factual: true, synonyms: ['paese di origine', 'paese origine', 'origine', 'country of origin', 'made in'] },
  { key: 'sustainability_claims', label: 'Sostenibilità', factual: true, synonyms: ['sostenibilità', 'sustainability', 'sustainability claims', 'certificazioni', 'eco'] },
  { key: 'other_facts', label: 'Altri fatti', factual: true, synonyms: ['altri fatti', 'other facts', 'extra', 'info aggiuntive'] },
  { key: 'image_names', label: 'Immagini', factual: false, synonyms: ['immagini', 'image names', 'images', 'foto', 'image'] },
];

/** Chiavi dei campi identificativo. */
export const IDENTIFIER_FIELDS = ['external_id', 'sku'] as const;
/** Chiavi che soddisfano "nome o tipologia". */
export const NAME_FIELDS = ['product_name', 'product_type'] as const;

/** Campi che NON contano come "attributo fattuale aggiuntivo" per l'eleggibilità. */
export const NON_ADDITIONAL_FIELDS = new Set<string>([
  'external_id',
  'sku',
  'product_name',
  'product_type',
  'parent_external_id',
  'image_names',
]);

export function getFieldDef(key: string): PresetFieldDef | undefined {
  return MODA_FIELDS.find((f) => f.key === key);
}

/** Mappa sinonimo-normalizzato -> fieldKey (costruita una volta). */
export function buildSynonymIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  for (const field of MODA_FIELDS) {
    // Il nome del campo stesso è un sinonimo implicito.
    idx.set(normalizeToken(field.key), field.key);
    for (const syn of field.synonyms) {
      idx.set(normalizeToken(syn), field.key);
    }
  }
  return idx;
}

/** Normalizza un token intestazione per il match deterministico. */
export function normalizeToken(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti (combining marks)
    .replace(/[_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
