// La ricerca web, vista dal prodotto.
//
// Qui non si va in rete: ci sono il contratto che un fornitore di ricerca deve
// rispettare, la costruzione della query e la lettura della risposta. Sono le
// due parti che sbagliano davvero — una query mal costruita non trova il
// prodotto e lo dichiara inesistente; una risposta letta male costruisce
// candidati con campi vuoti che poi il punteggio interpreta come segnali
// assenti — e sono anche le due che si possono provare senza pagare una
// chiamata.
//
// L'adattatore che parla con Brave sta in apps/web/lib/ricerca-brave.ts.

export interface RisultatoRicerca {
  url: string;
  titolo: string;
  /** L'estratto mostrato dal motore. Non è la pagina: è un indizio. */
  descrizione: string;
  dominio: string;
}

export interface RichiestaRicerca {
  /** Lo SKU o il codice modello. È la chiave, non una descrizione. */
  codice: string;
  marca: string | null;
  /** Se valorizzato, la ricerca è limitata a questi domini. */
  domini: string[];
  /** Quanti risultati chiedere. */
  limite: number;
}

/** Un fornitore di ricerca. L'implementazione vera fa rete, quella finta no. */
export interface FornitoreRicerca {
  readonly nome: string;
  cerca(richiesta: RichiestaRicerca): Promise<RisultatoRicerca[]>;
}

export const LIMITE_RISULTATI_PREDEFINITO = 10;
/** Oltre questo, i risultati sono rumore e ogni chiamata costa. */
export const LIMITE_RISULTATI_MASSIMO = 20;
/** Più domini di così non ci stanno in una query utile. */
export const MAX_DOMINI_PER_QUERY = 5;

function dominioPulito(d: string): string {
  return (d ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.-]/g, '');
}

/**
 * La query da mandare al motore.
 *
 * Il codice va fra virgolette: senza, i motori lo spezzano sui trattini e
 * restituiscono qualunque pagina contenga una delle parti — che per un codice
 * come «SED-AUR-01» vuol dire mezzo catalogo. È la differenza fra cercare un
 * prodotto e cercare parole.
 *
 * La marca NON va fra virgolette: è un nome commerciale, scritto in dieci modi
 * diversi, e vincolarlo alla lettera fa perdere pagine buone.
 */
export function costruisciQuery(richiesta: RichiestaRicerca): string {
  const codice = (richiesta.codice ?? '').trim();
  if (!codice) return '';

  const pezzi: string[] = [`"${codice.replace(/"/g, '')}"`];
  const marca = (richiesta.marca ?? '').trim();
  if (marca) pezzi.push(marca.replace(/"/g, ''));

  const domini = [...new Set((richiesta.domini ?? []).map(dominioPulito).filter(Boolean))].slice(
    0,
    MAX_DOMINI_PER_QUERY,
  );
  if (domini.length === 1) pezzi.push(`site:${domini[0]}`);
  else if (domini.length > 1) pezzi.push(`(${domini.map((d) => `site:${d}`).join(' OR ')})`);

  return pezzi.join(' ');
}

/** Il dominio di un URL, senza `www.`. Stringa vuota se l'URL non è un URL. */
export function dominioDi(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Da risposta grezza del motore a risultati.
 *
 * Riceve `unknown` apposta: la risposta arriva da un servizio esterno che può
 * cambiare forma senza avvisare, e il modo in cui questo codice se ne accorge
 * NON deve essere un'eccezione durante l'import di un cliente. Quello che non
 * si riconosce viene scartato, e chi chiama vede una lista più corta.
 */
export function leggiRisultatiBrave(risposta: unknown, limite = LIMITE_RISULTATI_PREDEFINITO): RisultatoRicerca[] {
  const radice = risposta as { web?: { results?: unknown } } | null;
  const grezzi = Array.isArray(radice?.web?.results) ? (radice!.web!.results as unknown[]) : [];

  const out: RisultatoRicerca[] = [];
  const visti = new Set<string>();
  for (const r of grezzi) {
    const v = r as { url?: unknown; title?: unknown; description?: unknown };
    if (typeof v?.url !== 'string') continue;
    const dominio = dominioDi(v.url);
    if (!dominio) continue;
    // Lo stesso URL può tornare più volte fra i risultati: contarlo due volte
    // farebbe sembrare due candidati indipendenti quello che è uno solo, e in
    // `decidiIdentita` due candidati che si equivalgono mandano in coda.
    if (visti.has(v.url)) continue;
    visti.add(v.url);
    out.push({
      url: v.url,
      titolo: typeof v.title === 'string' ? spoglia(v.title) : '',
      descrizione: typeof v.description === 'string' ? spoglia(v.description) : '',
      dominio,
    });
    if (out.length >= Math.max(1, Math.min(limite, LIMITE_RISULTATI_MASSIMO))) break;
  }
  return out;
}

/** Brave marca in grassetto i termini trovati: nel testo restano i tag. */
function spoglia(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Un fornitore finto, deterministico.
 *
 * Serve per due cose diverse e tutte e due necessarie: far girare i test senza
 * pagare una chiamata, e far funzionare l'applicazione in sviluppo prima che
 * qualcuno metta la chiave. Restituisce quello che gli si dà — non inventa
 * pagine, perché un finto che inventa risultati fa passare per funzionante un
 * percorso che non lo è.
 */
export class RicercaFinta implements FornitoreRicerca {
  readonly nome = 'finta';
  private readonly perCodice: Map<string, RisultatoRicerca[]>;
  /** Le richieste ricevute, in ordine: servono a provare che sia stata chiamata. */
  readonly chiamate: RichiestaRicerca[] = [];

  constructor(perCodice: Record<string, RisultatoRicerca[]> = {}) {
    this.perCodice = new Map(Object.entries(perCodice));
  }

  cerca(richiesta: RichiestaRicerca): Promise<RisultatoRicerca[]> {
    this.chiamate.push(richiesta);
    return Promise.resolve(this.perCodice.get(richiesta.codice.trim()) ?? []);
  }
}
