import {
  PRODUCT_COPY_PROMPT_VERSION,
  BRAND_PROFILE_PROMPT_VERSION,
  FACT_AUDIT_PROMPT_VERSION,
  FACT_USABLE_STATUSES,
} from '@app/config';
import type {
  BrandProfile,
  BrandProfileInput,
  FactAttribute,
  ProductCopy,
  ProductCopyInput,
} from './types.js';

// ---------------------------------------------------------------------------
// Prompt builder. Costruisce SOLO attorno ai fatti ammessi. Nessun dato di
// altri tenant, nessun segreto, nessun prodotto non necessario.
// ---------------------------------------------------------------------------

export { PRODUCT_COPY_PROMPT_VERSION };

/** Filtra i fatti utilizzabili come verità (esclude inferred_visual/needs_review). */
export function usableFacts(facts: FactAttribute[]): FactAttribute[] {
  return facts.filter((f) => FACT_USABLE_STATUSES.includes(f.status));
}

const COPY_SYSTEM_RULES = [
  'Sei un copywriter esperto di moda. Scrivi in italiano.',
  'Usa ESCLUSIVAMENTE i fatti forniti. Non inventare attributi.',
  "Non trasformare un'assenza di dato in un claim.",
  'Non dedurre il materiale dal nome del prodotto.',
  'Non dedurre la vestibilità dalle fotografie.',
  'Non usare "sostenibile", "ecologico" o simili se non presenti nei fatti.',
  'Non usare "Made in Italy" se il paese di origine non è fornito.',
  'Non usare "impermeabile" al posto di "resistente all\'acqua".',
  'Non alterare le percentuali di composizione.',
  'Non aggiungere istruzioni di lavaggio non fornite.',
  'Non inventare occasioni d\'uso come fatti tecnici.',
  'È consentita prosa evocativa purché non fattuale.',
  'Evita ripetizioni e keyword stuffing.',
  'Rispetta i limiti di lunghezza. Restituisci JSON strict.',
];

