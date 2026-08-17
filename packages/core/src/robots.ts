// robots.txt: cosa un sito ci dice di non guardare.
//
// La ricerca per SKU va a leggere pagine di siti che non sono nostri. Il
// protocollo di esclusione è il modo in cui quei siti dichiarano cosa non
// vogliono che venga letto da un programma, e ignorarlo non è una scorciatoia
// tecnica: è passare sopra a una richiesta esplicita del proprietario. Il
// prodotto che vende «i dati posseggono i fatti» non può procurarsi i fatti
// così.
//
// Funzione PURA: riceve il testo di robots.txt già scaricato. Chi lo scarica —
// e chi decide cosa fare se non risponde — sta fuori.
//
// Le regole seguite sono quelle di RFC 9309: gruppi per user-agent, vince la
// regola col percorso più lungo, e a parità vince Allow.

export interface RegolaRobots {
  tipo: 'allow' | 'disallow';
  /** Il percorso come scritto, con `*` e `$` se ci sono. */
  percorso: string;
}

export interface GruppoRobots {
  /** Gli user-agent a cui il gruppo si rivolge, minuscoli. */
  agenti: string[];
  regole: RegolaRobots[];
  /** Secondi di attesa richiesti fra due richieste, se dichiarati. */
  attesa: number | null;
}

export interface RegoleRobots {
  gruppi: GruppoRobots[];
  /** `true` quando il file non conteneva nessun gruppo utilizzabile. */
  vuoto: boolean;
}

/** Legge un robots.txt. Su un file malformato non lancia: ritorna ciò che ha capito. */
export function analizzaRobots(testo: string): RegoleRobots {
  const gruppi: GruppoRobots[] = [];
  let corrente: GruppoRobots | null = null;
  // Più righe `user-agent` di fila valgono per lo STESSO gruppo di regole: si
  // accumulano finché non arriva una direttiva vera.
  let stavoLeggendoAgenti = false;

  for (const rigaGrezza of (testo ?? '').split(/\r\n?|\n/)) {
    const riga = rigaGrezza.split('#')[0]!.trim();
    if (!riga) continue;
    const sep = riga.indexOf(':');
    if (sep < 0) continue;
    const campo = riga.slice(0, sep).trim().toLowerCase();
    const valore = riga.slice(sep + 1).trim();

    if (campo === 'user-agent') {
      if (!corrente || !stavoLeggendoAgenti) {
        corrente = { agenti: [], regole: [], attesa: null };
        gruppi.push(corrente);
        stavoLeggendoAgenti = true;
      }
      if (valore) corrente.agenti.push(valore.toLowerCase());
      continue;
    }

    if (!corrente) continue;
    stavoLeggendoAgenti = false;

    if (campo === 'disallow' || campo === 'allow') {
      // `Disallow:` vuoto vuol dire «niente di vietato»: è una riga con un
      // significato, non una riga da saltare, ma come regola non seleziona
      // nessun percorso e va ignorata nel confronto.
      if (valore) corrente.regole.push({ tipo: campo, percorso: valore });
      continue;
    }
    if (campo === 'crawl-delay') {
      const n = Number(valore.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0) corrente.attesa = n;
    }
  }

  return { gruppi: gruppi.filter((g) => g.agenti.length > 0), vuoto: gruppi.length === 0 };
}

/**
 * Il gruppo che si applica a questo user-agent.
 *
 * Vince il nome più specifico che compare nel nostro: se il file parla sia a
 * `*` sia a `verificatobot`, e noi siamo `VerificatoBot/1.0`, valgono le regole
 * scritte per noi. È il contrario di quello che verrebbe comodo.
 */
export function gruppoPerAgente(regole: RegoleRobots, userAgent: string): GruppoRobots | null {
  const ua = (userAgent ?? '').toLowerCase();
  let migliore: GruppoRobots | null = null;
  let lunghezzaMigliore = -1;
  let generico: GruppoRobots | null = null;

  for (const g of regole.gruppi) {
    for (const a of g.agenti) {
      if (a === '*') {
        if (!generico) generico = g;
        continue;
      }
      if (ua.includes(a) && a.length > lunghezzaMigliore) {
        migliore = g;
        lunghezzaMigliore = a.length;
      }
    }
  }
  return migliore ?? generico;
}

/** Trasforma un percorso di robots.txt in espressione regolare. */
function aRegex(percorso: string): RegExp {
  let corpo = '';
  for (const c of percorso) {
    if (c === '*') corpo += '.*';
    else if (c === '$') corpo += '$';
    else corpo += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${corpo}`);
}

/** Quanto è specifica una regola: conta la lunghezza del percorso dichiarato. */
function specificita(percorso: string): number {
  return percorso.replace(/\$$/, '').length;
}

/**
 * Questo percorso si può leggere?
 *
 * In assenza di regole la risposta è sì: un sito che non dice niente non ha
 * vietato niente. Ma `robots.txt` irraggiungibile è un caso diverso — lì la
 * risposta la deve dare chi ha provato a scaricarlo, non questa funzione, che
 * di un file mancante non sa niente.
 */
export function consentito(regole: RegoleRobots, percorso: string, userAgent: string): boolean {
  const gruppo = gruppoPerAgente(regole, userAgent);
  if (!gruppo || gruppo.regole.length === 0) return true;

  const path = percorso.startsWith('/') ? percorso : `/${percorso}`;
  let scelta: RegolaRobots | null = null;
  let lunghezza = -1;

  for (const r of gruppo.regole) {
    if (!aRegex(r.percorso).test(path)) continue;
    const s = specificita(r.percorso);
    // A parità di lunghezza vince Allow: è la regola di RFC 9309, e in caso di
    // pareggio è anche quella che sbaglia dalla parte meno grave — si legge una
    // pagina in più, non se ne salta una permessa.
    if (s > lunghezza || (s === lunghezza && r.tipo === 'allow')) {
      scelta = r;
      lunghezza = s;
    }
  }

  return scelta ? scelta.tipo === 'allow' : true;
}

/** L'attesa richiesta fra due richieste a questo sito, in secondi. */
export function attesaRichiesta(regole: RegoleRobots, userAgent: string): number | null {
  return gruppoPerAgente(regole, userAgent)?.attesa ?? null;
}
