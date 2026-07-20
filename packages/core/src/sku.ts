// ---------------------------------------------------------------------------
// SKU come chiave universale del prodotto. Collega righe, immagini, file Drive,
// output, varianti, errori. Regole rigide: nessuna generazione automatica,
// nessun fallback silenzioso sul nome.
// ---------------------------------------------------------------------------

/** Tipi immagine suggeribili dal suffisso del nome file (NON usati per l'associazione). */
export const IMAGE_TYPES = [
  'front',
  'back',
  'detail',
  'label',
  'nutritional',
  'ingredients',
  'pack',
  'side',
  'other',
] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** Estensioni immagine ammesse. */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/** Separatori ammessi fra lo SKU e il resto del nome file. */
export const SKU_DELIMITERS = ['_', '-', '.', ' '] as const;
export type SkuDelimiter = (typeof SKU_DELIMITERS)[number];

/**
 * Estrae lo SKU dal nome file immagine: è la parte PRIMA del primo separatore
 * scelto (default underscore). Lo SKU non può contenere il separatore; può
 * contenere lettere, numeri, trattini e punti.
 *
 *   TSHIRT001_front.jpg              → "TSHIRT001"      (delim "_")
 *   ABC-123_1.webp                   → "ABC-123"        (delim "_")
 *   100356-image_IT.jpg  (delim "-") → "100356"
 *   front.jpg                        → null    (nessun separatore)
 */
export function extractSkuFromFilename(
  filename: string,
  delimiter: SkuDelimiter | string = '_',
): string | null {
  if (!filename) return null;
  // Scarta eventuale percorso, tiene solo il nome file.
  const base = filename.split(/[\\/]/).pop() ?? filename;
  // Rimuovi l'estensione immagine, così lo SKU non la include (indispensabile
  // se il separatore scelto è ".").
  let name = base;
  for (const ext of IMAGE_EXTENSIONS) {
    if (name.toLowerCase().endsWith(ext)) {
      name = name.slice(0, name.length - ext.length);
      break;
    }
  }
  const idx = name.indexOf(delimiter);
  if (idx <= 0) return null; // nessun separatore o separatore iniziale
  const candidate = name.slice(0, idx).trim();
  if (!/^[A-Za-z0-9.-]+$/.test(candidate)) return null;
  return candidate;
}

/** Suggerisce il tipo immagine dal suffisso del nome file. */
export function suggestImageType(filename: string): ImageType {
  const lower = filename.toLowerCase();
  for (const t of IMAGE_TYPES) {
    if (t === 'other') continue;
    if (lower.includes(t)) return t;
  }
  return 'other';
}

/** True se il nome file ha un'estensione immagine ammessa. */
export function isSupportedImage(filename: string): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type ImageFileStatus =
  | 'valid'
  | 'missing_sku'
  | 'unsupported_format'
  | 'duplicate_file'
  | 'empty_file'
  | 'unmatched';

export interface ClassifiedImage {
  filename: string;
  sku: string | null;
  type: ImageType;
  status: ImageFileStatus;
}

export interface ImageGroup {
  sku: string;
  images: ClassifiedImage[];
}

export interface ImageAnalysis {
  groups: ImageGroup[];
  invalid: ClassifiedImage[]; // file non associabili (missing_sku / unsupported / empty)
  skus: string[]; // SKU distinti individuati
}

/**
 * Raggruppa i file immagine per SKU. I file senza SKU valido o con formato non
 * supportato finiscono in `invalid`. `emptyFilenames` marca i file vuoti.
 */
export function groupImagesBySku(
  filenames: string[],
  opts?: { emptyFilenames?: Set<string> },
): ImageAnalysis {
  const empty = opts?.emptyFilenames ?? new Set<string>();
  const groups = new Map<string, ClassifiedImage[]>();
  const invalid: ClassifiedImage[] = [];
  const seen = new Set<string>();

  for (const filename of filenames) {
    const type = suggestImageType(filename);
    if (empty.has(filename)) {
      invalid.push({ filename, sku: null, type, status: 'empty_file' });
      continue;
    }
    if (!isSupportedImage(filename)) {
      invalid.push({ filename, sku: null, type, status: 'unsupported_format' });
      continue;
    }
    if (seen.has(filename)) {
      invalid.push({ filename, sku: extractSkuFromFilename(filename), type, status: 'duplicate_file' });
      continue;
    }
    seen.add(filename);

    const sku = extractSkuFromFilename(filename);
    if (!sku) {
      invalid.push({ filename, sku: null, type, status: 'missing_sku' });
      continue;
    }
    const img: ClassifiedImage = { filename, sku, type, status: 'valid' };
    const arr = groups.get(sku);
    if (arr) arr.push(img);
    else groups.set(sku, [img]);
  }

  return {
    groups: [...groups.entries()].map(([sku, images]) => ({ sku, images })),
    invalid,
    skus: [...groups.keys()],
  };
}

/**
 * Valida uno SKU di una riga strutturata. Uno SKU vuoto NON è importabile.
 * Restituisce l'errore utente da mostrare, oppure null se valido.
 */
export function validateRowSku(sku: string | null | undefined): string | null {
  const v = (sku ?? '').trim();
  if (v === '') {
    return 'Impossibile importare il prodotto: manca lo SKU. Aggiungi uno SKU univoco alla riga o rinomina il file utilizzando lo SKU.';
  }
  return null;
}

/** Intestazioni riconosciute come possibile colonna SKU (da confermare). */
export const SKU_HEADER_SYNONYMS = [
  'sku',
  'codice',
  'codice prodotto',
  'codice articolo',
  'product code',
  'article code',
  'id prodotto',
];

/** Suggerisce l'header più probabile per lo SKU (l'utente deve confermare). */
export function suggestSkuHeader(headers: string[]): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const h of headers) {
    if (SKU_HEADER_SYNONYMS.includes(norm(h))) return h;
  }
  return null;
}
