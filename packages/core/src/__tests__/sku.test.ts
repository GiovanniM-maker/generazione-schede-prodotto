import { describe, it, expect } from 'vitest';
import {
  extractSkuFromFilename,
  suggestImageType,
  groupImagesBySku,
  validateRowSku,
  suggestSkuHeader,
} from '../sku.js';
import {
  analyzeSources,
  decideGeneration,
  resolveWinningValue,
  isBlockingConflict,
} from '../sources.js';

describe('extractSkuFromFilename', () => {
  it('estrae lo SKU prima del primo underscore', () => {
    expect(extractSkuFromFilename('TSHIRT001_front.jpg')).toBe('TSHIRT001');
  });
  it('supporta SKU con trattino', () => {
    expect(extractSkuFromFilename('ABC-123_1.webp')).toBe('ABC-123');
  });
  it('supporta SKU con punto', () => {
    expect(extractSkuFromFilename('ABC.9_detail.png')).toBe('ABC.9');
  });
  it('prende solo la parte prima del primo underscore', () => {
    expect(extractSkuFromFilename('ABC_123_front.jpg')).toBe('ABC');
  });
  it('ritorna null senza underscore', () => {
    expect(extractSkuFromFilename('front.jpg')).toBeNull();
    expect(extractSkuFromFilename('IMG_')).toBe('IMG'); // underscore presente, prefisso valido
    expect(extractSkuFromFilename('DSC9932.jpg')).toBeNull();
  });
  it('ritorna null con underscore iniziale', () => {
    expect(extractSkuFromFilename('_leading.jpg')).toBeNull();
  });
  it('ignora il percorso', () => {
    expect(extractSkuFromFilename('cartella/sub/TS1_back.jpg')).toBe('TS1');
  });
});

describe('suggestImageType', () => {
  it('riconosce i suffissi noti', () => {
    expect(suggestImageType('SKU1_front.jpg')).toBe('front');
    expect(suggestImageType('SKU1_nutritional.jpg')).toBe('nutritional');
    expect(suggestImageType('SKU1_random.jpg')).toBe('other');
  });
});

describe('groupImagesBySku', () => {
  it('raggruppa più immagini sotto lo stesso SKU', () => {
    const res = groupImagesBySku([
      'TSHIRT001_front.jpg',
      'TSHIRT001_back.jpg',
      'TSHIRT001_detail.jpg',
      'TSHIRT002_1.png',
    ]);
    const g1 = res.groups.find((g) => g.sku === 'TSHIRT001');
    expect(g1?.images.length).toBe(3);
    expect(res.skus.sort()).toEqual(['TSHIRT001', 'TSHIRT002']);
  });
  it('mette i file senza SKU o non supportati in invalid', () => {
    const res = groupImagesBySku(['front.jpg', 'SKU1_x.gif', 'SKU2_a.jpg']);
    const statuses = res.invalid.map((i) => i.status).sort();
    expect(statuses).toContain('missing_sku');
    expect(statuses).toContain('unsupported_format');
  });
  it('segnala i file duplicati e i file vuoti', () => {
    const res = groupImagesBySku(['A_1.jpg', 'A_1.jpg', 'B_1.jpg'], {
      emptyFilenames: new Set(['B_1.jpg']),
    });
    expect(res.invalid.some((i) => i.status === 'duplicate_file')).toBe(true);
    expect(res.invalid.some((i) => i.status === 'empty_file')).toBe(true);
  });
});

describe('validateRowSku', () => {
  it('blocca lo SKU vuoto con messaggio chiaro', () => {
    expect(validateRowSku('')).toContain('manca lo SKU');
    expect(validateRowSku('   ')).toContain('manca lo SKU');
    expect(validateRowSku(null)).toContain('manca lo SKU');
  });
  it('accetta uno SKU valorizzato', () => {
    expect(validateRowSku('ABC123')).toBeNull();
  });
});