export function buildCopySystemPrompt(profile: BrandProfile): string {
  const forbidden = profile.forbiddenWords.length
    ? `Parole vietate: ${profile.forbiddenWords.join(', ')}.`
    : '';
  const preferred = profile.preferredWords.length
    ? `Parole preferite: ${profile.preferredWords.join(', ')}.`
    : '';
  return [
    ...COPY_SYSTEM_RULES,
    `Stile: ${profile.style}. Formalità: ${profile.formality}. Persona: ${profile.person}.`,
    `Descrizione breve: ${profile.structure.shortDescriptionSentences} frasi.`,
    `Descrizione lunga: ${profile.structure.longDescriptionMinWords}-${profile.structure.longDescriptionMaxWords} parole.`,
    `Bullet: ${profile.structure.bulletCount}. Titolo max 80 caratteri. Meta description max 155 caratteri.`,
    preferred,
    forbidden,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildCopyUserPrompt(input: ProductCopyInput): string {
  const facts = usableFacts(input.facts);
  const factLines = facts.map((f) => `- ${f.fieldKey}: ${f.value}`).join('\n');
  const sector = input.sectorName ? `Settore: ${input.sectorName}.` : '';
  const presetInstructions =
    input.presetInstructions && input.presetInstructions.length
      ? ['Istruzioni di generazione dal preset (rispettale):', ...input.presetInstructions.map((i) => `- ${i}`)].join('\n')
      : '';
  const safety =
    input.safetyRules && input.safetyRules.length
      ? ['Regole di sicurezza obbligatorie:', ...input.safetyRules.map((r) => `- ${r}`)].join('\n')
      : '';
  return [
    sector,
    'Fatti disponibili (usa solo questi):',
    factLines || '(nessun fatto)',
    '',
    presetInstructions,
    safety,
    '',
    `Output richiesto: ${input.requestedOutput.join(', ')}.`,
    'Restituisci un JSON con: title, shortDescription, longDescription, bullets[], metaDescription, usedFactKeys[], warnings[].',
    "In usedFactKeys elenca SOLO le chiavi dei fatti effettivamente usati. In warnings segnala eventuali dati mancanti importanti.",
  ]
    .filter(Boolean)
    .join('\n');
}

const BRAND_SYSTEM_RULES = [
  'Analizzi lo stile di comunicazione di un brand moda e produci un profilo tono.',
  'Rispondi in italiano con un JSON strict.',
  'Non inventare policy non deducibili: usa valori neutri se mancano segnali.',
];

export function buildBrandProfileSystemPrompt(): string {
  return BRAND_SYSTEM_RULES.join('\n');
}

export function buildBrandProfileUserPrompt(input: BrandProfileInput): string {
  const examples = input.examples.length
    ? input.examples.map((e, i) => `Esempio ${i + 1}: ${e}`).join('\n')
    : '(nessun esempio fornito)';
  return [
    `Stile selezionato dall'utente: ${input.selectedStyle}.`,
    input.guidance ? `Indicazioni: ${input.guidance}.` : '',
    input.forbiddenWords?.length ? `Parole da evitare: ${input.forbiddenWords.join(', ')}.` : '',
    'Descrizioni esistenti del brand:',
    examples,
    '',
    'Produci un profilo tono JSON con: style, formality, sentenceLength, person, preferredWords[], forbiddenWords[], structure{shortDescriptionSentences, longDescriptionMinWords, longDescriptionMaxWords, bulletCount}, ctaPolicy, seoPolicy, summary.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const BRAND_PROFILE_PROMPT_VERSION_EXPORT = BRAND_PROFILE_PROMPT_VERSION;

export function buildAuditUserPrompt(facts: FactAttribute[], content: ProductCopy): string {
  const factLines = usableFacts(facts)
    .map((f) => `- ${f.fieldKey}: ${f.value}`)
    .join('\n');
  return [
    'Verifica che il testo generato non contenga claim non supportati dai fatti.',
    'Fatti ammessi:',
    factLines || '(nessuno)',
    '',
    'Testo generato:',
    `Titolo: ${content.title}`,
    `Breve: ${content.shortDescription}`,
    `Lunga: ${content.longDescription}`,
    `Bullet: ${content.bullets.join(' | ')}`,
    `Meta: ${content.metaDescription}`,
    '',
    'Restituisci JSON: passed(bool), unsupportedClaims[], conflicts[], severity(none|low|medium|high), recommendedStatus(generated|needs_review|rejected).',
  ].join('\n');
}

export const FACT_AUDIT_PROMPT_VERSION_EXPORT = FACT_AUDIT_PROMPT_VERSION;

// ---------------------------------------------------------------------------
// Prompt per l'estrazione visuale. Le immagini possono SOLO SUGGERIRE un
// piccolo insieme di attributi VISIBILI, sempre da confermare. Nessuna
// deduzione di materiale, composizione, misure, cura, origine, ecc.
// ---------------------------------------------------------------------------

/** Elenco esplicito di ciò che NON è mai deducibile da un'immagine. */
const VISUAL_FORBIDDEN = [
  'materiale',
  'composizione',
  'misure o taglie',
  'istruzioni di lavaggio o cura',
  'paese di origine / Made in Italy',
  'sostenibilità o riciclato',
  'impermeabilità o resistenza all\'acqua',
  'qualità o certificazioni',
];

export function buildVisualUserPrompt(allowedFields: string[], sectorName?: string): string {
  const sector = sectorName ? `Settore: ${sectorName}.` : '';
  const allowed = allowedFields.length
    ? allowedFields.map((f) => `- ${f}`).join('\n')
    : '(nessun campo consentito: non suggerire nulla)';
  return [
    'Osserva le immagini del prodotto allegate.',
    sector,
    'Puoi SUGGERIRE esclusivamente gli attributi elencati qui sotto, e SOLO se chiaramente visibili nelle immagini:',
    allowed,
    'Per ogni attributo suggerito indica un valore conciso in italiano e una confidence tra 0 e 1.',
    'Se un attributo non è chiaramente visibile, NON produrlo (ometti la voce). Non indovinare.',
    `Non dedurre MAI: ${VISUAL_FORBIDDEN.join(', ')}.`,
    'Questi suggerimenti NON sono fatti: verranno usati solo se l\'utente li conferma.',
    'Restituisci un JSON: { "attributes": [{ "fieldKey", "value", "confidence" }] }.',
    'Usa come fieldKey esattamente una delle chiavi consentite elencate sopra. Nessun\'altra chiave.',
  ]
    .filter(Boolean)
    .join('\n');
}
