import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Ogni campo ha un nome.
//
// IL NUMERO DI PARTENZA: 23 controlli su 108 non avevano alcun nome
// accessibile. Non è solo un problema per chi usa un lettore di schermo — un
// campo senza etichetta non ha nemmeno il bersaglio cliccabile che allarga
// l'area di tocco, e su telefono si sbaglia a centrarlo.
//
// UNA NOTA SU QUESTA PROVA, perché è costata due errori prima di funzionare.
//
// Il primo rilevatore cercava gli attributi con una regex che si fermava al
// primo `>`. Ma `onChange={(e) => ...}` CONTIENE un `>`: la regex tagliava
// l'attributo a metà, non vedeva l'`aria-label` che c'era già, e mi ha fatto
// scrivere dodici doppioni.
//
// Il secondo toglieva i commenti prima di cercare — e così tutti i numeri di
// riga slittavano, quindi le correzioni finivano nel punto sbagliato del file.
//
// Morale: uno strumento di misura sbagliato è peggio di nessuno strumento,
// perché produce lavoro che sembra fatto. Qui gli attributi si leggono
// contando le graffe e le virgolette, e i commenti si SALTANO invece di
// toglierli, così gli scostamenti restano quelli del file vero.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const CONTROLLI = ['Input', 'Select', 'Textarea', 'input', 'select', 'textarea'];

function tsx(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) tsx(p, acc);
    else if (nome.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

/** Gli intervalli occupati dai commenti, sul testo originale. */
function zoneCommento(s: string): Array<[number, number]> {
  const z: Array<[number, number]> = [];
  for (const re of [/\{\/\*[\s\S]*?\*\/\}/g, /\/\*[\s\S]*?\*\//g, /^[ \t]*\/\/.*$/gm]) {
    for (const m of s.matchAll(re)) z.push([m.index!, m.index! + m[0].length]);
  }
  return z;
}

/**
 * Gli attributi di un tag, dal `<` al `>` che lo chiude davvero.
 *
 * Conta le graffe e sta attenta alle virgolette: senza, ogni funzione freccia
 * fa finire la lettura in anticipo.
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
  return s.slice(da, da + 400);
}

export interface Reperto {
  file: string;
  riga: number;
  tag: string;
  doppio: boolean;
  senzaNome: boolean;
}

export function scansiona(file: string[]): { totale: number; reperti: Reperto[] } {
  const reperti: Reperto[] = [];
  let totale = 0;
  const re = new RegExp(`<(${CONTROLLI.join('|')})\\b`, 'g');

  for (const p of file) {
    if (p.includes(`components${'/'}ui${'/'}`)) continue;
    const s = readFileSync(p, 'utf8');
    const zone = zoneCommento(s);
    const fors = new Set([...s.matchAll(/htmlFor=["'{`]?([A-Za-z0-9_-]+)/g)].map((m) => m[1]!));

    for (const m of s.matchAll(re)) {
      const i = m.index!;
      if (zone.some(([a, b]) => i >= a && i < b)) continue;
      const attr = attributi(s, i + m[0].length);
      // Le caselle e i pulsanti travestiti da campo prendono il nome altrove.
      if (/type=["'](hidden|checkbox|radio|submit|button)["']/.test(attr)) continue;
      totale++;

      const id = /\bid=["']([^"']+)["']/.exec(attr)?.[1];
      const prima = s.slice(Math.max(0, i - 700), i);
      const avvolto = prima.includes('<label') && !prima.split('<label').pop()!.includes('</label>');
      const haNome =
        attr.includes('aria-label') || (id !== undefined && fors.has(id)) || avvolto;

      const doppio = (attr.match(/aria-label/g) ?? []).length > 1;
      if (!haNome || doppio) {
        reperti.push({
          file: p.slice(RADICE.length + 1),
          riga: s.slice(0, i).split('\n').length,
          tag: m[1]!,
          doppio,
          senzaNome: !haNome,
        });
      }
    }
  }
  return { totale, reperti };
}

const FILE = [...tsx(join(RADICE, 'components')), ...tsx(join(RADICE, 'app'))];

describe('ogni campo ha un nome', () => {
  const { totale, reperti } = scansiona(FILE);

  it('nessun controllo resta senza etichetta né aria-label', () => {
    const senza = reperti.filter((r) => r.senzaNome).map((r) => `${r.file}:${r.riga} <${r.tag}>`);
    expect(
      senza,
      'un campo senza nome è muto per un lettore di schermo e non ha il bersaglio ' +
        `che allarga l'area di tocco:\n  ${senza.join('\n  ')}`,
    ).toEqual([]);
  });

  it('nessun controllo ha due aria-label', () => {
    // Successo davvero, scrivendo questa stessa correzione con un rilevatore
    // rotto: in JSX vince l'ultimo, quindi il nome che si legge non è quello
    // che si crede di aver scritto.
    const doppi = reperti.filter((r) => r.doppio).map((r) => `${r.file}:${r.riga}`);
    expect(doppi, `aria-label ripetuto:\n  ${doppi.join('\n  ')}`).toEqual([]);
  });

  it('la prova sta guardando qualcosa', () => {
    // Una guardia che non trova niente da guardare è verde per assenza di
    // bersaglio, ed è il modo più comune in cui una prova smette di proteggere
    // senza che nessuno se ne accorga.
    expect(totale).toBeGreaterThan(80);
  });
});

describe('il rilevatore stesso', () => {
  // Le due volte che si è rotto sono queste due. Provarle qui vuol dire che la
  // prossima persona che tocca lo scanner se ne accorge subito.
  it('non si ferma sul «>» di una funzione freccia', () => {
    const s = `<Input value={x} onChange={(e) => set(e.target.value)} aria-label="Cerca" />`;
    expect(attributi(s, s.indexOf('<Input') + 6)).toContain('aria-label');
  });

  it('non si ferma sul «>» dentro una stringa', () => {
    const s = `<Input placeholder="a > b" aria-label="Confronto" />`;
    expect(attributi(s, s.indexOf('<Input') + 6)).toContain('aria-label');
  });

  it('salta i controlli nominati dentro i commenti', () => {
    const zone = zoneCommento('{/* Era un <input> a mano */}\n<input aria-label="vero" />');
    expect(zone.length).toBeGreaterThan(0);
    expect(zone.some(([a, b]) => 11 >= a && 11 < b)).toBe(true);
  });
});
