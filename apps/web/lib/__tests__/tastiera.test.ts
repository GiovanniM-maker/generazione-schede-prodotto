import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Dove si scrive, Invio invia.
//
// L'ha notato il proprietario del prodotto usandolo dal telefono: «se scrivo
// una roba devo per forza cliccare il pulsante invece di fare invio con la
// tastiera». Andando a contare non era un caso isolato — era ovunque: in tutta
// l'applicazione c'erano **due** `<form>`, la pagina di accesso e la barra in
// alto. Cinquantotto campi di testo, in quattordici file, stavano fuori da un
// modulo.
//
// Non è una comodità per chi ha fretta. Un `<form>` porta tre cose che a mano
// non si rifanno:
//
//   · Invio invia, senza scriverlo;
//   · su telefono il tasto della tastiera smette di dire «a capo» e dice
//     «vai» — cioè il sistema operativo capisce che quello è un modulo;
//   · il gestore di password e il completamento automatico riconoscono i campi.
//
// Il pulsante non deve stare per forza dentro: quando vive in una barra in
// fondo (l'onboarding, il wizard) lo si collega con `form="id-del-modulo"`,
// che è esattamente il motivo per cui quell'attributo esiste.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');

function tsx(dir: string): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  for (const e of readdirSync(join(RADICE, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsx(rel));
    else if (e.name.endsWith('.tsx')) out.push({ path: rel, src: readFileSync(join(RADICE, rel), 'utf8') });
  }
  return out;
}

const sorgenti = [...tsx('components'), ...tsx('app')];

/**
 * File che hanno campi di testo e nessun modo di inviare da tastiera.
 *
 * Un modo vale l'altro: un `<form>`, oppure un gestore esplicito su Invio —
 * che è la scelta giusta per le chat, dove il modulo non c'è ma Invio manda.
 */
/** I tipi di `<input>` in cui si scrive qualcosa. */
const TESTUALI = /type="(text|email|search|url|tel|password|number)"/;

/**
 * True se il file ha un campo a una riga in cui si digita.
 *
 * Due esclusioni, imparate sbagliando:
 *
 *   · i `<textarea>`, dove Invio va a capo ed è giusto così;
 *   · le caselle di spunta, i pulsanti radio e i selettori di file, che sono
 *     `<input>` ma non si scrivono. La prima versione della regola li contava
 *     e accusava due pagine che non hanno un solo campo di testo.
 */
function haCampoDiTesto(src: string): boolean {
  if (/<Input[\s/]/.test(src)) return true;
  for (const m of src.matchAll(/<input\b[^>]*>/gs)) {
    if (TESTUALI.test(m[0]) || !/type=/.test(m[0])) return true;
  }
  return false;
}

function senzaInvio(f: { path: string; src: string }): boolean {
  // I mattoni dell'interfaccia definiscono il campo, non lo usano: chiedere
  // loro un modulo attorno non vuol dire niente.
  if (f.path.startsWith(join('components', 'ui'))) return false;
  if (!haCampoDiTesto(f.src)) return false;
  const haForm = /<form[\s>]/.test(f.src);
  const haInvio = /key === 'Enter'|key==='Enter'|onKeyDown|onKeyPress/.test(f.src);
  return !haForm && !haInvio;
}

/**
 * I campi dove Invio non deve fare niente, e il perché.
 *
 * Sono quelli che filtrano mentre si scrive: il risultato è già a schermo, e
 * un modulo attorno vorrebbe dire ricaricare la pagina premendo Invio — cioè
 * peggio di niente. Ogni voce ha la sua ragione scritta: un elenco lungo
 * sarebbe il difetto che torna dalla porta di servizio.
 */
const NON_SI_INVIA: Record<string, string> = {
  'results-table.tsx': 'la ricerca filtra mentre si scrive: il risultato è già a schermo',
  'batch/image-qc-panel.tsx': 'pannello di sola lettura con una casella di filtro',
  'settings/attribute-detail-client.tsx': 'un elenco di valori che si aggiungono uno alla volta, ognuno col suo comando',
  'settings/preset-detail-client.tsx':
    'una casella che filtra le categorie mentre si scrive: il risultato è già a schermo',
  'settings/account-client.tsx':
    'ci si scrive ELIMINA per cancellare l’account: è l’unico campo dove Invio a caso deve NON fare niente',
  // Arrivata spezzando il wizard: la colonna si rinomina mentre si scrive, e
  // il valore è già applicato. Non c'è niente da inviare.
  //
  // L'altro campo che il taglio ha scoperto — i domini di ricerca nel passo
  // delle fonti — NON è finito qui: lì Invio ha qualcosa da fare (rigenera
  // l'anteprima) e adesso lo fa.
  'batch/passi/mappa.tsx':
    'si rinomina una colonna mentre si scrive: il nuovo nome è già applicato, non c’è niente da inviare',
};

describe('dove si scrive, Invio invia', () => {
  it('nessun modulo lascia la tastiera senza risposta', () => {
    const colpevoli = sorgenti
      .filter(senzaInvio)
      .filter((f) => !Object.keys(NON_SI_INVIA).some((k) => f.path.endsWith(k)))
      .map((f) => f.path);
    expect(
      colpevoli,
      'campi di testo senza <form> né gestione di Invio: si scrive e si è costretti a cliccare',
    ).toEqual([]);
  });

  it('le eccezioni sono poche e ognuna ha il suo perché', () => {
    expect(Object.keys(NON_SI_INVIA).length).toBeLessThanOrEqual(6);
    for (const [file, perche] of Object.entries(NON_SI_INVIA)) {
      expect(perche.length, `«${file}» senza motivo scritto`).toBeGreaterThan(25);
    }
  });

  it('un pulsante non invia per sbaglio solo perché sta dentro un modulo', () => {
    // In HTML un `<button>` dentro un `<form>` senza `type` vale `submit`.
    // Finché i moduli non esistevano non si notava; adesso «Annulla» accanto a
    // «Salva» invierebbe invece di chiudere, e in silenzio, perché a schermo i
    // due pulsanti sono identici.
    const bottone = readFileSync(join(RADICE, 'components/ui/button.tsx'), 'utf8');
    expect(bottone).toMatch(/type = 'button'/);
    expect(bottone).toMatch(/type=\{type\}/);
  });

  it('i moduli il cui comando sta in una barra in fondo lo collegano davvero', () => {
    // `form="…"` senza un `<form id="…">` corrispondente è un pulsante che non
    // fa niente: si spegne in silenzio, come tutto quello che riguarda i moduli.
    const idDichiarati = new Set<string>();
    const idUsati: { id: string; file: string }[] = [];
    for (const f of sorgenti) {
      for (const m of f.src.matchAll(/<form\s[^>]*id="([^"]+)"/g)) idDichiarati.add(m[1]!);
      for (const m of f.src.matchAll(/\bform="([^"]+)"/g)) idUsati.push({ id: m[1]!, file: f.path });
    }
    const orfani = idUsati.filter((u) => !idDichiarati.has(u.id));
    expect(orfani, 'pulsanti collegati a un modulo che non esiste').toEqual([]);
  });
});
