// ---------------------------------------------------------------------------
// Generazione template di importazione a partire dagli attributi del preset.
// Non esiste un formato fisso: il template è costruito sul preset scelto e
// dichiara le colonne attese e le informazioni MINIME obbligatorie.
// ---------------------------------------------------------------------------

export interface TemplateColumn {
  key: string;
  label: string;
  required: boolean;
  description?: string;
  example?: string;
}

export interface TemplateAttribute {
  key: string;
  name: string;
  required: boolean;
  description?: string | null;
  dataType?: string;
  example?: string | null;
}

export interface TemplateInput {
  sectorName: string;
  attributes: TemplateAttribute[];
}

/** Colonne fisse iniziali di ogni template. Lo SKU è sempre obbligatorio. */
const FIXED_LEADING: TemplateColumn[] = [
  {
    key: 'sku',
    label: 'SKU',
    required: true,
    description:
      'Identificativo univoco del prodotto. OBBLIGATORIO. Una riga per SKU. Non usare underscore nello SKU.',
    example: 'TSHIRT001',
  },
  {
    key: 'categoria',
    label: 'Categoria',
    required: true,
    description: 'Categoria del preset a cui appartiene il prodotto.',
    example: 'T-shirt e magliette',
  },
  {
    key: 'nome_prodotto',
    label: 'Nome prodotto',
    required: false,
    description: 'Nome/titolo del prodotto, se disponibile.',
  },
];

const FIXED_TRAILING: TemplateColumn[] = [
  {
    key: 'descrizione_originale',
    label: 'Descrizione originale',
    required: false,
    description: 'Eventuale descrizione esistente, usata come riferimento (mai copiata come fatto).',
  },
];

/** Costruisce le colonne del template dagli attributi del preset. */
export function buildTemplateColumns(input: TemplateInput): TemplateColumn[] {
  const attrCols: TemplateColumn[] = input.attributes.map((a) => ({
    key: a.key,
    label: a.name,
    required: a.required,
    description: a.description ?? undefined,
    example: a.example ?? undefined,
  }));
  return [...FIXED_LEADING, ...attrCols, ...FIXED_TRAILING];
}

/** Informazioni minime obbligatorie: SKU + almeno un attributo/descrizione utile. */
export function minimumRequiredColumns(columns: TemplateColumn[]): TemplateColumn[] {
  return columns.filter((c) => c.required);
}

/** Escape CSV di una cella. */
function csvCell(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export interface TemplateCsvOptions {
  includeDescriptionRow?: boolean;
  includeExampleRow?: boolean;
  delimiter?: string;
}

/** Genera il testo CSV del template (header + righe facoltative descrizione/esempio). */
export function buildTemplateCsv(columns: TemplateColumn[], opts: TemplateCsvOptions = {}): string {
  const d = opts.delimiter ?? ',';
  const lines: string[] = [];
  lines.push(columns.map((c) => csvCell(c.label)).join(d));
  if (opts.includeDescriptionRow) {
    lines.push(columns.map((c) => csvCell(c.description ?? '')).join(d));
  }
  if (opts.includeExampleRow) {
    lines.push(columns.map((c) => csvCell(c.example ?? '')).join(d));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

/** Guida ai nomi dei file immagine (mostrata nel wizard e nel foglio Istruzioni). */
export const IMAGE_NAMING_GUIDE = [
  'Guida ai nomi dei file immagine',
  '',
  'Ogni immagine deve iniziare con lo SKU del prodotto, seguito da un underscore:',
  '  {SKU}_{descrizione-libera}.{jpg|jpeg|png|webp}',
  '',
  'Esempi validi:',
  '  TSHIRT001_front.jpg',
  '  TSHIRT001_back.jpg',
  '  TSHIRT001_detail.jpg',
  '  ABC-123_1.webp',
  '',
  'Esempi NON validi (verranno segnalati come non associabili):',
  '  front.jpg',
  '  IMG_001.jpg',
  '  DSC9932.jpg',
  '',
  'Regole:',
  '- La parte prima del PRIMO underscore è sempre lo SKU.',
  '- Lo SKU non può contenere underscore. Può contenere lettere, numeri, trattini e punti.',
  '- Se carichi immagini + CSV/Excel, lo SKU della colonna SKU deve corrispondere ESATTAMENTE al prefisso del nome immagine.',
].join('\n');

/** Testo del foglio "Istruzioni" del template. */
export function buildInstructions(input: TemplateInput, columns: TemplateColumn[]): string[] {
  const required = minimumRequiredColumns(columns).map((c) => c.label);
  const optional = columns.filter((c) => !c.required).map((c) => c.label);
  return [
    `Template di importazione — settore ${input.sectorName}`,
    '',
    'Regole generali:',
    '- Una riga per SKU.',
    '- Lo SKU è OBBLIGATORIO e non può contenere underscore.',
    '- I dati vengono usati come fatti: le informazioni assenti NON verranno inventate.',
    '',
    `Campi obbligatori: ${required.join(', ')}`,
    `Campi facoltativi: ${optional.join(', ') || '(nessuno)'}`,
    '',
    IMAGE_NAMING_GUIDE,
  ];
}
