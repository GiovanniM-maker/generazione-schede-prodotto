// La conferma dell'identità, fatta da una persona.
//
// Quando i segnali non bastano — lo stesso codice presso due produttori, due
// candidati che si equivalgono, corrispondenze troppo deboli — il sistema non
// decide e mette il prodotto in coda. Qui ci sono le regole di cosa succede
// quando quella coda viene lavorata.
//
// Funzioni PURE.

export interface CandidatoSalvato {
  url: string;
  titolo: string | null;
  marca: string | null;
  dominio: string;
  livello: string;
  prezzo: string | null;
  immagine: string | null;
  punteggio: number;
}

/**
 * L'URL confermato deve essere uno di quelli che erano stati mostrati.
 *
 * Non è pignoleria: la conferma arriva dal browser, e senza questo controllo
 * l'indirizzo da scaricare lo sceglierebbe chi manda la richiesta. Diventerebbe
 * un modo per far scaricare al nostro server una pagina qualsiasi — un
 * indirizzo interno, un file enorme — con le nostre credenziali di rete e a
 * spese nostre. Il confronto è sull'insieme che il sistema stesso ha proposto,
 * che è l'unico elenco di cui rispondiamo noi.
 *
 * Il confronto ignora le differenze che non cambiano la pagina (schema, `www.`,
 * barra finale, maiuscole nel dominio) perché il browser normalizza gli
 * indirizzi e una conferma legittima non deve fallire per una barra.
 */
export function urlAmmesso(candidati: CandidatoSalvato[], url: string): boolean {
  const chiave = chiaveUrl(url);
  if (!chiave) return false;
  return candidati.some((c) => chiaveUrl(c.url) === chiave);
}

function chiaveUrl(url: string): string | null {
  try {
    const u = new URL((url ?? '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const percorso = u.pathname.replace(/\/+$/, '');
    // La query resta: `?id=12` e `?id=13` sono due prodotti diversi.
    return `${host}${percorso}${u.search}`;
  } catch {
    return null;
  }
}

export type EsitoConferma =
  /** L'utente ha scelto una pagina: da qui in poi l'identità è certa. */
  | { azione: 'accetta'; url: string; punteggioIdentita: number }
  /** L'utente ha scartato tutto: il codice resta senza prodotto. */
  | { azione: 'scarta' }
  /** La richiesta non è valida e non va eseguita. */
  | { azione: 'rifiuta'; motivo: string };

/**
 * Cosa fare di una conferma che arriva dall'interfaccia.
 *
 * Quando una persona sceglie, il punteggio di identità diventa 1 — e non è una
 * scorciatoia: il punteggio misura quanto siamo sicuri che sia la pagina
 * giusta, e una persona che ha guardato i candidati affiancati e ne ha indicato
 * uno è la prova migliore che possiamo avere. Lasciarlo basso vorrebbe dire
 * mandare fra i dubbi campi che qualcuno ha appena verificato, cioè chiedere
 * due volte la stessa cosa.
 */
export function valutaConferma(
  candidati: CandidatoSalvato[],
  scelta: { url?: string | null; scarta?: boolean },
): EsitoConferma {
  if (scelta.scarta) return { azione: 'scarta' };

  const url = (scelta.url ?? '').trim();
  if (!url) return { azione: 'rifiuta', motivo: 'Nessuna pagina scelta.' };
  if (candidati.length === 0) {
    return { azione: 'rifiuta', motivo: 'Questa riga non ha candidati da confermare.' };
  }
  if (!urlAmmesso(candidati, url)) {
    return {
      azione: 'rifiuta',
      motivo: 'La pagina scelta non è fra quelle proposte per questo codice.',
    };
  }
  return { azione: 'accetta', url, punteggioIdentita: 1 };
}

/**
 * I candidati nell'ordine in cui vanno mostrati.
 *
 * Prima i più forti, e a parità prima le fonti ufficiali: la schermata è
 * pensata per essere scorsa in fretta su molti prodotti in fila, e chi scorre
 * in fretta guarda le prime due. Metterci davanti un marketplace quando c'è il
 * sito del produttore vuol dire far scegliere la fonte peggiore per stanchezza.
 */
export function ordinaPerLaScelta(candidati: CandidatoSalvato[]): CandidatoSalvato[] {
  const peso: Record<string, number> = { produttore: 0, fornitore: 1, 'terza-parte': 2, sconosciuto: 3 };
  return [...candidati].sort(
    (a, b) =>
      b.punteggio - a.punteggio ||
      (peso[a.livello] ?? 9) - (peso[b.livello] ?? 9) ||
      a.url.localeCompare(b.url),
  );
}
