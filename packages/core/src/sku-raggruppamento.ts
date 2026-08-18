// Raggruppamento di SKU in prodotti e varianti.
//
// Otto codici colore dello stesso modello sono UN prodotto con otto varianti,
// non otto prodotti. La differenza non è estetica: è otto crediti invece di
// uno, e otto descrizioni quasi identiche che come contenuto duplicato fanno
// male al posizionamento delle pagine del cliente.
//
// Il punto delicato è che un raggruppamento sbagliato fonde prodotti diversi
// in una scheda sola, e nessuno se ne accorge: ogni singolo campo è stato
// letto bene, solo dal prodotto sbagliato. Per questo qui NON si decide.
// Questo modulo PROPONE: ricava una regola dai codici, la applica, misura
// quanto è sostenuta da segnali verificabili, e restituisce tutto — regola,
// gruppi, forza, e cosa costerebbe l'una e l'altra scelta. Chi decide è
// l'utente, davanti all'anteprima.
//
// Funzioni PURE: nessuna rete, nessun database, nessun modello.

export interface SkuNormalizzato {
  /** Com'era scritto, intatto: è la chiave verso il gestionale del cliente. */
  originale: string;
  /** Maiuscolo, senza accenti, separatori uniformati a «-». */
  normalizzato: string;
  /** Senza separatori: «AB-12-RED» e «AB12RED» sono lo stesso codice. */
  compatto: string;
}

/**
 * Normalizza uno SKU per confronto e ricerca.
 *
 * Serve una forma normalizzata E una compatta perché i cataloghi scrivono lo
 * stesso codice in modi diversi: sul sito del produttore «AB-12-RED», nel
 * gestionale del cliente «ab12red». Cercarne una sola vuol dire non trovarlo.
 */
export function normalizzaSku(sku: string): SkuNormalizzato {
  const originale = (sku ?? '').trim();
  const normalizzato = originale
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s._/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return { originale, normalizzato, compatto: normalizzato.replace(/-/g, '') };
}

export type TipoRegola =
  /** Il codice modello è dichiarato in una colonna: non c'è niente da indovinare. */
  | 'colonna'
  /** «MOD-RED-S» → «MOD-RED»: cade l'ultimo pezzo. */
  | 'taglia-ultimo-pezzo'
  /** «MOD-RED-S» → «MOD»: cadono gli ultimi due. */
  | 'taglia-ultimi-due-pezzi'
  /** I primi N caratteri, quando i codici non hanno separatori. */
  | 'prefisso-fisso';

export interface RegolaRaggruppamento {
  tipo: TipoRegola;
  /** Solo per «prefisso-fisso». */
  lunghezza?: number;
  /** Come si legge in italiano, per mostrarla all'utente. */
  descrizione: string;
}

/**
 * Applica la regola a uno SKU e ritorna il codice modello.
 * `null` quando la regola non è applicabile a quel codice (per esempio non ha
 * abbastanza pezzi): quello SKU resterà un prodotto a sé.
 */
export function applicaRegola(sku: string, regola: RegolaRaggruppamento): string | null {
  const { normalizzato } = normalizzaSku(sku);
  if (!normalizzato) return null;

  if (regola.tipo === 'prefisso-fisso') {
    const n = regola.lunghezza ?? 0;
    if (n <= 0 || normalizzato.length <= n) return null;
    return normalizzato.slice(0, n);
  }

  const pezzi = normalizzato.split('-').filter(Boolean);
  const daTogliere = regola.tipo === 'taglia-ultimi-due-pezzi' ? 2 : 1;
  // Deve restare almeno un pezzo: «RED-S» non ha un modello da cui derivare.
  if (pezzi.length <= daTogliere) return null;
  return pezzi.slice(0, pezzi.length - daTogliere).join('-');
}

/** Ciò che di uno SKU resta fuori dal codice modello: il colore, la taglia. */
function suffisso(sku: string, codiceModello: string): string {
  const { normalizzato } = normalizzaSku(sku);
  if (!normalizzato.startsWith(codiceModello)) return normalizzato;
  return normalizzato.slice(codiceModello.length).replace(/^-+/, '');
}

export interface GruppoProposto {
  codiceModello: string;
  /** Gli SKU del gruppo, nella forma originale. */
  sku: string[];
  /** Cosa distingue una variante dall'altra, nell'ordine degli SKU. */
  suffissi: string[];
}

export interface PropostaRaggruppamento {
  regola: RegolaRaggruppamento;
  gruppi: GruppoProposto[];
  /** Quanti prodotti verrebbero fuori (gruppi + codici non raggruppabili). */
  prodotti: number;
  /** Quanti SKU in totale, cioè quante varianti. */
  varianti: number;
  /**
   * Quanto la proposta è sostenuta da segnali, da 0 a 1. NON è una probabilità
   * e non va usata per decidere da soli: serve a ordinare le proposte e a dire
   * all'utente quanto guardare bene.
   */
  forza: number;
  /** Perché quella forza, in italiano: va mostrato accanto al numero. */
  motivi: string[];
}

