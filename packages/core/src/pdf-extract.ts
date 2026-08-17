// Estrazione dei FATTI di prodotto dal testo di una scheda tecnica in PDF.
// Funzione PURA: riceve il testo GIÀ estratto dal PDF, non apre file e non fa
// rete. L'adattatore che trasforma i byte in testo sta in apps/web/lib/pdf.ts,
// perché quello è impuro e dipende da una libreria.
//
// Il principio resta "i dati posseggono i fatti, l'AI la prosa": qui si
// raccolgono SOLO coppie etichetta/valore dichiarate nel documento. Niente
// inferenze, niente completamenti, e soprattutto nessuna riga di prosa presa
// dal PDF — la descrizione del fornitore è testo suo, non un fatto, e verrebbe
// ricopiata nella scheda. Le righe che sembrano prosa vengono scartate apposta.
//
// Un PDF = un prodotto. È quello che promette la scheda del wizard
// («estrazione da schede tecniche in PDF»). Un listino con cento articoli in
// tabella è un problema diverso, e va affrontato come tale, non di straforo.

export interface PdfExtractedProduct {
  /** Nome/titolo del prodotto. */
  name: string | null;
  brand: string | null;
  /** Codice articolo dichiarato nel documento. */
  sku: string | null;
  /** Prezzo come stringa grezza (es. "189,00 EUR"); non normalizzato. */
  price: string | null;
  /** Le altre coppie etichetta → valore, nell'ordine in cui compaiono. */
  attributes: Record<string, string>;
  /** Da dove viene il nome (diagnostica, come in url-extract). */
  source: 'etichetta' | 'titolo' | 'riga' | 'none';
  /** Righe riconosciute come coppie: dice quanto il documento era leggibile. */
  righeRiconosciute: number;
  /** Righe di testo totali dopo la pulizia. */
  righeTotali: number;
}

export interface PdfExtractOptions {
  /**
   * Il testo più grande della prima pagina, se l'estrattore è riuscito a
   * misurarlo. È un fatto sul documento (la dimensione del carattere), non una
   * congettura: nelle schede tecniche il titolo è quasi sempre il testo più
   * grande. Serve solo se manca un'etichetta esplicita per il nome.
   */
  titoloProbabile?: string | null;
  /** Nome del file, usato solo come ultima spiaggia per lo SKU. */
  filename?: string | null;
}

const MAX_RIGHE = 5000;
const MAX_ATTRIBUTI = 80;
const MAX_LUNGHEZZA_ETICHETTA = 60;
/**
 * Oltre questa lunghezza un "valore" è un paragrafo, non un fatto. È anche il
 * tetto vero di quanto può finire a database da un PDF: un secondo limite più
 * alto sarebbe irraggiungibile, cioè una bugia scritta nel codice.
 */
const SOGLIA_PROSA = 160;

/** Intestazioni di documento: non sono il nome del prodotto. */
const INTESTAZIONI = new Set([
  'scheda tecnica',
  'scheda prodotto',
  'schede tecniche',
  'specifiche tecniche',
  'caratteristiche tecniche',
  'dati tecnici',
  'informazioni tecniche',
  'technical data sheet',
  'technical datasheet',
  'technical sheet',
  'product data sheet',
  'product datasheet',
  'data sheet',
  'datasheet',
  'spec sheet',
  'specifications',
  'fiche technique',
  'ficha tecnica',
  'technisches datenblatt',
  'datenblatt',
]);

/** Etichette che introducono prosa: il loro contenuto non è un fatto. */
const ETICHETTE_DI_PROSA = new Set([
  'descrizione',
  'descrizione prodotto',
  'descrizione commerciale',
  'description',
  'note',
  'note aggiuntive',
  'notes',
  'avvertenze',
  'presentazione',
  'introduzione',
]);

const SINONIMI_NOME = [
  'denominazione',
  'denominazione prodotto',
  'nome',
  'nome prodotto',
  'nome articolo',
  'prodotto',
  'articolo',
  'descrizione articolo',
  'product',
  'product name',
  'item',
  'item name',
];

const SINONIMI_MARCA = [
  'marca',
  'brand',
  'produttore',
  'fabbricante',
  'costruttore',
  'manufacturer',
  'maker',
];

const SINONIMI_CODICE = [
  'codice',
  'codice articolo',
  'codice art',
  'codice prodotto',
  'cod art',
  'cod articolo',
  'cod',
  'art',
  'articolo n',
  'n articolo',
  'sku',
  'ref',
  'riferimento',
  'part number',
  'partnumber',
  'p n',
  'item code',
  'product code',
  'codice interno',
  'matricola',
];

