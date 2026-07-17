import { describe, it, expect } from 'vitest';
import {
  buildTemplateColumns,
  buildTemplateCsv,
  minimumRequiredColumns,
  buildInstructions,
  IMAGE_NAMING_GUIDE,
} from '../template.js';

const input = {
  sectorName: 'Moda',
  attributes: [
    { key: 'colore', name: 'Colore', required: true, description: 'Colore principale' },
    { key: 'materiale', name: 'Materiale', required: false },
    { key: 'composizione', name: 'Composizione', required: false },
  ],
};

describe('buildTemplateColumns', () => {
  it('mette SKU come prima colonna e sempre obbligatorio', () => {
    const cols = buildTemplateColumns(input);
    expect(cols[0]!.key).toBe('sku');
    expect(cols[0]!.required).toBe(true);
  });
  it('include gli attributi del preset e una descrizione originale finale', () => {
    const cols = buildTemplateColumns(input);
    const keys = cols.map((c) => c.key);
    expect(keys).toContain('colore');
    expect(keys).toContain('materiale');
    expect(keys[keys.length - 1]).toBe('descrizione_originale');
  });
});

describe('minimumRequiredColumns', () => {
  it('sono almeno SKU + gli attributi obbligatori', () => {
    const cols = buildTemplateColumns(input);
    const req = minimumRequiredColumns(cols).map((c) => c.key);
    expect(req).toContain('sku');
    expect(req).toContain('categoria');
    expect(req).toContain('colore');
    expect(req).not.toContain('materiale');
  });
});

describe('buildTemplateCsv', () => {
  it('genera header con BOM e righe opzionali', () => {
    const cols = buildTemplateColumns(input);
    const csv = buildTemplateCsv(cols, { includeDescriptionRow: true, includeExampleRow: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(lines[0]).toContain('SKU');
    expect(lines[0]).toContain('Colore');
    expect(lines.length).toBe(3); // header + descrizioni + esempio
  });
});

describe('istruzioni e guida immagini', () => {
  it('la guida spiega la nomenclatura SKU_', () => {
    expect(IMAGE_NAMING_GUIDE).toContain('{SKU}_');
    expect(IMAGE_NAMING_GUIDE).toContain('front.jpg');
  });
  it('le istruzioni elencano i campi obbligatori', () => {
    const cols = buildTemplateColumns(input);
    const text = buildInstructions(input, cols).join('\n');
    expect(text).toContain('Campi obbligatori');
    expect(text).toContain('Colore');
  });
});
