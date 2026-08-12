import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// L'identità visiva, per quel poco che una macchina può custodire.
//
// Il gusto non si mette in un test. Ma tre cose sì, e sono proprio quelle che
// erano andate perse in silenzio:
//
//   1. un carattere chiesto e mai caricato;
//   2. un colore che vuol dire due cose;
//   3. una larghezza di contenuto scelta pagina per pagina.
//
// Nessuna delle tre si nota leggendo il file che la contiene: si notano solo
// mettendo insieme file diversi, che è quello che fanno questi test.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const leggi = (rel: string) => readFileSync(join(RADICE, rel), 'utf8');

describe('il carattere', () => {
  it('viene caricato davvero, non solo evocato', () => {
    // `font-feature-settings: 'cv11', 'ss01'` sono le varianti stilistiche di
    // Inter. Erano lì da sempre, chieste a un carattere che nessuno caricava:
    // tutto rendeva col carattere di sistema e quella riga non faceva niente.
    const css = leggi('app/globals.css');
    expect(css).toMatch(/font-feature-settings/);
    expect(css).toMatch(/font-family:\s*var\(--font-sans\)/);

    const layout = leggi('app/layout.tsx');
    expect(layout).toMatch(/from 'next\/font\/google'/);
    expect(layout).toMatch(/variable:\s*'--font-sans'/);
    // La variabile va messa sull'elemento radice, altrimenti `--font-sans` non
    // esiste da nessuna parte e il `font-family` sopra ripiega in silenzio.
    expect(layout).toMatch(/<html[^>]*className=\{inter\.variable\}/);
  });

  it('è servito da noi, non da Google, come promette la cookie policy', () => {
    // `next/font` scarica in fase di compilazione e serve dal nostro dominio.
    // Un `<link>` a fonts.googleapis.com sarebbe una richiesta a terzi dal
    // browser di chi usa il prodotto — e la pagina dei cookie dice che non ne
    // facciamo.
    for (const f of ['app/layout.tsx', 'app/globals.css']) {
      expect(leggi(f)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  it('i numeri in colonna si incolonnano', () => {
    // Senza cifre a larghezza fissa un totale che cambia fa ballare la riga.
    expect(leggi('app/globals.css')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});

describe('cosa vuol dire un colore', () => {
  const badge = leggi('components/ui/badge.tsx');

  it('c’è un viola solo, e disegna viola', () => {
    // Diceva `violet` e disegnava indigo, mentre la tabella dei risultati usava
    // il viola vero per la stessa identica idea: «questo l'hai toccato tu».
    expect(badge).toMatch(/violet:\s*'bg-violet-\d+ text-violet-\d+ border-violet-\d+'/);
    expect(badge).not.toMatch(/violet:.*indigo/);
  });

  it('il settore non è uno stato: non prende il blu', () => {
    const sorgenti = fileTsx(join(RADICE, 'components/settings')).concat(
      fileTsx(join(RADICE, 'app/app/settings')),
    );
    const colpevoli = sorgenti
      .filter((f) => /<Badge tone="(blue|green|amber|red)">\{[^}]*sectorName\}/.test(f.src))
      .map((f) => f.nome);
    expect(colpevoli).toEqual([]);
  });

  it('«Custom» non è un esito: non prende il verde', () => {
    // Peggio: «Personalizzata» era viola e «Custom» verde — la stessa idea
    // detta con due colori, in due schermate della stessa sezione.
    const sorgenti = fileTsx(join(RADICE, 'components/settings'));
    const colpevoli = sorgenti
      .filter((f) => /<Badge tone="green">Custom/.test(f.src))
      .map((f) => f.nome);
    expect(colpevoli).toEqual([]);
  });
});

describe('il rosso si legge', () => {
  // ---------------------------------------------------------------------------
  // Il contrasto non si controlla a occhio, e nemmeno bloccando un esadecimale:
  // un test che dice «dev'essere #c22b27» passa anche se domani qualcuno lo
  // sostituisce con un altro rosso troppo chiaro purché scriva quello giusto —
  // e fallisce quando il colore cambia per una ragione buona.
  //
  // Qui il rapporto si RICALCOLA dal file di configurazione, con la formula
  // WCAG. Il test non custodisce un valore: custodisce la regola.
  //
  // Il difetto era `#e5322d`, cioè 4,35:1 — sotto il minimo di 4,5 — su ogni
  // richiamo all'azione del percorso di acquisizione, e sugli stessi
  // collegamenti in rosso su fondo bianco.
  // ---------------------------------------------------------------------------

  const config = leggi('tailwind.config.ts');

  function esadecimale(nome: string): string {
    const m = config.match(new RegExp(`${nome}:\\s*'(#[0-9a-fA-F]{6})'`));
    if (!m) throw new Error(`colore «${nome}» non trovato in tailwind.config.ts`);
    return m[1]!;
  }

  /** Luminanza relativa secondo WCAG 2.1. */
  function luminanza(hex: string): number {
    const canali = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = canali.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }

  function contrasto(a: string, b: string): number {
    const [x, y] = [luminanza(a), luminanza(b)];
    return (Math.max(x!, y!) + 0.05) / (Math.min(x!, y!) + 0.05);
  }

  const BIANCO = '#ffffff';

  it('il testo bianco sopra l’accento raggiunge il minimo', () => {
    const r = contrasto(esadecimale('accent'), BIANCO);
    expect(r, `accento a ${r.toFixed(2)}:1 contro bianco`).toBeGreaterThanOrEqual(4.5);
  });

  it('anche l’accento passato col mouse, che è il colore premuto', () => {
    const r = contrasto(esadecimale('accentHover'), BIANCO);
    expect(r, `accentHover a ${r.toFixed(2)}:1 contro bianco`).toBeGreaterThanOrEqual(4.5);
  });

  it('il passaggio del mouse resta percepibile', () => {
    // Scurire l'accento fin sopra la soglia rischia di appiattirlo sul suo
    // stato «sopra»: due colori che nessuno distingue non sono due colori.
    const a = esadecimale('accent');
    const h = esadecimale('accentHover');
    expect(a).not.toBe(h);
    expect(contrasto(a, h), 'accento e accentHover troppo vicini').toBeGreaterThan(1.2);
  });

  it('il contorno del fuoco usa lo stesso rosso dell’accento', () => {
    // Erano scritti a mano in due file: il giorno in cui uno dei due cambia,
    // l'altro resta indietro senza che nessuno se ne accorga.
    expect(leggi('app/globals.css')).toContain(`outline: 2px solid ${esadecimale('accent')}`);
  });
});

describe('dove sta il titolo di una pagina', () => {
  it('tutto il flusso di un batch usa lo stesso guscio', () => {
    // `new` (768) → `input` (1152) → `sample` (768) → `results` (1152): il
    // titolo saltava di lato di quasi 200 px a ogni «Avanti».
    const pagine = [
      'app/app/batches/new/page.tsx',
      'app/app/batches/[batchId]/input/page.tsx',
      'app/app/batches/[batchId]/sample/page.tsx',
      'app/app/batches/[batchId]/processing/page.tsx',
      'app/app/batches/[batchId]/results/page.tsx',
    ];
    for (const p of pagine) {
      const src = leggi(p);
      expect(src, `${p} non usa PageShell`).toMatch(/<PageShell/);
      // Nessuna larghezza propria: quella la decide il guscio.
      expect(src, `${p} si stringe per conto suo`).not.toMatch(/mx-auto max-w-/);
    }
  });
});

function fileTsx(dir: string): { nome: string; src: string }[] {
  const out: { nome: string; src: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...fileTsx(p));
    else if (e.name.endsWith('.tsx')) out.push({ nome: e.name, src: readFileSync(p, 'utf8') });
  }
  return out;
}
