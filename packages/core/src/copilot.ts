import { z } from 'zod';

// ---------------------------------------------------------------------------
// "Configuration Copilot" — layer di dominio (tipi + schema + prompt).
//
// Il copilot NON scrive mai nel catalogo: propone una BOZZA (draftPatch) che
// solo l'utente conferma. Il modello non riceve la service-role key, non
// costruisce SQL, non sceglie l'organizzazione (derivata dalla sessione).
// ---------------------------------------------------------------------------

export type CopilotEntityType = 'attribute' | 'category';

export interface CopilotHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotInput {
  userMessage: string;
  entityType: CopilotEntityType;
  history: CopilotHistoryMessage[];
  currentDraft: Record<string, unknown>;
  existingSimilar: { id: string; name: string }[];
  sectorName: string;
}

/**
 * Patch di bozza proposta dal copilot. TUTTI i campi sono nullable per
 * rispettare lo strict JSON schema (optional = nullable, mai assente). In fase
 * di merge solo i campi non-null vengono applicati alla bozza.
 */
export interface CopilotDraftPatch {
  name: string | null;
  description: string | null;
  attributeKind: string | null;
  dataType: string | null;
  unit: string | null;
  enumValues: string[] | null;
  extractionInstruction: string | null;
  generationInstruction: string | null;
  categoryKeys: string[] | null;
  isRequired: boolean | null;
}

export interface CopilotOutput {
  assistantMessage: string;
  intent: string;
  missingInformation: string[];
  suggestedActions: string[];
  draftPatch: CopilotDraftPatch;
  requiresConfirmation: boolean;
  confirmationSummary: string;
}

// --- Zod schema ------------------------------------------------------------

export const copilotDraftPatchSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  attributeKind: z.string().nullable(),
  dataType: z.string().nullable(),
  unit: z.string().nullable(),
  enumValues: z.array(z.string()).nullable(),
  extractionInstruction: z.string().nullable(),
  generationInstruction: z.string().nullable(),
  categoryKeys: z.array(z.string()).nullable(),
  isRequired: z.boolean().nullable(),
});
export type CopilotDraftPatchSchema = z.infer<typeof copilotDraftPatchSchema>;

export const copilotOutputSchema = z.object({
  assistantMessage: z.string(),
  intent: z.string(),
  missingInformation: z.array(z.string()),
  suggestedActions: z.array(z.string()),
  draftPatch: copilotDraftPatchSchema,
  requiresConfirmation: z.boolean(),
  confirmationSummary: z.string(),
});
export type CopilotOutputSchema = z.infer<typeof copilotOutputSchema>;

// --- JSON Schema (strict per Structured Outputs) ---------------------------
// additionalProperties:false ovunque, TUTTE le proprietà in required, gli
// opzionali espressi come nullable (type: ['x','null']).

export const COPILOT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assistantMessage: { type: 'string' },
    intent: { type: 'string' },
    missingInformation: { type: 'array', items: { type: 'string' } },
    suggestedActions: { type: 'array', items: { type: 'string' } },
    draftPatch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        attributeKind: { type: ['string', 'null'] },
        dataType: { type: ['string', 'null'] },
        unit: { type: ['string', 'null'] },
        enumValues: {
          type: ['array', 'null'],
          items: { type: 'string' },
        },
        extractionInstruction: { type: ['string', 'null'] },
        generationInstruction: { type: ['string', 'null'] },
        categoryKeys: {
          type: ['array', 'null'],
          items: { type: 'string' },
        },
        isRequired: { type: ['boolean', 'null'] },
      },
      required: [
        'name',
        'description',
        'attributeKind',
        'dataType',
        'unit',
        'enumValues',
        'extractionInstruction',
        'generationInstruction',
        'categoryKeys',
        'isRequired',
      ],
    },
    requiresConfirmation: { type: 'boolean' },
    confirmationSummary: { type: 'string' },
  },
  required: [
    'assistantMessage',
    'intent',
    'missingInformation',
    'suggestedActions',
    'draftPatch',
    'requiresConfirmation',
    'confirmationSummary',
  ],
} as const;

// --- Prompt builder --------------------------------------------------------

