// Estrazione dei FATTI di prodotto da una pagina web (import da URL).
// Funzione PURA: riceve l'HTML già scaricato + l'URL base, non fa rete.
// Il principio resta "i dati posseggono i fatti, l'AI la prosa": qui ricaviamo
// solo dati verificabili (nome, brand, prezzo, attributi, immagini); la prosa
// viene poi RIscritta dall'AI, mai copiata.
//
// Priorità delle fonti, dalla più affidabile:
//   1) JSON-LD schema.org (<script type="application/ld+json"> con @type Product)
//   2) Open Graph / meta property (og:*, product:*)
//   3) Euristiche HTML (<title>, <h1>, <meta name=description>)

export interface UrlExtractedProduct {
  /** Nome/titolo del prodotto. */
  name: string | null;
  brand: string | null;
  description: string | null;
  /** Prezzo come stringa grezza (es. "19.90"); la valuta va in attributes. */
  price: string | null;
  sku: string | null;
  /** Attributi/fatti aggiuntivi (materiale, colore, peso, additionalProperty…). */
  attributes: Record<string, string>;
  /** URL immagini, assoluti e deduplicati. */
  imageUrls: string[];
  /** Fonte prevalente usata per il nome (diagnostica). */
  source: 'json-ld' | 'opengraph' | 'html' | 'none';
}

const MAX_IMAGES = 12;
const MAX_ATTR_VALUE = 400;

/** Decodifica le entità HTML più comuni. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

function clean(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t.length ? t.slice(0, 2000) : null;
}

/** Risolve un URL (anche relativo o protocol-relative) rispetto alla base. */
function absolutize(url: string, base: string): string | null {
  try {
    const u = new URL(url, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Estrae e fa il parse di tutti i blocchi JSON-LD, appiattendo @graph e array. */
function parseJsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const cur = stack.pop();
      if (Array.isArray(cur)) {
        stack.push(...cur);
      } else if (cur && typeof cur === 'object') {
        const obj = cur as Record<string, unknown>;
        if (Array.isArray(obj['@graph'])) stack.push(...(obj['@graph'] as unknown[]));
        nodes.push(obj);
      }
    }
  }
  return nodes;
}

function typeMatchesProduct(t: unknown): boolean {
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === 'string' && /product/i.test(x));
}