// L'ordine di questa lista non deve contare, e infatti la più aggressiva sta
// per prima: se un giorno il criterio di parità in `proponiRaggruppamenti`
// sparisse, l'ordinamento stabile lascerebbe davanti proprio quella che fonde
// di più, e le prove diventerebbero rosse. Era il contrario finché la regola
// prudente stava in cima: il comportamento giusto usciva dall'ordine di due
// righe, non da una decisione, e nessuna prova se ne sarebbe accorta.
const REGOLE_CANDIDATE: RegolaRaggruppamento[] = [
  { tipo: 'taglia-ultimi-due-pezzi', descrizione: 'Togli gli ultimi due pezzi (es. MOD-RED-S → MOD)' },
  { tipo: 'taglia-ultimo-pezzo', descrizione: 'Togli l’ultimo pezzo del codice (es. MOD-RED-S → MOD-RED)' },
];

/** Raggruppa gli SKU secondo la regola, tenendo l'ordine di arrivo. */
export function raggruppa(skus: string[], regola: RegolaRaggruppamento): {
  gruppi: GruppoProposto[];
  nonRaggruppati: string[];
} {
  const perModello = new Map<string, GruppoProposto>();
  const nonRaggruppati: string[] = [];

  for (const sku of skus) {
    const modello = applicaRegola(sku, regola);
    if (!modello) {
      nonRaggruppati.push(sku);
      continue;
    }
    let g = perModello.get(modello);
    if (!g) {
      g = { codiceModello: modello, sku: [], suffissi: [] };
      perModello.set(modello, g);
    }
    g.sku.push(sku);
    g.suffissi.push(suffisso(sku, modello));
  }

  // Un «gruppo» di uno solo non è un gruppo: quel codice è un prodotto a sé.
  const gruppi: GruppoProposto[] = [];
  for (const g of perModello.values()) {
    if (g.sku.length >= 2) gruppi.push(g);
    else nonRaggruppati.push(...g.sku);
  }
  return { gruppi, nonRaggruppati };
}

/**
 * Quanto la proposta si regge su segnali invece che su fiducia.
 *
 * Il segnale che conta davvero è la RICORRENZA DEI SUFFISSI. Se in un listino
 * di moda i suffissi sono {RED-S, RED-M, BLU-S, BLU-M} e tornano identici su
 * più modelli, quello non è un caso: è un sistema di codifica, e la regola l'ha
 * trovato. Se invece ogni gruppo ha suffissi che non si ripetono mai altrove,
 * la regola sta tagliando via pezzi di codice che appartengono al prodotto — ed
 * è esattamente il modo in cui si fondono due articoli diversi.
 */
function valuta(gruppi: GruppoProposto[], totaleSku: number): { forza: number; motivi: string[] } {
  const motivi: string[] = [];
  if (gruppi.length === 0 || totaleSku === 0) return { forza: 0, motivi: ['Nessun gruppo trovato.'] };

  const skuRaggruppati = gruppi.reduce((n, g) => n + g.sku.length, 0);
  const coperturaSku = skuRaggruppati / totaleSku;

  const gruppiPerSuffisso = new Map<string, number>();
  for (const g of gruppi) {
    for (const s of new Set(g.suffissi)) {
      gruppiPerSuffisso.set(s, (gruppiPerSuffisso.get(s) ?? 0) + 1);
    }
  }
  const suffissiTotali = gruppiPerSuffisso.size;
  const suffissiRicorrenti = [...gruppiPerSuffisso.values()].filter((n) => n >= 2).length;
  // Con un gruppo solo la ricorrenza non è misurabile: non è un buon segnale né
  // un cattivo segnale, e dirlo è più onesto che inventare una frazione.
  const ricorrenza = gruppi.length >= 2 && suffissiTotali > 0 ? suffissiRicorrenti / suffissiTotali : 0;

  motivi.push(
    `${skuRaggruppati} codici su ${totaleSku} finiscono in un gruppo (${Math.round(coperturaSku * 100)}%).`,
  );
  if (gruppi.length >= 2) {
    motivi.push(
      suffissiRicorrenti > 0
        ? `${suffissiRicorrenti} suffissi su ${suffissiTotali} tornano su più modelli: sembra un sistema di codifica.`
        : 'Nessun suffisso torna su più di un modello: la regola potrebbe star tagliando parte del codice prodotto.',
    );
  } else {
    motivi.push('Un solo gruppo: non c’è modo di verificare che i suffissi si ripetano.');
  }

  // Tutti i codici in un gruppo solo: qui va detta una cosa scomoda invece di
  // fingere una regola.
  //
  // «TS100-RED, TS100-BLU» e «CAT-SEDIA, CAT-TAVOLO» hanno la STESSA forma: un
  // prefisso in comune e suffissi diversi. Dai soli codici non esiste alcun
  // segnale che distingua un articolo in due colori da due articoli diversi che
  // cominciano uguale. Qualunque regola scriva qui accetta tutti e due o
  // rifiuta tutti e due; sceglierne uno vorrebbe dire indovinare, e indovinare
  // è proprio il modo in cui due prodotti finiscono in una scheda sola.
  //
  // Quindi la proposta si fa lo stesso — è il caso più comune e più utile, gli
  // otto colori di un modello — ma arriva all'utente con forza bassa e con la
  // ragione scritta accanto, perché guardi il campione.
  if (gruppi.length === 1 && gruppi[0]!.sku.length === totaleSku) {
    motivi.push(
      'Tutti i codici finiscono in un prodotto solo: dai codici non si può distinguere ' +
        'un articolo in più colori da più articoli diversi che cominciano uguale. Controlla il campione.',
    );
  }

  return { forza: Number((coperturaSku * 0.4 + ricorrenza * 0.6).toFixed(3)), motivi };
}

