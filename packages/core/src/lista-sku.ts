// La lista di codici che il cliente incolla, e quanto ci si può fidare dei
// domini su cui li si trova.
//
// Funzioni PURE.

import { normalizzaMarca, type LivelloDominio } from './sku-risoluzione.js';

export interface RigaListaSku {
  sku: string;
  /** Il codice modello dichiarato, se la lista ce l'ha. */
  codiceModello: string | null;
  marca: string | null;
  /** Colore, taglia o finitura già noti al cliente. */
  attributoVariante: string | null;
  /** Domini a cui limitare la ricerca per questa riga. */
  domini: string[];
}

/** Massimo di righe per lavorazione, coerente col tetto delle altre fonti. */
export const MAX_RIGHE_LISTA = 2000;

function pulisci(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length ? t : null;
}

/**
 * Legge una lista incollata a mano: un codice per riga.
 *
 * Accetta anche `codice; marca` e `codice, marca`, perché è come la gente
 * incolla da un foglio. Non prova a indovinare più colonne di così: per quelle
 * c'è il caricamento del CSV con la mappatura, dove l'utente dice lui quale
 * colonna è cosa invece di sperare che il separatore basti.
 */
export function analizzaListaIncollata(testo: string): RigaListaSku[] {
  const viste = new Set<string>();
  const righe: RigaListaSku[] = [];

  for (const riga of (testo ?? '').split(/\r\n?|\n/)) {
    const t = riga.trim();
    if (!t) continue;
    const pezzi = t.split(/[;,\t]/).map((p) => p.trim());
    const sku = pulisci(pezzi[0]);
    if (!sku) continue;
    // Lo stesso codice due volte è una riga sola: cercarlo due volte costa due
    // chiamate e produce due prodotti con lo stesso SKU.
    const chiave = sku.toLowerCase();
    if (viste.has(chiave)) continue;
    viste.add(chiave);

    righe.push({
      sku,
      codiceModello: null,
      marca: pulisci(pezzi[1]),
      attributoVariante: null,
      domini: [],
    });
    if (righe.length >= MAX_RIGHE_LISTA) break;
  }
  return righe;
}

// ---------------------------------------------------------------------------
// Il caricamento da file, con la mappatura delle colonne.
//
// Incollare un elenco basta finché i codici sono cento. A duemila righe il
// cliente ha un foglio, e in quel foglio la marca e il codice modello di solito
// ci sono già — sono le due cose che alzano di più la precisione della ricerca.
// Chiederglieli a mano quando li ha davanti sarebbe fargli ribattere dati suoi.
//
// La mappatura è dichiarata dall'utente, non indovinata: qui si SUGGERISCE, e
// il suggerimento parte da intestazioni che si riconoscono. Sbagliare colonna
// vuol dire cercare online la parola «Rosso» invece del codice articolo.
// ---------------------------------------------------------------------------

export interface MappaturaListaSku {
  sku: string;
  codiceModello?: string | null;
  marca?: string | null;
  attributoVariante?: string | null;
  /** Colonna con i domini a cui limitare la ricerca per quella riga. */
  ambito?: string | null;
}

const SINONIMI_COLONNA: Record<keyof MappaturaListaSku, string[]> = {
  sku: ['sku', 'codice', 'codice articolo', 'cod articolo', 'cod. articolo', 'codice prodotto', 'articolo', 'ean', 'barcode', 'part number', 'partnumber', 'item code', 'product code', 'ref', 'riferimento'],
  codiceModello: ['codice modello', 'modello', 'cod modello', 'model', 'model code', 'codice padre', 'parent', 'parent id', 'gruppo', 'group'],
  marca: ['marca', 'brand', 'produttore', 'fabbricante', 'manufacturer', 'vendor'],
  attributoVariante: ['colore', 'color', 'taglia', 'size', 'finitura', 'finish', 'variante', 'variant'],
  ambito: ['sito', 'dominio', 'domini', 'url', 'fornitore', 'site', 'ambito'],
};