const SINONIMI_PREZZO = [
  'prezzo',
  'prezzo di listino',
  'prezzo listino',
  'listino',
  'prezzo consigliato',
  'prezzo al pubblico',
  'pvp',
  'price',
  'list price',
  'rrp',
];

/**
 * Tutte le etichette note, dalla più lunga alla più corta: serve per tagliare
 * una riga senza separatore («Cod. Art. TAV-01»), dove il PDF ha appiattito
 * due colonne in uno spazio solo. Si prova prima «cod art» e poi «cod», o
 * «Cod. Art. X» diventerebbe codice = "Art. X".
 */
const ETICHETTE_NOTE = [
  ...SINONIMI_NOME,
  ...SINONIMI_MARCA,
  ...SINONIMI_CODICE,
  ...SINONIMI_PREZZO,
].sort((a, b) => b.length - a.length);

/** Minuscolo, senza accenti, senza punteggiatura di contorno, spazi singoli. */
export function normalizzaEtichetta(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\u00b7\u2022*_]+/g, ' ')
    .replace(/[^a-z0-9\s/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ripulisci(s: string): string {
  return s
    .replace(/[\u00a0\u2007\u202f\u2009\u2002-\u2006]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Una riga di impaginazione, non di contenuto. */
function eFurniture(riga: string): boolean {
  const t = riga.trim();
  if (!t) return true;
  if (/^pag(ina)?\.?\s*\d+(\s*(di|\/|of)\s*\d+)?$/i.test(t)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(t)) return true;
  if (/^[-–—_=.·•\s]+$/.test(t)) return true;
  if (/^(www\.|https?:\/\/)\S+$/i.test(t)) return true;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t)) return true;
  return false;
}

/**
 * Un valore che è un paragrafo. Due segnali: la lunghezza, e la fine di frase
 * seguita da una maiuscola (cioè: più frasi).
 *
 * Il punto deve arrivare dopo almeno tre lettere minuscole, o «Legnami Rossi
 * S.p.A. Milano» verrebbe scambiato per due frasi e buttato via: nelle sigle
 * il punto è dentro la parola, non alla fine.
 */
function sembraProsa(v: string): boolean {
  if (v.length > SOGLIA_PROSA) return true;
  return /[a-zà-ÿ]{3}[.!?]\s+[A-ZÀ-Ý]/.test(v);
}

/** Un'etichetta plausibile: corta, con lettere, non una frase. */
function eEtichettaPlausibile(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > MAX_LUNGHEZZA_ETICHETTA) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(t)) return false;
  if (t.split(/\s+/).length > 6) return false;
  if (/[.!?]$/.test(t) && !/\b[a-z]{1,4}\.$/i.test(t)) return false;
  return normalizzaEtichetta(t).length > 0;
}

function eValorePlausibile(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (!/[a-zA-Z0-9À-ÿ]/.test(t)) return false;
  return true;
}

interface Coppia {
  etichetta: string;
  valore: string;
}

/**
 * Divide una riga in etichetta/valore. Tre forme, nell'ordine di affidabilità:
 *   1) «Etichetta: valore» — i due punti sono un separatore esplicito
 *   2) «Etichetta<TAB>valore» — due colonne di tabella, il TAB lo mette
 *      l'adattatore quando fra le due c'è un vuoto ampio nella pagina
 *   3) «EtichettaNota valore» — nessun separatore rimasto: si taglia solo se
 *      la riga comincia con un'etichetta che conosciamo, mai a indovinare
 * Ritorna null se la riga non è una coppia.
 */
export function dividiRiga(riga: string): Coppia | null {
  const t = riga.trim();
  if (!t) return null;

  const conTab = t.match(/^([^\t]{1,80}?)\t+(.+)$/s);
  const conDuePunti = t.match(/^([^:\t]{1,80}?)\s*[:：]\s*(.+)$/s);

  // I due punti vincono sul TAB solo se compaiono PRIMA: «Peso<TAB>3 kg: netto»
  // ha etichetta «Peso», non «Peso<TAB>3 kg».
  const candidati: Array<RegExpMatchArray | null> =
    conDuePunti && conTab
      ? t.indexOf(':') < t.indexOf('\t')
        ? [conDuePunti, conTab]
        : [conTab, conDuePunti]
      : [conDuePunti, conTab];

  for (const m of candidati) {
    if (!m) continue;
    const etichetta = ripulisci(m[1]!.replace(/\t/g, ' '));
    const valore = ripulisci(m[2]!.replace(/\t/g, ' '));
    if (eEtichettaPlausibile(etichetta) && eValorePlausibile(valore)) {
      return { etichetta, valore };
    }
  }

  // Terza forma: nessun separatore, ma un'etichetta nota in testa.
  const piatto = ripulisci(t.replace(/\t/g, ' '));
  const norm = normalizzaEtichetta(piatto);
  for (const nota of ETICHETTE_NOTE) {
    if (!norm.startsWith(`${nota} `)) continue;
    // Il taglio va fatto sulla riga ORIGINALE, non su quella normalizzata:
    // si conta quante parole occupa l'etichetta e si tagliano quelle.
    const parole = piatto.split(' ');
    let presi = 0;
    for (let n = 1; n <= parole.length; n++) {
      if (normalizzaEtichetta(parole.slice(0, n).join(' ')) === nota) {
        presi = n;
        break;
      }
    }
    if (presi === 0) continue;
    const etichetta = parole.slice(0, presi).join(' ');
    const valore = parole.slice(presi).join(' ').trim();
    if (eEtichettaPlausibile(etichetta) && eValorePlausibile(valore)) {
      return { etichetta, valore };
    }
  }

  return null;
}

