import { describe, expect, it } from 'vitest';
import { suggestNameHeader, suggestSkuHeader } from '../sku.js';

// ---------------------------------------------------------------------------
// Il nome del prodotto.
//
// Era trattato come un attributo del preset: l'import cercava un attributo di
// chiave `product_name` che non è mai esistito — non nel seed, non nella
// configurazione, non nel database di produzione. Quel ramo non poteva scattare,
// e il ripiego «chiamalo come il suo codice» scattava per OGNI prodotto di OGNI
// catalogo. Si caricava un Excel con la colonna «Nome» e si otteneva un
// catalogo di prodotti chiamati come codici a barre.
//
// Il nome non è un attributo: è l'identità della riga, come SKU e categoria.
// Qui si prova che viene riconosciuto, e soprattutto che non viene mai confuso
// con lo SKU — che è il modo in cui il difetto si ripresenterebbe.
// ---------------------------------------------------------------------------

describe('riconoscere la colonna del nome', () => {
  it('riconosce le intestazioni italiane più comuni', () => {
    for (const h of ['Nome', 'Nome prodotto', 'Denominazione', 'Titolo', 'Articolo']) {
      expect(suggestNameHeader(['sku', h, 'prezzo']), h).toBe(h);
    }
  });

  it('riconosce anche le intestazioni inglesi', () => {
    expect(suggestNameHeader(['sku', 'Product Name', 'price'])).toBe('Product Name');
    expect(suggestNameHeader(['code', 'Title'])).toBe('Title');
  });

  it('ignora maiuscole e spazi ai bordi', () => {
    expect(suggestNameHeader(['  NOME PRODOTTO  '])).toBe('  NOME PRODOTTO  ');
  });

  it('non propone niente se nessuna colonna somiglia a un nome', () => {
    expect(suggestNameHeader(['sku', 'prezzo', 'peso'])).toBeNull();
  });

  it('non restituisce la colonna già scelta come SKU', () => {
    // «Articolo» è sinonimo di nome, ma qui l'utente l'ha indicata come codice:
    // proporla anche come nome riporterebbe esattamente al difetto di partenza.
    expect(suggestNameHeader(['Articolo', 'prezzo'], 'Articolo')).toBeNull();
  });

  it('sceglie l’altra colonna quando lo SKU ne occupa una', () => {
    const headers = ['Codice', 'Prodotto', 'prezzo'];
    const sku = suggestSkuHeader(headers);
    expect(sku).toBe('Codice');
    expect(suggestNameHeader(headers, sku)).toBe('Prodotto');
  });

  it('preferisce l’intestazione più esplicita quando ce n’è più d’una', () => {
    // «Nome» prima di «Prodotto»: è meno ambigua.
    expect(suggestNameHeader(['Prodotto', 'Nome', 'sku'])).toBe('Nome');
  });

  it('regge un elenco vuoto', () => {
    expect(suggestNameHeader([])).toBeNull();
    expect(suggestNameHeader([], 'sku')).toBeNull();
  });
});