const COPILOT_COMMON_RULES = [
  'Sei il "Copilot di Configurazione", un assistente che aiuta a configurare attributi e categorie di prodotto per un SaaS italiano multi-settore (Moda, Food, Pharma).',
  'Rispondi SEMPRE in italiano, con tono professionale e conciso.',
  'Non scrivi MAI direttamente nel catalogo: proponi solo una BOZZA strutturata (draftPatch). Solo l\'utente conferma la creazione.',
  'Chiedi le informazioni mancanti quando la bozza non è ancora completa: elencale in missingInformation.',
  'Se in existingSimilar compaiono voci con nome simile, segnala il possibile duplicato nell\'assistantMessage e proponi di riusare l\'esistente invece di crearne uno nuovo.',
  'Popola draftPatch solo con i campi che puoi dedurre dal messaggio dell\'utente e dalla conversazione. Lascia null i campi non ancora noti.',
  'Imposta requiresConfirmation a true prima di qualsiasi creazione o aggiornamento.',
  'confirmationSummary deve riassumere in una frase cosa verrà creato, per la conferma dell\'utente.',
  'Non inventare MAI claim sanitari o salutistici per il settore Pharma (nessuna indicazione terapeutica non dichiarata).',
  'Le istruzioni di estrazione devono sempre specificare: "estrai solo il dato dichiarato, non stimare".',
];

const COPILOT_ATTRIBUTE_RULES = [
  'Stai configurando un ATTRIBUTO di prodotto.',
  'attributeKind ammessi: "factual" (fattuale, dato dichiarato), "derived" (derivato), "generative" (generativo).',
  'dataType ammessi: text, long_text, integer, decimal, boolean, date, enum, multi_enum, measurement, percentage, currency, json.',
  'Se dataType è enum o multi_enum, proponi enumValues coerenti; per measurement/percentage/currency proponi una unit adeguata.',
  'Fornisci extractionInstruction (come estrarre il dato dalle fonti) e generationInstruction (come usarlo nel testo).',
  'categoryKeys è la lista facoltativa di categorie a cui collegare l\'attributo; isRequired indica se è obbligatorio in quelle categorie.',
];

const COPILOT_CATEGORY_RULES = [
  'Stai configurando una CATEGORIA di prodotto.',
  'Per una categoria sono rilevanti soprattutto name e description; gli altri campi restano tipicamente null.',
  'Suggerisci in suggestedActions eventuali attributi tipici da associare in seguito alla categoria.',
];

export function buildCopilotSystemPrompt(entityType: CopilotEntityType): string {
  const specific =
    entityType === 'attribute' ? COPILOT_ATTRIBUTE_RULES : COPILOT_CATEGORY_RULES;
  return [
    ...COPILOT_COMMON_RULES,
    ...specific,
    'Restituisci SEMPRE un JSON strict conforme allo schema con: assistantMessage, intent, missingInformation[], suggestedActions[], draftPatch{...}, requiresConfirmation, confirmationSummary.',
  ].join('\n');
}

export function buildCopilotUserPrompt(input: CopilotInput): string {
  const historyLines = input.history.length
    ? input.history.map((m) => `${m.role === 'user' ? 'Utente' : 'Assistente'}: ${m.content}`).join('\n')
    : '(nessuno)';
  const draftJson = JSON.stringify(input.currentDraft ?? {}, null, 0);
  const similarLines = input.existingSimilar.length
    ? input.existingSimilar.map((s) => `- ${s.name} (id: ${s.id})`).join('\n')
    : '(nessuna voce simile trovata)';

  return [
    `Settore: ${input.sectorName || 'non specificato'}.`,
    `Tipo di entità: ${input.entityType === 'attribute' ? 'attributo' : 'categoria'}.`,
    '',
    'Cronologia della conversazione:',
    historyLines,
    '',
    'Bozza corrente (JSON, i campi già impostati):',
    draftJson,
    '',
    'Voci esistenti simili (possibili duplicati da segnalare):',
    similarLines,
    '',
    'Nuovo messaggio dell\'utente:',
    input.userMessage,
    '',
    'Aggiorna la bozza proponendo un draftPatch (solo i campi che puoi dedurre; gli altri null), elenca le informazioni ancora mancanti e chiedi conferma prima della creazione.',
  ].join('\n');
}