/**
 * Propone la regola migliore per questi codici, o `null` se nessuna regge.
 *
 * `null` non è un fallimento da nascondere: vuol dire «questi codici non
 * dicono di appartenere a modelli comuni», ed è un'informazione. Chi la riceve
 * mostra all'utente l'ipotesi «ogni SKU è un prodotto» come scelta esplicita.
 */
export function proponiRaggruppamenti(skus: string[]): PropostaRaggruppamento[] {
  const puliti = skus.map((s) => (s ?? '').trim()).filter(Boolean);
  if (puliti.length < 2) return [];

  const proposte: PropostaRaggruppamento[] = [];
  for (const regola of REGOLE_CANDIDATE) {
    const { gruppi } = raggruppa(puliti, regola);
    if (gruppi.length === 0) continue;
    const { forza, motivi } = valuta(gruppi, puliti.length);
    if (forza <= 0) continue;
    const skuRaggruppati = gruppi.reduce((n, g) => n + g.sku.length, 0);
    proposte.push({
      regola,
      gruppi,
      prodotti: gruppi.length + (puliti.length - skuRaggruppati),
      varianti: puliti.length,
      forza,
      motivi,
    });
  }

  // A parità di segnali vince la regola che lascia PIÙ prodotti.
  //
  // Non è timidezza: gli errori delle due direzioni non si equivalgono. Tenere
  // separati due articoli che erano lo stesso costa un credito in più, e si
  // vede subito perché escono due schede gemelle. Fonderne due che erano
  // diversi produce una scheda sola che parla di un prodotto e ne descrive un
  // altro, e non se ne accorge nessuno. Fra i due sbagli si sceglie quello che
  // si nota.
  proposte.sort((a, b) => b.forza - a.forza || b.prodotti - a.prodotti);
  return proposte;
}

/** La proposta migliore, o `null` se nessuna regge. Vedi `proponiRaggruppamenti`. */
export function proponiRaggruppamento(skus: string[]): PropostaRaggruppamento | null {
  return proponiRaggruppamenti(skus)[0] ?? null;
}

export interface AnteprimaCosti {
  skuCaricati: number;
  /** Prodotti se si accetta il raggruppamento. */
  prodottiRaggruppati: number;
  /** Prodotti se lo si rifiuta: uno per SKU. */
  prodottiSenzaRaggruppamento: number;
  /** Crediti di generazione nei due casi (1 credito = 1 scheda). */
  creditiRaggruppati: number;
  creditiSenzaRaggruppamento: number;
  /** Quanti crediti si risparmiano accettando. Mai negativo. */
  creditiRisparmiati: number;
}

/**
 * Cosa costa l'una e l'altra scelta, in crediti.
 *
 * Va mostrato NELLA schermata del raggruppamento, non spiegato altrove: è lì
 * che l'utente decide, ed è l'unico posto in cui il numero cambia qualcosa.
 */
export function anteprimaCosti(
  skuCaricati: number,
  prodottiRaggruppati: number,
): AnteprimaCosti {
  const caricati = Math.max(0, skuCaricati);
  const raggruppati = Math.max(0, Math.min(prodottiRaggruppati, caricati));
  return {
    skuCaricati: caricati,
    prodottiRaggruppati: raggruppati,
    prodottiSenzaRaggruppamento: caricati,
    creditiRaggruppati: raggruppati,
    creditiSenzaRaggruppamento: caricati,
    creditiRisparmiati: caricati - raggruppati,
  };
}
