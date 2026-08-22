import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Niente `title` del browser su una cosa che si preme.
//
// IL NUMERO DI PARTENZA: ventisei `title` nativi, venti dei quali su comandi
// fatti di sola icona. Su un dito il `title` NON COMPARE MAI — non esiste il
// passaggio del puntatore — quindi «Rinomina», «Duplica», «Archivia», «Sposta
// su», «Elimina batch» erano icone senza nome su metà delle tabelle del
// prodotto. E diversi lettori di schermo il `title` non lo annunciano affatto,
// quindi non erano nomi nemmeno lì.
//
// COSA RESTA AMMESSO. Il `title` su una cella TRONCATA. Lì il testo è già a
// schermo, solo tagliato, e il `title` è il modo del browser di darne il
// seguito — non porta informazione che non ci sia. Montarci sopra un componente
// vorrebbe dire un ascoltatore per ogni cella di ogni riga.
//
// COSA PROTEGGE QUESTA PROVA. Che il ventisettesimo non venga scritto. Scrivere
// `title="Rinomina"` è più veloce che cercare `<Suggerimento>`, e la regressione
// non si vede: col mouse funziona benissimo.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');

function tsx(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) tsx(p, acc);
    else if (nome.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

/**
 * Gli attributi di un tag, dal nome al `>` che lo chiude davvero.
 *
 * Conta le graffe e sta attenta alle virgolette. Senza, `onChange={(e) => …}`
 * fa finire la lettura in anticipo — è l'errore che nella prova sui nomi dei
 * campi è costato dodici correzioni sbagliate.
 */
function attributi(s: string, da: number): string {
  let d = 0;
  let q: string | null = null;
  for (let j = da; j < s.length; j++) {
    const c = s[j]!;
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '{') d++;
    else if (c === '}') d--;
    else if (c === '>' && d === 0) return s.slice(da, j);
  }
  return s.slice(da, da + 600);
}

/** I componenti che passano `title` a un elemento del DOM invece di disegnarlo. */
const PASSANTI = new Set(['Button', 'IconButton', 'TD', 'TH', 'Link']);

interface Nativo {
  file: string;
  riga: number;
  tag: string;
  premibile: boolean;
  troncato: boolean;
}

function nativi(file: string[]): Nativo[] {
  const fuori: Nativo[] = [];
  for (const p of file) {
    // Il componente del suggerimento parla di `title` per spiegare perché non
    // si usa: nominarlo non è usarlo.
    if (p.endsWith(join('ui', 'suggerimento.tsx'))) continue;
    const s = readFileSync(p, 'utf8');
    for (const m of s.matchAll(/<([A-Za-z][A-Za-z0-9.]*)\b/g)) {
      const tag = m[1]!;
      const minuscolo = /^[a-z]/.test(tag);
      if (!minuscolo && !PASSANTI.has(tag)) continue;
      const attr = attributi(s, m.index! + m[0].length);
      if (!/(^|\s)title=/.test(attr)) continue;
      fuori.push({
        file: p.slice(RADICE.length + 1),
        riga: s.slice(0, m.index!).split('\n').length,
        tag,
        premibile: ['button', 'a', 'label', 'summary', 'Button', 'IconButton', 'Link'].includes(tag),
        // Il troncamento può stare sull'elemento stesso o sul figlio che porta
        // il testo: `<th title={h}><span className="truncate">`.
        troncato: /truncate/.test(attr) || /truncate/.test(s.slice(m.index!, m.index! + 400)),
      });
    }
  }
  return fuori;
}

const FILE = [...tsx(join(RADICE, 'components')), ...tsx(join(RADICE, 'app'))];
const NATIVI = nativi(FILE);

