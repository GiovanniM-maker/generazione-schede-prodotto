import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Guardia sugli endpoint.
//
// In Next OGNI funzione esportata da un file "use server" e' un endpoint
// raggiungibile dalla rete. Non e' evidente leggendo il codice: una funzione
// interna messa li' per comodita' diventa un ingresso pubblico.
//
// E' successo davvero: `runVisualExtractionCore(orgId, input)` era esportata da
// un file "use server", prendeva l'organizzazione come PARAMETRO e usava il
// client di servizio, che scavalca le regole di accesso al database. Nessun
// controllo di sessione. Chi fosse riuscito a invocarla avrebbe potuto lavorare
// sui batch di un'altra organizzazione e consumarne i crediti.
//
// Due regole, verificate su tutti i file:
//   A. ogni azione fa un controllo di identita'/proprieta';
//   B. nessuna azione ha la firma di un helper interno (client come parametro,
//      oppure l'organizzazione passata da fuori).
// ---------------------------------------------------------------------------

const ACTIONS_DIR = join(import.meta.dirname, '..', 'actions');

/** Le uniche azioni legittimamente pubbliche: sono il login. */
const PUBBLICHE = new Set(['signInWithEmail', 'verifyOtpCode', 'signOut']);

const GUARDIANI =
  /\b(requireOrg|requireMember|getSessionUser|getUserOrg|assertBatchAccess|assertPresetAccess|assertProductAccess|assertPavAccess|requireAuth)\b/;

// --- lettura del sorgente ---------------------------------------------------

/** Toglie commenti e stringhe: gli apostrofi italiani ("l'utente") altrimenti
 *  vengono scambiati per inizio di stringa e mandano fuori strada l'analisi. */
function pulisci(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += ' ';
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Indice del delimitatore che chiude quello aperto in `start`. */
function chiudi(src: string, start: number, apre: string, chiude: string): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === apre) depth++;
    else if (src[i] === chiude) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface Funzione {
  file: string;
  nome: string;
  esportata: boolean;
  parametri: string;
  corpo: string;
}

function funzioniDi(file: string, srcPulito: string): Funzione[] {
  const out: Funzione[] = [];
  const re = /(export\s+)?async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(srcPulito))) {
    const apertaParam = srcPulito.indexOf('(', m.index + m[0].length - 1);
    const chiusaParam = chiudi(srcPulito, apertaParam, '(', ')');
    if (chiusaParam < 0) continue;
    // Il corpo comincia alla prima graffa fuori dai generici del tipo di
    // ritorno: `Promise<ActionResult<{...}>>` ne contiene di sue.
    let j = chiusaParam + 1;
    let angolo = 0;
    while (j < srcPulito.length) {
      const c = srcPulito[j];
      if (c === '<') angolo++;
      else if (c === '>') angolo = Math.max(0, angolo - 1);
      else if (c === '{' && angolo === 0) break;
      j++;
    }
    const fineCorpo = chiudi(srcPulito, j, '{', '}');
    out.push({
      file,
      nome: m[2]!,
      esportata: Boolean(m[1]),
      parametri: srcPulito.slice(apertaParam + 1, chiusaParam),
      corpo: fineCorpo > 0 ? srcPulito.slice(j, fineCorpo + 1) : '',
    });
  }
  return out;
}

const fileAzioni = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ nome: f, src: readFileSync(join(ACTIONS_DIR, f), 'utf8') }))
  .filter((f) => f.src.trimStart().startsWith("'use server'"));

const tutte = fileAzioni.flatMap((f) => funzioniDi(f.nome, pulisci(f.src)));
const azioni = tutte.filter((f) => f.esportata);

/** Il controllo vale anche se sta in un helper locale chiamato dall'azione. */
function haGuardiano(f: Funzione): boolean {
  if (GUARDIANI.test(f.corpo)) return true;
  const localiDelFile = tutte.filter((x) => x.file === f.file && !x.esportata);
  return localiDelFile.some(
    (h) => new RegExp(`\\b${h.nome}\\s*\\(`).test(f.corpo) && GUARDIANI.test(h.corpo),
  );
}

describe('guardia sugli endpoint delle server action', () => {
  it('trova le azioni da controllare (se questo numero crolla, l’analisi è rotta)', () => {
    expect(fileAzioni.length).toBeGreaterThanOrEqual(15);
    expect(azioni.length).toBeGreaterThanOrEqual(90);
  });

  it('ogni azione ha un corpo leggibile: nessuna sfugge all’analisi', () => {
    const vuote = azioni.filter((f) => f.corpo.trim().length < 10);
    expect(vuote.map((f) => `${f.file}::${f.nome}`)).toEqual([]);
  });

  it('A. ogni azione verifica identità o proprietà', () => {
    const scoperte = azioni
      .filter((f) => !PUBBLICHE.has(f.nome))
      .filter((f) => !haGuardiano(f))
      .map((f) => `${f.file}::${f.nome}`);
    expect(scoperte).toEqual([]);
  });

  it('B. nessuna azione riceve il client del database da fuori', () => {
    const colpevoli = azioni
      .filter((f) => /(^|,)\s*(service|client|db|supabase)\s*:/.test(f.parametri))
      .map((f) => `${f.file}::${f.nome}`);
    expect(colpevoli).toEqual([]);
  });

  it('B. nessuna azione riceve l’organizzazione come parametro posizionale', () => {
    // `input: { organizationId }` va bene: e' dentro l'oggetto e viene comunque
    // validato. Quello che non va e' `(orgId: string, ...)`: significa che il
    // chiamante sceglie su quale organizzazione lavorare.
    const colpevoli = azioni
      .filter((f) => /^\s*(orgId|organizationId)\s*:/.test(f.parametri))
      .map((f) => `${f.file}::${f.nome}`);
    expect(colpevoli).toEqual([]);
  });

  it('le azioni pubbliche sono solo quelle del login, e sono in auth.ts', () => {
    for (const nome of PUBBLICHE) {
      const f = azioni.find((x) => x.nome === nome);
      expect(f, `azione pubblica mancante: ${nome}`).toBeDefined();
      expect(f?.file).toBe('auth.ts');
    }
  });

  it('i moduli che usano il client di servizio senza sessione NON sono "use server"', () => {
    // Sono i nuclei chiamati dal cron: devono restare moduli normali.
    for (const modulo of ['visual-core.ts', 'doubts-core.ts', 'visual-analysis-resume.ts']) {
      const src = readFileSync(join(import.meta.dirname, '..', modulo), 'utf8');
      expect(src.trimStart().startsWith("'use server'"), `${modulo} è diventato un endpoint`).toBe(
        false,
      );
    }
  });
});