function firstOf<T>(v: T | T[] | undefined | null): T | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Legge il valore di un meta tag per property/name, in modo tollerante all'ordine degli attributi. */
function metaContent(html: string, key: string, attr: 'property' | 'name'): string | null {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // <meta property="og:title" content="..."> oppure content prima di property
  const patterns = [
    new RegExp(`<meta\\b[^>]*\\b${attr}=["']${safe}["'][^>]*\\bcontent=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attr}=["']${safe}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m && m[1]) return clean(m[1]);
  }
  return null;
}

function addAttr(attrs: Record<string, string>, name: unknown, value: unknown): void {
  const n = clean(name);
  const v = clean(value);
  if (!n || !v) return;
  if (n.length > 60) return;
  if (attrs[n]) return; // non sovrascrivere la fonte più affidabile
  attrs[n] = v.slice(0, MAX_ATTR_VALUE);
}

/** Estrae i fatti di prodotto dall'HTML. `baseUrl` serve a rendere assolute le immagini. */
export function extractProductFromHtml(html: string, baseUrl: string): UrlExtractedProduct {
  const attributes: Record<string, string> = {};
  const images: string[] = [];
  let name: string | null = null;
  let brand: string | null = null;
  let description: string | null = null;
  let price: string | null = null;
  let sku: string | null = null;
  let source: UrlExtractedProduct['source'] = 'none';

  const pushImage = (u: unknown) => {
    const raw = typeof u === 'string' ? u : (u && typeof u === 'object' ? (u as Record<string, unknown>).url : null);
    if (typeof raw !== 'string') return;
    const abs = absolutize(raw.trim(), baseUrl);
    if (abs && !images.includes(abs) && images.length < MAX_IMAGES) images.push(abs);
  };

  // 1) JSON-LD Product (fonte prevalente) --------------------------------------
  const product = parseJsonLdNodes(html).find((n) => typeMatchesProduct(n['@type']));
  if (product) {
    source = 'json-ld';
    name = clean(product.name);
    description = clean(product.description);
    sku = clean(product.sku) ?? clean(product.mpn) ?? clean(product.gtin13) ?? null;

    const b = product.brand;
    brand = clean(typeof b === 'object' && b ? (b as Record<string, unknown>).name : b);

    const offer = firstOf(product.offers as unknown) as Record<string, unknown> | undefined;
    if (offer) {
      price = clean(offer.price) ?? clean(offer.lowPrice) ?? null;
      const cur = clean(offer.priceCurrency);
      if (cur) addAttr(attributes, 'Valuta', cur);
    }

    // Immagini
    const img = product.image;
    if (Array.isArray(img)) img.forEach(pushImage);
    else pushImage(img);

    // Attributi diretti noti + additionalProperty
    for (const [label, k] of [
      ['Colore', 'color'],
      ['Materiale', 'material'],
      ['Peso', 'weight'],
      ['Categoria', 'category'],
    ] as const) {
      addAttr(attributes, label, product[k]);
    }
    const addl = product.additionalProperty;
    if (Array.isArray(addl)) {
      for (const p of addl) {
        if (p && typeof p === 'object') {
          const o = p as Record<string, unknown>;
          addAttr(attributes, o.name, o.value ?? o.unitText);
        }
      }
    }
    if (brand) addAttr(attributes, 'Brand', brand);
    if (sku) addAttr(attributes, 'SKU', sku);
  }

  // 2) Open Graph / meta (riempie i buchi) -------------------------------------
  const ogTitle = metaContent(html, 'og:title', 'property');
  const ogDesc = metaContent(html, 'og:description', 'property');
  const ogImage = metaContent(html, 'og:image', 'property');
  const ogBrand = metaContent(html, 'product:brand', 'property') ?? metaContent(html, 'og:brand', 'property');
  const ogPrice = metaContent(html, 'product:price:amount', 'property');
  const ogCurrency = metaContent(html, 'product:price:currency', 'property');
  if (!name && ogTitle) {
    name = ogTitle;
    if (source === 'none') source = 'opengraph';
  }
  if (!description && ogDesc) description = ogDesc;
  if (!brand && ogBrand) {
    brand = ogBrand;
    addAttr(attributes, 'Brand', ogBrand);
  }
  if (!price && ogPrice) price = ogPrice;
  if (ogCurrency) addAttr(attributes, 'Valuta', ogCurrency);
  if (ogImage) pushImage(ogImage);

  // 3) Euristiche HTML (ultima spiaggia) ---------------------------------------
  if (!name) {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const stripped = h1 ? clean(h1[1]?.replace(/<[^>]+>/g, ' ')) : null;
    if (stripped) {
      name = stripped;
      if (source === 'none') source = 'html';
    } else {
      const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      const t = title ? clean(title[1]) : null;
      // Rimuove il suffisso del sito: "Prodotto | Negozio" → "Prodotto"
      if (t) {
        name = t.split(/\s[|–—-]\s/)[0]?.trim() || t;
        if (source === 'none') source = 'html';
      }
    }
  }
  if (!description) {
    const md = metaContent(html, 'description', 'name');
    if (md) description = md;
  }

  // Fallback SKU: se la pagina non lo espone (es. Eataly), ricavalo dal codice
  // numerico in fondo all'URL (…-628795), così ogni prodotto da URL ha uno SKU.
  if (!sku) sku = skuFromUrl(baseUrl);

  return { name, brand, description, price, sku, attributes, imageUrls: images, source };
}

/** Ricava uno SKU dal segmento finale dell'URL: preferisce un codice numerico. */
function skuFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const last = path.split('/').pop() ?? '';
    const slug = last.replace(/\.(html?|php|aspx?)$/i, '');
    if (!slug) return null;
    // Codice numerico finale dopo un trattino: "…-filotea-628795" → "628795".
    const tail = /(?:^|[-_])(\d{3,})$/.exec(slug);
    if (tail) return tail[1] ?? null;
    // Altrimenti uno slug corto e "codice-simile" (poche lettere/numeri).
    if (/^[a-z0-9]{3,20}$/i.test(slug) && /\d/.test(slug)) return slug;
    return null;
  } catch {
    return null;
  }
}
