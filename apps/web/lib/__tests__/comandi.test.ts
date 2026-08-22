import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// `disabled` non è una parola sola.
//
// IL NUMERO DI PARTENZA: 118 comandi con `disabled`, e dietro quella parola tre
// situazioni diverse — sta lavorando, non ancora, non disponibile — trattate
// tutte allo stesso modo: grigio, muto, e non raggiungibile.
//
// I DUE DIFETTI CHE QUESTA PROVA TIENE CHIUSI.
//
// Il primo: **un pulsante grigio non sa dire perché è grigio**. Chi guarda un
// modulo con tre requisiti e un comando spento deve indovinare quale manchi. E
// su telefono l'autocompilazione spesso non fa scattare la validazione, quindi
// il modulo è GIUSTO e il comando resta spento lo stesso — senza appello.
//
// Il secondo, invisibile finché non lo si prova: **un elemento `disabled` non
// prende il fuoco**. Con la tastiera lo si salta, quindi non si scopre nemmeno
// che esiste, e il motivo per cui è spento — quando c'è — non lo si può
// leggere. È il modo più efficace di nascondere una funzione a chi non usa il
// mouse.
//
// LA REGOLA: `disabled` vero solo mentre una richiesta è in volo, che dura un
// istante. Tutto il resto è `nonDisponibile`, con il motivo scritto per chi
// legge.
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

/** Gli attributi di un tag, contando le graffe e le virgolette. */
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
  return s.slice(da, da + 900);
}

/**
 * Le bandiere che vogliono dire «sta lavorando».
 *
 * Sono le uniche condizioni per cui `disabled` vero è ancora giusto: dura il
 * tempo di una richiesta, e serve a non mandarla due volte.
 */
const LAVORO =
  /^(pending|busy|loading|applying|starting|exporting|enqueuing|inCorso|attesa|reparsing|esempioInCorso|fbBusy|bulkBusy|analyzing|improving|saving|submitting)$/;

function condizioneDiLavoro(v: string): boolean {
  return v
    .split('||')
    .map((x) => x.trim())
    .every(
      (x) =>
        LAVORO.test(x) ||
        // `exporting !== null`, `busyId === a.id`, `recState === 'recording'`:
        // sono sempre «una cosa è in corso», scritta con più di una parola.
        /^\w+ !== null$/.test(x) ||
        /^busyId === /.test(x) ||
        /^recState === '\w+'$/.test(x),
    );
}

const FILE = [...tsx(join(RADICE, 'components')), ...tsx(join(RADICE, 'app'))];

interface Uso {
  file: string;
  riga: number;
  condizione: string;
}

function usiDiDisabled(): Uso[] {
  const fuori: Uso[] = [];
  for (const p of FILE) {
    // Il componente è il posto in cui la regola è SCRITTA: lì `disabled` ci va.
    if (p.endsWith(join('ui', 'button.tsx'))) continue;
    const s = readFileSync(p, 'utf8');
    for (const m of s.matchAll(/<(Button|button)\b/g)) {
      const attr = attributi(s, m.index! + m[0].length);
      const dm = /(^|\s)disabled=\{([\s\S]*?)\}(\s|$)/.exec(attr);
      if (!dm) continue;
      const condizione = dm[2]!.trim().replace(/\s+/g, ' ');
      if (condizioneDiLavoro(condizione)) continue;
      fuori.push({
        file: p.slice(RADICE.length + 1),
        riga: s.slice(0, m.index!).split('\n').length,
        condizione,
      });
    }
  }
  return fuori;
}

