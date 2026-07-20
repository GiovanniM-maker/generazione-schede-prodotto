// ---------------------------------------------------------------------------
// Mapper di export verso le piattaforme e-commerce. Tutto DETERMINISTICO a
// partire dall'output già generato (nessuna AI). Ogni piattaforma ha il suo
// set di colonne d'import: qui produciamo righe pronte da caricare.
// ---------------------------------------------------------------------------

export type ExportPlatform = 'shopify' | 'woocommerce' | 'prestashop';

/** Contenuto normalizzato di un prodotto per la mappatura verso le piattaforme. */
export interface ExportItem {
  sku: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  bullets: string[];
  metaDescription: string;
  altText: string;
  faq: Array<{ question: string; answer: string }>;
  brand: string;
  category: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Corpo HTML per Shopify/WooCommerce: descrizione + bullet + FAQ. */
function bodyHtml(it: ExportItem): string {
  const parts: string[] = [];
  if (it.longDescription) parts.push(`<p>${esc(it.longDescription)}</p>`);
  if (it.bullets.length) {
    parts.push(`<ul>${it.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  }
  if (it.faq.length) {
    parts.push('<h3>Domande frequenti</h3>');
    for (const f of it.faq) {
      parts.push(`<p><strong>${esc(f.question)}</strong><br>${esc(f.answer)}</p>`);
    }
  }
  return parts.join('\n');
}

export interface PlatformExport {
  columns: string[];
  rows: Array<Record<string, string>>;
  filename: string;
}

/** Shopify — CSV prodotti (set essenziale, prodotto semplice senza varianti). */
function toShopify(items: ExportItem[]): PlatformExport {
  const columns = [
    'Handle',
    'Title',
    'Body (HTML)',
    'Vendor',
    'Type',
    'Published',
    'Variant SKU',
    'Variant Inventory Policy',
    'Variant Fulfillment Service',
    'Variant Price',
    'SEO Title',
    'SEO Description',
    'Image Alt Text',
    'Status',
  ];
  const rows = items.map((it) => ({
    Handle: slugify(it.title || it.sku),
    Title: it.title,
    'Body (HTML)': bodyHtml(it),
    Vendor: it.brand,
    Type: it.category,
    Published: 'TRUE',
    'Variant SKU': it.sku,
    'Variant Inventory Policy': 'deny',
    'Variant Fulfillment Service': 'manual',
    'Variant Price': '',
    'SEO Title': (it.title || '').slice(0, 70),
    'SEO Description': it.metaDescription,
    'Image Alt Text': it.altText,
    Status: 'active',
  }));
  return { columns, rows, filename: 'shopify-import.csv' };
}

/** WooCommerce — CSV prodotti (importer nativo, con SEO Yoast). */
function toWooCommerce(items: ExportItem[]): PlatformExport {
  const columns = [
    'Type',
    'SKU',
    'Name',
    'Published',
    'Visibility in catalog',
    'Short description',
    'Description',
    'Categories',
    'Brands',
    'Meta: _yoast_wpseo_title',
    'Meta: _yoast_wpseo_metadesc',
    'Image alt text',
  ];
  const rows = items.map((it) => ({
    Type: 'simple',
    SKU: it.sku,
    Name: it.title,
    Published: '1',
    'Visibility in catalog': 'visible',
    'Short description': it.shortDescription,
    Description: bodyHtml(it),
    Categories: it.category,
    Brands: it.brand,
    'Meta: _yoast_wpseo_title': (it.title || '').slice(0, 70),
    'Meta: _yoast_wpseo_metadesc': it.metaDescription,
    'Image alt text': it.altText,
  }));
  return { columns, rows, filename: 'woocommerce-import.csv' };
}

/** PrestaShop — CSV prodotti (import Catalogo → Prodotti). */
function toPrestaShop(items: ExportItem[]): PlatformExport {
  const columns = [
    'Reference',
    'Name',
    'Categories (x,y,z...)',
    'Short description',
    'Description',
    'Meta title',
    'Meta description',
    'Manufacturer',
    'Active (0/1)',
  ];
  const rows = items.map((it) => ({
    Reference: it.sku,
    Name: it.title,
    'Categories (x,y,z...)': it.category,
    'Short description': it.shortDescription,
    Description: bodyHtml(it),
    'Meta title': (it.title || '').slice(0, 70),
    'Meta description': it.metaDescription,
    Manufacturer: it.brand,
    'Active (0/1)': '1',
  }));
  return { columns, rows, filename: 'prestashop-import.csv' };
}

export function buildPlatformExport(platform: ExportPlatform, items: ExportItem[]): PlatformExport {
  switch (platform) {
    case 'shopify':
      return toShopify(items);
    case 'woocommerce':
      return toWooCommerce(items);
    case 'prestashop':
      return toPrestaShop(items);
  }
}