describe('suggestSkuHeader', () => {
  it('riconosce le intestazioni SKU comuni', () => {
    expect(suggestSkuHeader(['nome', 'codice articolo', 'colore'])).toBe('codice articolo');
    expect(suggestSkuHeader(['SKU', 'x'])).toBe('SKU');
    expect(suggestSkuHeader(['a', 'b'])).toBeNull();
  });
});

describe('analyzeSources', () => {
  it('classifica SKU in entrambe / solo file / solo immagini', () => {
    const a = analyzeSources({
      fileSkus: ['A', 'B', 'C', 'B'],
      imageSkus: ['B', 'C', 'D'],
      filesWithoutSku: ['foto.jpg'],
      rowsWithoutSku: 1,
    });
    expect(a.inBoth.sort()).toEqual(['B', 'C']);
    expect(a.onlyFile.sort()).toEqual(['A']);
    expect(a.onlyImages.sort()).toEqual(['D']);
    expect(a.duplicateFileSkus).toEqual(['B']);
    expect(a.totalUniqueSkus).toBe(4);
    expect(a.filesWithoutSku).toEqual(['foto.jpg']);
    expect(a.rowsWithoutSku).toBe(1);
  });
});

describe('resolveWinningValue (priorità sorgenti)', () => {
  it('il CSV/provided vince sull\'inferenza visiva', () => {
    const w = resolveWinningValue([
      { state: 'inferred_visual' as const, v: 'nero' },
      { state: 'provided' as const, v: 'blu' },
    ]);
    expect(w?.v).toBe('blu');
  });
  it('il confermato manualmente vince su tutto', () => {
    const w = resolveWinningValue([
      { state: 'provided' as const, v: 'blu' },
      { state: 'confirmed' as const, v: 'verde' },
    ]);
    expect(w?.v).toBe('verde');
  });
});

describe('decideGeneration', () => {
  it('blocca senza SKU', () => {
    expect(
      decideGeneration({
        hasSku: false,
        hasAnySource: true,
        presentRequiredAttributes: 3,
        totalRequiredAttributes: 3,
        presentOptionalAttributes: 0,
        hasBlockingConflict: false,
      }),
    ).toBe('blocked');
  });
  it('blocca senza alcuna fonte', () => {
    expect(
      decideGeneration({
        hasSku: true,
        hasAnySource: false,
        presentRequiredAttributes: 0,
        totalRequiredAttributes: 3,
        presentOptionalAttributes: 0,
        hasBlockingConflict: false,
      }),
    ).toBe('blocked');
  });
  it('consente generazione parziale con SKU + fonte + alcuni attributi', () => {
    expect(
      decideGeneration({
        hasSku: true,
        hasAnySource: true,
        presentRequiredAttributes: 1,
        totalRequiredAttributes: 3,
        presentOptionalAttributes: 2,
        hasBlockingConflict: false,
      }),
    ).toBe('partial');
  });
  it('scheda completa con tutti gli obbligatori', () => {
    expect(
      decideGeneration({
        hasSku: true,
        hasAnySource: true,
        presentRequiredAttributes: 3,
        totalRequiredAttributes: 3,
        presentOptionalAttributes: 0,
        hasBlockingConflict: false,
      }),
    ).toBe('complete');
  });
  it('insufficiente se tutti gli obbligatori mancano e nessun altro attributo', () => {
    expect(
      decideGeneration({
        hasSku: true,
        hasAnySource: true,
        presentRequiredAttributes: 0,
        totalRequiredAttributes: 3,
        presentOptionalAttributes: 0,
        hasBlockingConflict: false,
      }),
    ).toBe('insufficient');
  });
});

describe('isBlockingConflict', () => {
  it('SKU duplicato e categorie divergenti sono bloccanti', () => {
    expect(isBlockingConflict('duplicate_sku_rows')).toBe(true);
    expect(isBlockingConflict('same_sku_different_categories')).toBe(true);
    expect(isBlockingConflict('color_csv_vs_image')).toBe(false);
  });
});