describe('il `title` del browser', () => {
  it('non sta su niente che si prema', () => {
    const colpevoli = NATIVI.filter((n) => n.premibile).map((n) => `${n.file}:${n.riga} <${n.tag}>`);
    expect(
      colpevoli,
      'su un dito il `title` non compare mai: usa <Suggerimento> da ' +
        `@/components/ui/suggerimento.\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  it('dove resta, resta solo a completare un testo troncato', () => {
    // Il criterio è questo e non «è un div»: se il testo NON è già a schermo, il
    // `title` è l'unico posto in cui sta, e su un dito quel posto non si apre.
    const colpevoli = NATIVI.filter((n) => !n.troncato).map(
      (n) => `${n.file}:${n.riga} <${n.tag}>`,
    );
    expect(
      colpevoli,
      `un \`title\` che non completa un testo troncato porta informazione che sul telefono non arriva:\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  it('ne restano pochi, e la prova li sta contando', () => {
    // Una guardia che non trova niente da guardare è verde per assenza di
    // bersaglio. Se un giorno lo scanner smette di vedere i `title`, questo
    // numero va a zero e la prova lo dice.
    expect(NATIVI.length).toBeGreaterThan(0);
    expect(NATIVI.length).toBeLessThan(10);
  });
});

describe('il componente del suggerimento', () => {
  const sorgente = readFileSync(join(RADICE, 'components/ui/suggerimento.tsx'), 'utf8');

  it('non decide da sé dove mettersi né come chiamarsi', () => {
    // Le due decisioni stanno in `@app/core/suggerimento`, dove si provano
    // esaustivamente senza montare un browser: il ribaltamento contro i bordi e
    // la differenza fra dare il nome e dare la descrizione.
    expect(sorgente).toContain('collocaSuggerimento');
    expect(sorgente).toContain('legaSuggerimento');
    const core = readFileSync(join(process.cwd(), 'packages/core/src/suggerimento.ts'), 'utf8');
    expect(core).toContain('export function collocaSuggerimento');
    expect(core).toContain('export function legaSuggerimento');
    expect(core).toContain('export function nomeAmmesso');
  });

  it('il riquadro che si vede non viene letto una seconda volta', () => {
    // Il testo è già nel nome o nella descrizione dell'ancora. Un `role="tooltip"`
    // qui lo farebbe sentire due volte di fila.
    expect(sorgente).toMatch(/aria-hidden="true"/);
    expect(sorgente, 'il riquadro non deve annunciarsi da solo').not.toContain('role="tooltip"');
  });

  it('la descrizione ha una copia sempre presente nel documento', () => {
    // `aria-describedby` che punta a un elemento montato solo mentre il riquadro
    // è aperto punta al nulla per quasi tutto il tempo.
    expect(sorgente).toContain('copiaPerLettori');
    expect(sorgente).toMatch(/className="sr-only"/);
  });

  it('non lascia il puntatore a intercettare i clic', () => {
    // Il riquadro sta sopra la pagina in posizione fissa: senza
    // `pointer-events-none` coprirebbe quello che sta spiegando.
    expect(sorgente).toContain('pointer-events-none');
  });

  it('non si trascina dietro un riquadro staccato dall’ancora', () => {
    // Le misure sono relative alla vista: scorrendo, un riquadro rimasto aperto
    // finirebbe a indicare un pezzo di pagina diverso.
    expect(sorgente).toMatch(/addEventListener\('scroll'/);
  });
});

describe('quanti suggerimenti veri ci sono', () => {
  it('la sostituzione è stata fatta davvero', () => {
    // Ventisei `title` nativi di partenza, ventidue dei quali sostituiti. Se
    // questo numero crolla, qualcuno li ha tolti invece di convertirli.
    const usi = FILE.reduce((n, p) => {
      if (p.endsWith(join('ui', 'suggerimento.tsx'))) return n;
      return n + (readFileSync(p, 'utf8').match(/<(Suggerimento|Aiuto)\b/g) ?? []).length;
    }, 0);
    expect(usi).toBeGreaterThan(12);
  });
});
