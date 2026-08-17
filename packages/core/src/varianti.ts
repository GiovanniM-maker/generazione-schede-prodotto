// Da righe a prodotti con varianti.
//
// Il modello a due livelli esisteva già sulla carta — la tabella
// `product_variants`, la colonna `parent_external_id`, una funzione
// `groupVariants` — e non lo usava nessuno: ogni riga del file diventava un
// prodotto, quindi un credito, quindi una descrizione. Otto colori dello stesso
// modello costavano otto crediti e producevano otto testi quasi identici, che
// per un motore di ricerca sono contenuto duplicato sulle pagine del cliente.
//
// Questo modulo fa la parte che mancava, e la fa senza inventare niente. Il
// prodotto tiene SOLO i fatti su cui tutte le sue varianti concordano; quelli
// su cui differiscono sono, per definizione, ciò che distingue una variante
// dall'altra, e restano alla variante. Non c'è una regola che decida «il colore
// è di variante»: lo decidono i dati, guardando dove sono diversi.
//
// Funzioni PURE.

export interface RigaProdotto {
  sku: string;
  externalId: string;
  /** Il codice modello dichiarato. `null` se la riga è un prodotto a sé. */
  parentExternalId: string | null;
  name: string;
  category: string | null;
  /** Fatti canonici della riga, `sku` compreso. */
  canonicalAttributes: Record<string, string>;
}

export interface VarianteUnita {
  sku: string;
  externalId: string;
  /** Solo ciò che distingue questa variante: colore, taglia, finitura. */
  attributiVariante: Record<string, string>;
}

export interface ProdottoUnito {
  /** Il codice padre quando c'è, altrimenti lo SKU della riga singola. */
  externalId: string;
  sku: string;
  name: string;
  category: string | null;
  /** I fatti veri per TUTTE le varianti. È quello che l'AI riceve. */
  canonicalAttributes: Record<string, string>;
  /** Vuoto quando il prodotto non ha varianti: è una riga sola. */
  varianti: VarianteUnita[];
  /** Da quali righe è nato: serve a contare e a tornare indietro. */
  skuOriginali: string[];
  /**
   * `true` quando il nome è stato ricavato dalla parte comune ai nomi delle
   * varianti invece che da una riga padre dichiarata. Va mostrato: è un dato
   * derivato, non dichiarato.
   */
  nomeDerivato: boolean;
}

/** `sku` non è un fatto del prodotto: è la sua chiave, e cambia per variante. */
const CHIAVI_NON_CONFRONTABILI = new Set(['sku', 'external_id', 'parent_external_id']);

/**
 * La parte iniziale comune a più nomi, tagliata su una parola intera.
 *
 * «T-shirt Aurora Rossa» e «T-shirt Aurora Blu» danno «T-shirt Aurora». Non è
 * un'invenzione: è testo che il cliente ha scritto, ridotto alla parte che vale
 * per tutte le varianti. Ritorna `null` quando la parte comune è troppo corta
 * per essere un nome — meglio tenere il nome di una variante che consegnare
 * un moncone.
 */
