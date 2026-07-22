import { describe, it, expect } from 'vitest';
import {
  buildPresetPlanUserPrompt,
  buildPresetPlanSystemPrompt,
  PRESET_PLAN_JSON_SCHEMA,
  plannedAttributeSchema,
  type PresetPlanInput,
} from '../preset-plan.js';

const base: PresetPlanInput = {
  sectorName: 'Food',
  presetName: 'Test',
  userRequest: 'Crea 2 categorie',
  existingCategories: [],
  existingAttributes: [],
  history: [],
};

describe('preset-plan schema', () => {
  it('richiede sia extractionInstruction sia generationInstruction per ogni attributo', () => {
    const attrProps = PRESET_PLAN_JSON_SCHEMA.properties.categories.items.properties.attributes.items;
    expect(attrProps.required).toContain('extractionInstruction');
    expect(attrProps.required).toContain('generationInstruction');
    // Lo zod accetta l'attributo completo.
    const parsed = plannedAttributeSchema.safeParse({
      name: 'Peso', dataType: 'measurement', enumValues: null, unit: 'g',
      extractionInstruction: 'Leggi il peso', generationInstruction: 'Cita il peso',
    });
    expect(parsed.success).toBe(true);
  });

  it('il system prompt cita entrambe le istruzioni', () => {
    const sys = buildPresetPlanSystemPrompt();
    expect(sys).toContain('extractionInstruction');
    expect(sys).toContain('generationInstruction');
  });
});

describe('buildPresetPlanUserPrompt — modifiche', () => {
  it('NON include il piano attuale se assente', () => {
    const p = buildPresetPlanUserPrompt(base);
    expect(p).not.toContain('Piano attuale');
  });

  it('include il piano attuale (per le richieste di modifica) quando fornito', () => {
    const p = buildPresetPlanUserPrompt({
      ...base,
      userRequest: 'cambia il colore in elenco',
      currentPlan: [
        {
          name: 'Magliette',
          description: null,
          recognitionHint: 'Capo in maglia, foto del busto',
          attributes: [
            { name: 'Colore', dataType: 'text', enumValues: null, unit: null, extractionInstruction: 'Leggi il colore', generationInstruction: 'Cita il colore' },
          ],
        },
      ],
    });
    expect(p).toContain('Piano attuale');
    expect(p).toContain('Magliette');
    expect(p).toContain('Colore');
    expect(p).toContain('cambia il colore in elenco');
  });
});