function normalizzaIntestazione(h: string): string {
  return (h ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Suggerisce quale colonna è cosa. Solo un suggerimento: decide l'utente.
 *
 * `sku` resta `null` quando nessuna intestazione si riconosce — ed è giusto che
 * resti vuoto invece di prendere la prima colonna: senza lo SKU non c'è niente
 * da cercare, e una colonna scelta a caso manderebbe a cercare online i nomi
 * dei colori.
 */
export function suggerisciColonneListaSku(intestazioni: string[]): MappaturaListaSku {
  const trovate = new Map<string, string>();
  for (const h of intestazioni ?? []) trovate.set(normalizzaIntestazione(h), h);

  const primaChe = (sinonimi: string[]): string | null => {
    for (const s of sinonimi) {
      const h = trovate.get(s);
      if (h) return h;
    }
    return null;
  };

  return {
    sku: primaChe(SINONIMI_COLONNA.sku) ?? '',
    codiceModello: primaChe(SINONIMI_COLONNA.codiceModello ?? []),
    marca: primaChe(SINONIMI_COLONNA.marca ?? []),
    attributoVariante: primaChe(SINONIMI_COLONNA.attributoVariante ?? []),
    ambito: primaChe(SINONIMI_COLONNA.ambito ?? []),
  };
}

/**
 * Applica la mappatura alle righe del foglio.
 *
 * Le righe senza SKU vengono saltate, non riempite: un prodotto senza codice
 * non si può cercare e non si può riagganciare al gestionale del cliente.
 */
export function righeDaTabella(
  righeFoglio: Array<Record<string, string>>,
  mappatura: MappaturaListaSku,
): RigaListaSku[] {
  // Nessuna guardia sulla colonna mancante: se non è mappata, nessuna riga ha
  // quella chiave e il ciclo qui sotto le salta tutte. Il primo tentativo aveva
  // un `return []` anticipato, e toglierlo non faceva diventare rossa nessuna
  // prova — cioè era codice che sembrava proteggere qualcosa e non proteggeva
  // niente.
  const colonnaSku = (mappatura.sku ?? '').trim();

  const viste = new Set<string>();
  const out: RigaListaSku[] = [];
  for (const riga of righeFoglio ?? []) {
    const sku = pulisci(riga[colonnaSku]);
    if (!sku) continue;
    const chiave = sku.toLowerCase();
    if (viste.has(chiave)) continue;
    viste.add(chiave);

    const ambito = mappatura.ambito ? pulisci(riga[mappatura.ambito]) : null;
    out.push({
      sku,
      codiceModello: mappatura.codiceModello ? pulisci(riga[mappatura.codiceModello]) : null,
      marca: mappatura.marca ? pulisci(riga[mappatura.marca]) : null,
      attributoVariante: mappatura.attributoVariante ? pulisci(riga[mappatura.attributoVariante]) : null,
      domini: ambito ? ambito.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean) : [],
    });
    if (out.length >= MAX_RIGHE_LISTA) break;
  }
  return out;
}

/** Il dominio ridotto alla forma con cui si confronta: niente schema, niente www. */
export function normalizzaDominio(d: string): string {
  return (d ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

/**
 * La marca ridotta a una parola sola, per confrontarla con un dominio.
 *
 * Passa dalla stessa normalizzazione usata per confrontare due marche fra loro:
 * senza, «Ferrini S.r.l.» diventava «ferrinisrl» e non combaciava più con
 * `ferrini.it` — cioè il sito del produttore veniva declassato a terza parte
 * per colpa di una sigla societaria, e i suoi dati smettevano di poter
 * sostenere un claim.
 */
function parolaChiaveMarca(marca: string): string {
  return normalizzaMarca(marca).replace(/[^a-z0-9]+/g, '');
}

/**
 * Il nome sotto cui il dominio è registrato: la penultima etichetta.
 *
 * Serve per distinguere tre casi che si assomigliano e vogliono dire cose
 * diverse:
 *
 *   ferrini.it            → «ferrini»        il sito del produttore
 *   shop.ferrini.it       → «ferrini»        un sottodominio suo, sempre suo
 *   ferrini.marketplace.com → «marketplace»  un rivenditore che ospita la marca
 *   mercatoferrini.com    → «mercatoferrini» un rivenditore che ne porta il nome
 *
 * Le ultime due NON sono il produttore, e un confronto approssimativo — il nome
 * della marca che «compare da qualche parte» nel dominio — le prometterebbe
 * come tali. È il livello che autorizza «certificato»: qui approssimare vuol
 * dire far firmare al cliente una dichiarazione sulla parola di un rivenditore.
 *
 * Sui suffissi composti (`.co.uk`) l'etichetta trovata è «co», che non
 * combacia con nessuna marca: si finisce in «terza parte», che è il verso
 * giusto in cui sbagliare.
 */
function nomeRegistrato(dominio: string): string {
  const etichette = dominio.split('.').filter(Boolean);
  if (etichette.length < 2) return etichette[0] ?? '';
  return (etichette[etichette.length - 2] ?? '').replace(/[^a-z0-9]/g, '');
}

/**
 * Quanto vale un dominio, e da dove viene questo giudizio.
 *
 * Non c'è nessun elenco di «siti buoni» scritto da noi: sarebbe una nostra
 * opinione presentata come un fatto, e su di essa poggerebbe il permesso di
 * scrivere «certificato» in una scheda. Il livello viene solo da cose che il
 * cliente ha dichiarato:
 *
 *   produttore  — il nome della marca che ha dichiarato lui compare nel dominio
 *                 (marca «Ferrini» su `ferrini.it`);
 *   fornitore   — il dominio è fra quelli che ha indicato come ambito di
 *                 ricerca: si fida lui, ce ne fidiamo noi;
 *   terza-parte — tutto il resto.
 *
 * «Tutto il resto» comprende anche i domini che semplicemente non sappiamo
 * giudicare, e li tratta come terze parti apposta: un livello che non si può
 * verificare non può concedere fiducia, o la concessione la sta facendo il
 * caso.
 */
export function livelloDelDominio(
  dominio: string,
  marca: string | null,
  dominiDichiarati: string[] = [],
): LivelloDominio {
  const d = normalizzaDominio(dominio);
  if (!d) return 'terza-parte';

  const chiave = marca ? parolaChiaveMarca(marca) : '';
  // Almeno tre caratteri: una marca di due lettere combacerebbe con mezza
  // internet, e «produttore» è il livello che autorizza i claim.
  if (chiave.length >= 3 && nomeRegistrato(d) === chiave) return 'produttore';

  const dichiarati = new Set(dominiDichiarati.map(normalizzaDominio).filter(Boolean));
  if (dichiarati.has(d)) return 'fornitore';
  // Un sottodominio di un dominio dichiarato è dello stesso fornitore.
  for (const dd of dichiarati) if (d.endsWith(`.${dd}`)) return 'fornitore';

  return 'terza-parte';
}
