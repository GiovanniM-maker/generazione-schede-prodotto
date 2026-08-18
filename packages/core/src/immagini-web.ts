// Quali immagini di una pagina sono foto del prodotto, e quali no.
//
// Una pagina prodotto contiene il logo del negozio, i badge dei circuiti di
// pagamento, le icone dei social, i banner della promozione in corso e le
// miniature dei «prodotti correlati». Prenderle tutte vuol dire riempire la
// scheda del cliente di roba altrui e pagare lo storage per conservarla.
//
// Qui NON si generano immagini: si scelgono fra quelle che la pagina ha già.
// La produzione di immagini per variante non fa parte di questa funzione e non
// deve comparire da nessuna parte, nemmeno come opzione spenta.
//
// L'altra regola, che vale quanto la prima: **quando la pagina non dichiara a
// quale colore appartiene una foto, non si indovina**. La foto resta al
// prodotto, e la variante eredita quelle del prodotto — e questo va mostrato,
// non nascosto. Assegnare a occhio la foto rossa alla variante rossa funziona
// finché il catalogo non ha due rossi diversi.
//
// Funzioni PURE.

export interface ImmagineCandidata {
  url: string;
  /** Il testo alternativo dichiarato dalla pagina. */
  alt?: string | null;
  /** Larghezza e altezza, se la pagina le dichiara. `null` = non le sappiamo. */
  larghezza?: number | null;
  altezza?: number | null;
  /** Dichiarata come immagine principale nei dati strutturati. */
  principale?: boolean;
  /** Posizione nella galleria, se la pagina ne ha una. */
  posizione?: number | null;
  /**
   * Il valore della variante a cui la PAGINA la associa esplicitamente
   * («Rosso», «42»). `null` quando la pagina non lo dice — che è il caso
   * normale, ed è quello in cui non si indovina.
   */
  varianteDichiarata?: string | null;
}

export interface OpzioniSelezione {
  /** Sotto questa misura non è una foto di prodotto. */
  minLatoPx?: number;
  /** Quante tenerne al massimo. */
  massimo?: number;
}

export const MIN_LATO_PX = 600;
export const MAX_IMMAGINI_PRODOTTO = 8;

/**
 * Pezzi di indirizzo e di testo alternativo che dicono «non sono il prodotto».
 *
 * È un elenco, non un modello: elencare è verificabile e si corregge in un
 * minuto quando arriva il caso che manca. Un classificatore qui direbbe di sì
 * al logo del negozio una volta su dieci, e nessuno se ne accorgerebbe.
 */
const PAROLE_DA_SCARTARE = [
  'logo',
  'banner',
  'sprite',
  'icon',
  'icone',
  'favicon',
  'placeholder',
  'segnaposto',
  'no-image',
  'noimage',
  'nophoto',
  'default-product',
  'badge',
  'payment',
  'pagamenti',
  'visa',
  'mastercard',
  'paypal',
  'social',
  'facebook',
  'instagram',
  'whatsapp',
  'spinner',
  'loader',
  'pixel',
  'tracking',
  'watermark',
  'avatar',
  'flag-',
  'bandiera',
];

