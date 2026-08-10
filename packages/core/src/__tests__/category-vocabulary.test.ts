import { describe, expect, it } from 'vitest';
import {
  dedupeCategories,
  normalizeCategoryName,
  pickCategoryVocabulary,
  type CategoryRow,
} from '../category-vocabulary.js';

const sistema = (id: string, name: string): CategoryRow => ({
  id,
  name,
  ownerOrganizationId: null,
});
const org = (id: string, name: string): CategoryRow => ({
  id,
  name,
  ownerOrganizationId: 'org-1',
});

// Il caso reale che ha originato la correzione: il preset "Eataly" ha il proprio
// vocabolario, ma il wizard proponeva anche le categorie di base del settore.
const presetEataly = [
  org('c1', 'Ciocc/Caffè'),
  org('c2', 'Panett/Gastr'),
  org('c3', 'Olio EVO'),
];
const settoreFood = [
  ...presetEataly,
  sistema('s1', 'Pasta e riso'),
  sistema('s2', 'Vini'),
  sistema('s3', 'Snack'),
];

describe('vocabolario delle categorie', () => {
  it('usa SOLO le categorie del preset quando ce ne sono', () => {
    const v = pickCategoryVocabulary({
      presetCategories: presetEataly,
      sectorCategories: settoreFood,
    });
    expect(v.fromPreset).toBe(true);
    expect(v.entries.map((e) => e.name).sort()).toEqual([
      'Ciocc/Caffè',
      'Olio EVO',
      'Panett/Gastr',
    ]);
  });

  it('non lascia entrare nessuna categoria di base del settore', () => {
    const v = pickCategoryVocabulary({
      presetCategories: presetEataly,
      sectorCategories: settoreFood,
    });
    const ids = new Set(v.entries.map((e) => e.id));
    for (const estranea of ['s1', 's2', 's3']) expect(ids.has(estranea)).toBe(false);
  });

  it('ripiega sul settore solo se il preset non ha categorie', () => {
    const v = pickCategoryVocabulary({ presetCategories: [], sectorCategories: settoreFood });
    expect(v.fromPreset).toBe(false);
    expect(v.entries).toHaveLength(6);
  });

  it('senza preset e senza settore non inventa nulla', () => {
    const v = pickCategoryVocabulary({ presetCategories: [], sectorCategories: [] });
    expect(v).toEqual({ entries: [], fromPreset: false });
  });

  it('a parità di nome vince la categoria dell’organizzazione', () => {
    const rows = [sistema('sys', 'Vini'), org('mia', 'vini ')];
    expect(dedupeCategories(rows)).toEqual([{ id: 'mia', name: 'vini ' }]);
  });

  it('considera uguali nomi che differiscono per accenti, maiuscole e spazi', () => {
    expect(normalizeCategoryName('  Ciocc/CAFFÈ ')).toBe(normalizeCategoryName('ciocc/caffe'));
    expect(dedupeCategories([org('a', 'Olio EVO'), org('b', 'olio  evo')])).toHaveLength(1);
  });

  it('scarta i nomi vuoti invece di creare una voce senza etichetta', () => {
    expect(dedupeCategories([org('a', '   '), org('b', 'Pesce')])).toEqual([
      { id: 'b', name: 'Pesce' },
    ]);
  });
});