export function prefissoComune(nomi: string[]): string | null {
  const validi = nomi.map((n) => (n ?? '').trim()).filter(Boolean);
  if (validi.length < 2) return null;

  let comune = validi[0]!;
  for (const n of validi.slice(1)) {
    let i = 0;
    while (i < comune.length && i < n.length && comune[i]!.toLowerCase() === n[i]!.toLowerCase()) i++;
    comune = comune.slice(0, i);
    if (!comune) return null;
  }

  // Taglio su parola intera: «T-shirt Auro» non è il nome di niente.
  const parole = comune.trim().split(/\s+/).filter(Boolean);
  if (comune !== validi[0] && parole.length > 0 && !/\s$/.test(comune)) {
    // L'ultima parola potrebbe essere tronca: si tiene solo se in TUTTI i nomi
    // è seguita da uno spazio o dalla fine.
    const candidato = parole.join(' ');
    const interaOvunque = validi.every((n) => {
      const dopo = n.slice(candidato.length);
      return dopo === '' || /^[\s\-–—,(]/.test(dopo);
    });
    if (!interaOvunque) parole.pop();
  }

  const nome = parole.join(' ').replace(/[\s\-–—,]+$/, '').trim();
  return nome.length >= 3 ? nome : null;
}

/** Il valore più frequente, a parità il primo incontrato. */
function piuFrequente(valori: Array<string | null>): string | null {
  const conteggio = new Map<string, number>();
  for (const v of valori) {
    if (v == null || v === '') continue;
    conteggio.set(v, (conteggio.get(v) ?? 0) + 1);
  }
  let migliore: string | null = null;
  let max = 0;
  for (const [v, n] of conteggio) {
    if (n > max) {
      max = n;
      migliore = v;
    }
  }
  return migliore;
}

function prodottoDaRigaSingola(r: RigaProdotto): ProdottoUnito {
  return {
    externalId: r.externalId,
    sku: r.sku,
    name: r.name,
    category: r.category,
    canonicalAttributes: { ...r.canonicalAttributes },
    varianti: [],
    skuOriginali: [r.sku],
    nomeDerivato: false,
  };
}

/**
 * Unisce le righe che dichiarano lo stesso codice padre in un prodotto solo.
 *
 * L'ordine di arrivo è conservato: il catalogo importato deve somigliare al
 * file caricato, o chi lo rilegge non ritrova le sue righe.
 */
export function unisciVarianti(righe: RigaProdotto[]): ProdottoUnito[] {
  // Primo giro: quali codici padre sono davvero rivendicati da qualche figlio.
  //
  // Serve prima di smistare, perché la riga del padre — quella il cui SKU È il
  // codice padre — dichiara sé stessa come padre, e a guardarla da sola sembra
  // un prodotto indipendente. Smistando in un giro solo finiva fuori dal
  // gruppo, e usciva un secondo prodotto con lo stesso identico codice del
  // primo: due schede, due crediti, e un export con due padri uguali.
  const chiaviPadre = new Set<string>();
  for (const r of righe) {
    if (r.parentExternalId && r.parentExternalId !== r.externalId) chiaviPadre.add(r.parentExternalId);
  }

  const perPadre = new Map<string, RigaProdotto[]>();
  const ordine: Array<{ tipo: 'padre'; chiave: string } | { tipo: 'singola'; riga: RigaProdotto }> = [];

  for (const r of righe) {
    const figlioDi = r.parentExternalId && r.parentExternalId !== r.externalId ? r.parentExternalId : null;
    // O è figlio di un gruppo, o È la riga padre di un gruppo che esiste.
    const chiave = figlioDi ?? (chiaviPadre.has(r.externalId) ? r.externalId : null);
    if (!chiave) {
      ordine.push({ tipo: 'singola', riga: r });
      continue;
    }
    if (!perPadre.has(chiave)) {
      perPadre.set(chiave, []);
      ordine.push({ tipo: 'padre', chiave });
    }
    perPadre.get(chiave)!.push(r);
  }

  // Una riga che dichiara un padre condiviso con nessun altro non è una
  // variante: è un prodotto, e il codice padre resta solo come informazione.
  for (const [chiave, gruppo] of perPadre) {
    if (gruppo.length === 1) {
      const i = ordine.findIndex((o) => o.tipo === 'padre' && o.chiave === chiave);
      if (i >= 0) ordine[i] = { tipo: 'singola', riga: gruppo[0]! };
      perPadre.delete(chiave);
    }
  }

  const risultato: ProdottoUnito[] = [];
  for (const voce of ordine) {
    if (voce.tipo === 'singola') {
      risultato.push(prodottoDaRigaSingola(voce.riga));
      continue;
    }
    const gruppo = perPadre.get(voce.chiave)!;

    // Una riga il cui SKU È il codice padre è il prodotto dichiarato: i suoi
    // dati vincono, perché li ha scritti il cliente.
    const rigaPadre = gruppo.find((r) => r.externalId === voce.chiave) ?? null;
    const varianti = gruppo.filter((r) => r !== rigaPadre);
    // Se il padre era dichiarato ma non ha figli oltre a sé, è un prodotto.
    if (varianti.length === 0) {
      risultato.push(prodottoDaRigaSingola(gruppo[0]!));
      continue;
    }

    // I fatti comuni: una chiave finisce sul prodotto solo se TUTTE le varianti
    // la portano con lo stesso identico valore. Dove differiscono, o dove manca
    // a qualcuna, è un fatto della variante — è la definizione di variante.
    const chiavi = new Set<string>();
    for (const r of varianti) for (const k of Object.keys(r.canonicalAttributes)) chiavi.add(k);

    const comuni: Record<string, string> = {};
    const distintive = new Set<string>();
    for (const k of chiavi) {
      if (CHIAVI_NON_CONFRONTABILI.has(k)) continue;
      const valori = varianti.map((r) => r.canonicalAttributes[k]);
      const primo = valori[0];
      if (primo !== undefined && valori.every((v) => v === primo)) comuni[k] = primo;
      else distintive.add(k);
    }

    const nomiVarianti = varianti.map((r) => r.name);
    let name = rigaPadre?.name ?? '';
    let nomeDerivato = false;
    if (!name) {
      const comune = prefissoComune(nomiVarianti);
      if (comune) {
        name = comune;
        nomeDerivato = true;
      } else {
        name = nomiVarianti[0] ?? voce.chiave;
      }
    }

    risultato.push({
      externalId: voce.chiave,
      sku: rigaPadre?.sku ?? voce.chiave,
      name,
      category: rigaPadre?.category ?? piuFrequente(varianti.map((r) => r.category)),
      // I fatti della riga padre sono fatti del PRODOTTO per dichiarazione del
      // cliente: vanno tenuti anche se le varianti non li ripetono. Prima si
      // partiva dai soli fatti comuni alle varianti, e «materiale: cotone»
      // scritto una volta sulla riga del modello spariva.
      canonicalAttributes: {
        ...comuni,
        ...(rigaPadre ? rigaPadre.canonicalAttributes : {}),
        sku: rigaPadre?.sku ?? voce.chiave,
      },
      varianti: varianti.map((r) => {
        const attributiVariante: Record<string, string> = {};
        for (const k of distintive) {
          const v = r.canonicalAttributes[k];
          if (v !== undefined && v !== '') attributiVariante[k] = v;
        }
        return { sku: r.sku, externalId: r.externalId, attributiVariante };
      }),
      skuOriginali: gruppo.map((r) => r.sku),
      nomeDerivato,
    });
  }

  return risultato;
}

/** Quanto costa questo import, ora che le varianti non sono prodotti. */
export function contaProdottiEVarianti(prodotti: ProdottoUnito[]): {
  prodotti: number;
  varianti: number;
  righe: number;
} {
  return {
    prodotti: prodotti.length,
    varianti: prodotti.reduce((n, p) => n + p.varianti.length, 0),
    righe: prodotti.reduce((n, p) => n + p.skuOriginali.length, 0),
  };
}