/** `true` quando l'indirizzo o l'alt dicono che non è una foto di prodotto. */
export function daScartare(img: ImmagineCandidata): boolean {
  const spia = `${img.url ?? ''} ${img.alt ?? ''}`.toLowerCase();
  if (!img.url || !/^https?:\/\//i.test(img.url)) return true;
  // Un'immagine incorporata nell'indirizzo è quasi sempre un segnaposto o
  // un'icona: una foto di prodotto vera pesa troppo per stare lì.
  if (/^data:/i.test(img.url)) return true;
  if (/\.svg(\?|$)/i.test(img.url)) return true;
  return PAROLE_DA_SCARTARE.some((p) => spia.includes(p));
}

/** `true` quando la pagina dichiara misure sotto il minimo. */
export function troppoPiccola(img: ImmagineCandidata, minLato = MIN_LATO_PX): boolean {
  const l = img.larghezza ?? null;
  const a = img.altezza ?? null;
  // Misure non dichiarate non sono misure piccole: chi scarica il file le
  // misurerà davvero. Scartare qui vorrebbe dire perdere le pagine che non
  // dichiarano le dimensioni, che sono tante.
  if (l == null && a == null) return false;
  if (l != null && l < minLato) return true;
  if (a != null && a < minLato) return true;
  return false;
}

export interface ImmagineScelta extends ImmagineCandidata {
  /** Perché è stata messa in questa posizione: diagnostica leggibile. */
  motivoOrdine: string;
}

/**
 * Le immagini da tenere, nell'ordine in cui vanno usate.
 *
 * L'ordine viene dai segnali che la pagina dà già — l'immagine dichiarata
 * principale, poi la posizione in galleria — e non da una valutazione di quanto
 * «bella» sia una foto, che non sapremmo fare e non sapremmo spiegare.
 */
export function selezionaImmagini(
  candidate: ImmagineCandidata[],
  opzioni: OpzioniSelezione = {},
): ImmagineScelta[] {
  const minLato = opzioni.minLatoPx ?? MIN_LATO_PX;
  const massimo = Math.max(1, opzioni.massimo ?? MAX_IMMAGINI_PRODOTTO);

  const viste = new Set<string>();
  const tenute: ImmagineScelta[] = [];
  for (const img of candidate ?? []) {
    if (daScartare(img) || troppoPiccola(img, minLato)) continue;
    // La stessa foto compare spesso più volte nella stessa pagina e su più
    // varianti: tenerla due volte la fa pagare due volte di storage.
    if (viste.has(img.url)) continue;
    viste.add(img.url);
    tenute.push({
      ...img,
      motivoOrdine: img.principale
        ? 'dichiarata principale dalla pagina'
        : img.posizione != null
          ? `posizione ${img.posizione} in galleria`
          : 'ordine di comparsa',
    });
  }

  const posizioneDi = (i: ImmagineScelta) => i.posizione ?? Number.MAX_SAFE_INTEGER;
  return tenute
    .map((img, indice) => ({ img, indice }))
    .sort((a, b) => {
      if (Boolean(b.img.principale) !== Boolean(a.img.principale)) return a.img.principale ? -1 : 1;
      const p = posizioneDi(a.img) - posizioneDi(b.img);
      // A parità resta l'ordine di comparsa: un ordinamento che rimescola
      // rende l'import non ripetibile, e due esecuzioni sullo stesso catalogo
      // darebbero due copertine diverse.
      return p !== 0 ? p : a.indice - b.indice;
    })
    .slice(0, massimo)
    .map((x) => x.img);
}

export interface AssegnazioneImmagini {
  /** Restano al prodotto: la pagina non dice a quale variante appartengano. */
  alProdotto: ImmagineScelta[];
  /** Assegnate per valore di variante, come dichiarato dalla PAGINA. */
  perVariante: Map<string, ImmagineScelta[]>;
  /**
   * `true` quando almeno una variante non ha immagini proprie e userà quelle
   * del prodotto. Va mostrato: chi guarda deve sapere che quella foto non è
   * della sua colorazione.
   */
  ereditano: boolean;
}

/**
 * Divide le immagini fra prodotto e varianti.
 *
 * Si assegna SOLO quello che la pagina dichiara. Quando non lo dichiara, le
 * foto restano al prodotto: non c'è nessun modo onesto di sapere quale foto sia
 * di quale colore, e sbagliando si mette in vetrina la foto sbagliata accanto
 * al codice giusto.
 */
export function assegnaAlleVarianti(
  immagini: ImmagineScelta[],
  valoriVariante: string[],
): AssegnazioneImmagini {
  const normalizza = (s: string) => s.trim().toLowerCase();
  const attesi = new Map(valoriVariante.map((v) => [normalizza(v), v]));

  const alProdotto: ImmagineScelta[] = [];
  const perVariante = new Map<string, ImmagineScelta[]>();

  for (const img of immagini) {
    const dichiarata = img.varianteDichiarata ? normalizza(img.varianteDichiarata) : '';
    const valore = dichiarata ? attesi.get(dichiarata) : undefined;
    // Una variante dichiarata dalla pagina che il cliente non ha caricato non
    // crea una variante nuova: quella è una segnalazione, non un'importazione.
    if (!valore) {
      alProdotto.push(img);
      continue;
    }
    const elenco = perVariante.get(valore) ?? [];
    elenco.push(img);
    perVariante.set(valore, elenco);
  }

  const ereditano = valoriVariante.some((v) => (perVariante.get(v) ?? []).length === 0);
  return { alProdotto, perVariante, ereditano };
}
