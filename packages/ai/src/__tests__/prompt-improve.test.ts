import { describe, it, expect } from 'vitest';
import { createMockProviders } from '../mock.js';
import {
  buildPromptImproveUserPrompt,
  type PromptImproveInput,
} from '@app/core';

const input: PromptImproveInput = {
  sectorName: 'Moda',
  presetName: 'Abbigliamento',
  brandTone: 'sobrio',
  currentInstructions: [
    { fieldKey: 'generated_title', fieldLabel: 'Titolo', instruction: 'Scrivi un titolo.' },
    { fieldKey: 'short_description', fieldLabel: 'Descrizione breve', instruction: '' },
  ],
  corrections: [
    {
      fieldKey: 'generated_title',
      fieldLabel: 'Titolo',
      original: 'Bellissima giacca elegante e raffinata in cotone premium',
      corrected: 'Giacca in cotone blu',
      reason: 'Troppo lungo ed enfatico',
    },
    {
      fieldKey: 'generated_title',
      fieldLabel: 'Titolo',
      original: 'Splendida camicia di altissima qualità',
      corrected: 'Camicia in lino bianco',
      reason: 'Niente superlativi',
    },
  ],
};

describe('promptImprove (mock)', () => {
  it('propone istruzioni migliorate solo per i campi corretti', async () => {
    const providers = createMockProviders({ latencyMs: 0 });
    const res = await providers.promptImprove.improvePrompt(input);

    // Solo "generated_title" ha correzioni.
    expect(res.data.fields).toHaveLength(1);
    const field = res.data.fields[0];
    if (!field) throw new Error('atteso un campo migliorato');
    expect(field.fieldKey).toBe('generated_title');
    expect(field.improvedInstruction.length).toBeGreaterThan(0);
    // Integra le motivazioni ricorrenti dell'utente.
    expect(field.improvedInstruction).toContain('Troppo lungo ed enfatico');
    expect(field.improvedInstruction).toContain('Niente superlativi');
    expect(res.data.summary).toContain('2 correzioni');
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  it('non produce nulla senza correzioni', async () => {
    const providers = createMockProviders({ latencyMs: 0 });
    const res = await providers.promptImprove.improvePrompt({ ...input, corrections: [] });
    expect(res.data.fields).toHaveLength(0);
  });

  it('il prompt utente include correzioni e istruzioni attuali', () => {
    const prompt = buildPromptImproveUserPrompt(input);
    expect(prompt).toContain('Moda');
    expect(prompt).toContain('PRIMA:');
    expect(prompt).toContain('DOPO:');
    expect(prompt).toContain('PERCHÉ:');
    expect(prompt).toContain('Giacca in cotone blu');
  });
});