describe('quando un comando si spegne', () => {
  it('`disabled` resta solo per «sta lavorando»', () => {
    // Ogni altra condizione — un campo vuoto, un preset pubblicato, una lista
    // senza selezione — deve passare da `nonDisponibile`, che lascia il comando
    // raggiungibile e ne dice il motivo.
    const colpevoli = usiDiDisabled().map((u) => `${u.file}:${u.riga}  disabled={${u.condizione}}`);
    expect(
      colpevoli,
      'questo non è «sta lavorando»: usa `nonDisponibile="…"` con il motivo, ' +
        `così il comando resta raggiungibile e sa dire perché è spento.\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  it('la decisione non è scritta nel componente', () => {
    // Sta in `@app/core/comandi`, dove si prova esaustivamente senza montare un
    // DOM. Il componente la chiama e basta.
    const bottone = readFileSync(join(RADICE, 'components/ui/button.tsx'), 'utf8');
    expect(bottone).toContain('aspettoComando');
    const core = readFileSync(join(process.cwd(), 'packages/core/src/comandi.ts'), 'utf8');
    expect(core).toContain('export function aspettoComando');
    expect(core).toContain('export function motivoMancante');
  });

  it('«non disponibile» lascia il comando raggiungibile', () => {
    // È il punto di tutta la modifica: `aria-disabled` invece di `disabled`, e
    // il clic fermato a mano — senza `disabled` vero un `type="submit"`
    // invierebbe comunque il modulo.
    const bottone = readFileSync(join(RADICE, 'components/ui/button.tsx'), 'utf8');
    expect(bottone).toContain('aria-disabled={aspetto.dichiaratoSpento || undefined}');
    // L'ESPRESSIONE, non la parola.
    //
    // Qui prima c'era `toMatch(/preventDefault/)`, e restava VERDE anche
    // togliendo del tutto il guardiano: la parola compare nel commento che lo
    // spiega, tre righe sopra. Una guardia che trova la propria spiegazione non
    // sta guardando il codice.
    expect(bottone).toContain(
      'onClick={aspetto.ignoraClic ? (e) => e.preventDefault() : onClick}',
    );
    // E NON deve tornare `disabled` per il solo fatto che c'è un motivo.
    expect(bottone).toContain('disabled={disabled || aspetto.spentoDavvero}');
  });

  it('il motivo entra nel nome, dove viene letto sempre', () => {
    // `aria-describedby` è facoltativo e molti lettori di schermo lo saltano.
    // Un comando che non si può usare deve dire perché nel nome.
    const bottone = readFileSync(join(RADICE, 'components/ui/button.tsx'), 'utf8');
    expect(bottone).toContain("{aspetto.aggiuntaAlNome !== '' && (");
    expect(bottone).toContain('<span className="sr-only"> — {aspetto.aggiuntaAlNome}</span>');
  });
});

describe('i motivi che si mostrano', () => {
  /**
   * Il valore passato a `nonDisponibile`, letto contando le graffe.
   *
   * Una regex che si ferma alla prima `}` qui non basta: dentro ci sono
   * ternari, oggetti e chiamate. La prima versione di questa prova lo faceva e
   * si portava dietro trecento righe di JSX — cioè misurava tutt'altro.
   */
  function valoriNonDisponibile(): Array<{ file: string; valore: string }> {
    const out: Array<{ file: string; valore: string }> = [];
    for (const p of FILE) {
      const s = readFileSync(p, 'utf8');
      for (const m of s.matchAll(/nonDisponibile=/g)) {
        const i = m.index! + m[0].length;
        if (s[i] === '"') {
          const fine = s.indexOf('"', i + 1);
          out.push({ file: p.slice(RADICE.length + 1), valore: s.slice(i + 1, fine) });
          continue;
        }
        if (s[i] !== '{') continue;
        let d = 0;
        let q: string | null = null;
        let j = i;
        for (; j < s.length; j++) {
          const c = s[j]!;
          if (q) {
            if (c === q) q = null;
          } else if (c === '"' || c === "'" || c === '`') q = c;
          else if (c === '{') d++;
          else if (c === '}' && --d === 0) break;
        }
        out.push({ file: p.slice(RADICE.length + 1), valore: s.slice(i + 1, j) });
      }
    }
    return out;
  }

  const valori = valoriNonDisponibile();

  /**
   * Le frasi intere: quelle scritte a mano, non i pezzi per `motivoMancante`.
   *
   * Dentro un ternario ci sono anche stringhe che frasi non sono — l'operando
   * di un confronto (`=== 'ELIMINA'`), il ramo vuoto. Si tengono solo quelle
   * che almeno SEMBRANO una frase: tre parole su una riga sola. Un motivo di
   * due parole scritto male sfugge, ed è un limite dichiarato: la guardia serve
   * a fermare `nonDisponibile="disabled"`, non a fare l'editor.
   */
  const motivi = valori
    .filter((v) => !v.valore.includes('motivoMancante'))
    .flatMap((v) =>
      [...v.valore.matchAll(/'([^']{4,})'/g)]
        .map((m) => m[1]!)
        .filter((t) => !/[\n\r]/.test(t) && t.trim().split(/\s+/).length >= 3)
        .map((testo) => ({ file: v.file, testo })),
    );

  /** I pezzi che `motivoMancante` incastra dentro «Serve prima: …». */
  const pezzi = valori
    .filter((v) => v.valore.includes('motivoMancante'))
    .flatMap((v) =>
      [...v.valore.matchAll(/cosa:\s*'([^']+)'/g)].map((m) => ({ file: v.file, testo: m[1]! })),
    );

  it('sono frasi per chi legge, non nomi di variabili', () => {
    // «Requisiti non soddisfatti» o `!canProceed` non aiutano nessuno: il
    // motivo va scritto come lo si direbbe a voce, e finisce con un punto
    // perché viene letto di seguito al nome del comando.
    const brutti = motivi
      .filter((m) => !/^[A-ZÈÉÀÌÒÙ«]/.test(m.testo) || !/[.!?»]$/.test(m.testo.trim()))
      .map((m) => `${m.file}: «${m.testo}»`);
    expect(
      brutti,
      `un motivo si scrive come si direbbe a voce, e finisce con un punto:\n  ${brutti.join('\n  ')}`,
    ).toEqual([]);
  });

  it('i pezzi di «Serve prima: …» sono pezzi, non frasi', () => {
    // `motivoMancante` li incastra dentro una frase: «Serve prima: il nome del
    // lavoro e almeno una categoria.» Se un pezzo comincia in maiuscolo o
    // finisce col punto, la frase esce sgrammaticata — e la si legge di seguito
    // al nome del comando, quindi si sente.
    const brutti = pezzi
      .filter((p) => /^[A-Z]/.test(p.testo) || /[.!?]$/.test(p.testo.trim()))
      .map((p) => `${p.file}: «${p.testo}»`);
    expect(
      brutti,
      `va in mezzo a «Serve prima: … e ….»: minuscolo e senza punto.\n  ${brutti.join('\n  ')}`,
    ).toEqual([]);
  });

  it('la prova sta guardando qualcosa', () => {
    // Una guardia che non trova bersagli è verde per assenza di bersaglio.
    expect(valori.length, 'la sostituzione non è stata fatta').toBeGreaterThan(20);
    expect(motivi.length).toBeGreaterThan(5);
    expect(pezzi.length).toBeGreaterThan(10);
  });
});