function trovaSinonimo(norm: string, elenco: string[]): boolean {
  return elenco.includes(norm);
}

/** Lo SKU ricavato dal nome del file, ultima spiaggia. */
function skuDaFilename(filename: string): string | null {
  const base = filename.replace(/\.[a-z0-9]{1,6}$/i, '').trim();
  const pulito = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return pulito.length >= 2 ? pulito : null;
}

export function extractProductFromPdfText(
  text: string,
  options: PdfExtractOptions = {},
): PdfExtractedProduct {
  const vuoto: PdfExtractedProduct = {
    name: null,
    brand: null,
    sku: null,
    price: null,
    attributes: {},
    source: 'none',
    righeRiconosciute: 0,
    righeTotali: 0,
  };
  if (typeof text !== 'string' || !text.trim()) return vuoto;

  const grezze = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, MAX_RIGHE)
    .map((r) => ripulisci(r))
    .filter((r) => r.length > 0 && !eFurniture(r));

  // Intestazioni e piè di pagina si ripetono a ogni pagina: se una riga
  // identica compare tre volte o più, è impaginazione, non contenuto.
  const conteggio = new Map<string, number>();
  for (const r of grezze) conteggio.set(r, (conteggio.get(r) ?? 0) + 1);
  const righe = grezze.filter((r) => (conteggio.get(r) ?? 0) < 3);

  const attributes: Record<string, string> = {};
  let name: string | null = null;
  let brand: string | null = null;
  let sku: string | null = null;
  let price: string | null = null;
  let source: PdfExtractedProduct['source'] = 'none';
  let righeRiconosciute = 0;
  const libere: string[] = [];
  const etichetteViste = new Set<string>();

  for (const riga of righe) {
    const coppia = dividiRiga(riga);
    if (!coppia) {
      if (!INTESTAZIONI.has(normalizzaEtichetta(riga))) libere.push(riga);
      continue;
    }
    righeRiconosciute++;

    const norm = normalizzaEtichetta(coppia.etichetta);
    if (!norm) continue;
    if (ETICHETTE_DI_PROSA.has(norm)) continue;
    const valore = coppia.valore;
    if (sembraProsa(valore)) continue;
    if (normalizzaEtichetta(valore) === norm) continue;

    if (!name && trovaSinonimo(norm, SINONIMI_NOME)) {
      name = valore;
      source = 'etichetta';
      continue;
    }
    if (!brand && trovaSinonimo(norm, SINONIMI_MARCA)) {
      brand = valore;
      continue;
    }
    if (!sku && trovaSinonimo(norm, SINONIMI_CODICE)) {
      sku = valore;
      continue;
    }
    if (!price && trovaSinonimo(norm, SINONIMI_PREZZO)) {
      price = valore;
      continue;
    }

    // La prima occorrenza vince: nelle schede tecniche una ripetizione più in
    // basso è quasi sempre una tabella riassuntiva, meno precisa.
    if (etichetteViste.has(norm)) continue;
    if (Object.keys(attributes).length >= MAX_ATTRIBUTI) continue;
    etichetteViste.add(norm);
    attributes[coppia.etichetta] = valore;
  }

  if (!name) {
    const suggerito = ripulisci(options.titoloProbabile ?? '');
    if (
      suggerito &&
      suggerito.length >= 3 &&
      !INTESTAZIONI.has(normalizzaEtichetta(suggerito)) &&
      !sembraProsa(suggerito)
    ) {
      name = suggerito;
      source = 'titolo';
    }
  }

  if (!name) {
    const prima = libere.find((r) => r.length >= 3 && !sembraProsa(r));
    if (prima) {
      name = prima;
      source = 'riga';
    }
  }

  if (!sku && options.filename) sku = skuDaFilename(options.filename);

  return {
    name,
    brand,
    sku,
    price,
    attributes,
    source,
    righeRiconosciute,
    righeTotali: righe.length,
  };
}
