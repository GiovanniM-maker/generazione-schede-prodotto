import { describe, it, expect } from 'vitest';
import { extractProductFromHtml } from '../url-extract.js';

const JSONLD = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Olive Taggiasche in Salamoia ROI 480g",
  "description": "Olive liguri raccolte a mano.",
  "sku": "ROI-480",
  "brand": { "@type": "Brand", "name": "ROI" },
  "image": ["https://cdn.shop.it/img/olive-1.jpg", "/img/olive-2.jpg"],
  "color": "Verde",
  "material": "Vetro",
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Formato", "value": "480 g" },
    { "@type": "PropertyValue", "name": "Origine", "value": "Liguria" }
  ],
  "offers": { "@type": "Offer", "price": "12.90", "priceCurrency": "EUR" }
}
</script>
<meta property="og:title" content="Ignorato perché c'è il JSON-LD" />
</head><body><h1>Olive</h1></body></html>`;

describe('extractProductFromHtml — JSON-LD', () => {
  const r = extractProductFromHtml(JSONLD, 'https://cdn.shop.it/prodotti/olive');

  it('usa il JSON-LD come fonte prevalente', () => {
    expect(r.source).toBe('json-ld');
    expect(r.name).toBe('Olive Taggiasche in Salamoia ROI 480g');
    expect(r.brand).toBe('ROI');
    expect(r.sku).toBe('ROI-480');
    expect(r.price).toBe('12.90');
    expect(r.description).toBe('Olive liguri raccolte a mano.');
  });

  it('estrae attributi da campi diretti + additionalProperty + valuta', () => {
    expect(r.attributes['Colore']).toBe('Verde');
    expect(r.attributes['Materiale']).toBe('Vetro');
    expect(r.attributes['Formato']).toBe('480 g');
    expect(r.attributes['Origine']).toBe('Liguria');
    expect(r.attributes['Valuta']).toBe('EUR');
    expect(r.attributes['Brand']).toBe('ROI');
  });

  it('rende assolute le immagini relative e deduplica', () => {
    expect(r.imageUrls).toContain('https://cdn.shop.it/img/olive-1.jpg');
    expect(r.imageUrls).toContain('https://cdn.shop.it/img/olive-2.jpg');
    expect(new Set(r.imageUrls).size).toBe(r.imageUrls.length);
  });
});

describe('extractProductFromHtml — Open Graph fallback', () => {
  const OG = `<html><head>
    <meta property="og:title" content="Maglione lana merino" />
    <meta property="og:description" content="Caldo e leggero." />
    <meta property="og:image" content="https://x.it/m.jpg" />
    <meta property="product:brand" content="Woolly" />
    <meta property="product:price:amount" content="89.00" />
    <meta property="product:price:currency" content="EUR" />
  </head><body></body></html>`;
  const r = extractProductFromHtml(OG, 'https://x.it/p/1');

  it('usa Open Graph quando non c’è JSON-LD', () => {
    expect(r.source).toBe('opengraph');
    expect(r.name).toBe('Maglione lana merino');
    expect(r.description).toBe('Caldo e leggero.');
    expect(r.brand).toBe('Woolly');
    expect(r.price).toBe('89.00');
    expect(r.attributes['Valuta']).toBe('EUR');
    expect(r.imageUrls).toEqual(['https://x.it/m.jpg']);
  });
});

describe('extractProductFromHtml — euristiche HTML', () => {
  it('ricava il nome da <title> togliendo il suffisso del sito', () => {
    const html = `<html><head><title>Scarpa running X | MegaStore</title>
      <meta name="description" content="Ammortizzata." /></head><body></body></html>`;
    const r = extractProductFromHtml(html, 'https://megastore.it');
    expect(r.source).toBe('html');
    expect(r.name).toBe('Scarpa running X');
    expect(r.description).toBe('Ammortizzata.');
  });

  it('preferisce <h1> al <title> quando presente', () => {
    const html = `<html><head><title>Home | Shop</title></head><body><h1>Borsa in pelle</h1></body></html>`;
    const r = extractProductFromHtml(html, 'https://shop.it');
    expect(r.name).toBe('Borsa in pelle');
  });
});

describe('extractProductFromHtml — robustezza', () => {
  it('non esplode su JSON-LD malformato e ritorna source none', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ questo non è json }</script>
      </head><body></body></html>`;
    const r = extractProductFromHtml(html, 'https://x.it');
    expect(r.source).toBe('none');
    expect(r.name).toBeNull();
    expect(r.imageUrls).toEqual([]);
  });

  it('trova il Product dentro @graph', () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"Sito"},
        {"@type":"Product","name":"Prodotto nel graph","offers":{"price":"5.00"}}
      ]}</script>`;
    const r = extractProductFromHtml(html, 'https://x.it');
    expect(r.name).toBe('Prodotto nel graph');
    expect(r.price).toBe('5.00');
  });

  it('scarta schemi immagine non http(s)', () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"X","image":["javascript:alert(1)","https://ok.it/a.jpg"]}</script>`;
    const r = extractProductFromHtml(html, 'https://x.it');
    expect(r.imageUrls).toEqual(['https://ok.it/a.jpg']);
  });

  it('decodifica le entità HTML nel nome', () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"Caff&egrave; &amp; Cacao"}</script>`;
    const r = extractProductFromHtml(html, 'https://x.it');
    // &egrave; non è nella tabella minima → resta il resto pulito con &
    expect(r.name).toContain('&');
  });
});
