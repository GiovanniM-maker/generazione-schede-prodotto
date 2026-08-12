import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Le cose che potevano aspettare, e che aspettavano da troppo.
//
// Nessuna di queste rompeva niente — e proprio per questo erano lì da mesi: una
// pagina raggiungibile solo digitando l'indirizzo, una voce di menu con dentro
// una promessa senza data, un elenco che si fermava a dieci senza dirlo, otto
// giudizi senza una riga che spiegasse cosa vogliono dire, e un unico esempio
// di prodotto sbagliato per il pubblico che compra davvero.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const leggi = (rel: string) => readFileSync(join(RADICE, rel), 'utf8');

describe('niente pagine raggiungibili solo a memoria', () => {
  it('/app/copilot non c’è più — ma il copilota sì', () => {
    // La pagina non era collegata da nessuna parte: ci si arrivava solo
    // digitando l'indirizzo. Il *componente* invece è vivo e sta in tre
    // schermate della configurazione: si cancella la pagina, non il copilota.
    expect(existsSync(join(RADICE, 'app/app/copilot'))).toBe(false);
    expect(existsSync(join(RADICE, 'components/copilot/copilot-panel.tsx'))).toBe(true);

    const usato = ['categories-client.tsx', 'attributes-client.tsx', 'category-detail-client.tsx']
      .map((f) => leggi(join('components/settings', f)))
      .filter((src) => src.includes('CopilotPanel'));
    expect(usato).toHaveLength(3);
  });
});

/**
 * Il sorgente senza commenti.
 *
 * Serve per i controlli sulle **parole che finiscono a schermo**: la prima
 * versione di questo test cercava «a breve» nel file intero e lo trovava — nel
 * commento che spiega perché quella frase è stata tolta. Un test che legge la
 * spiegazione invece del prodotto è un test che si dà ragione da solo.
 */
function senzaCommenti(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

describe('la pagina Integrazioni risponde alla domanda con cui ci si arriva', () => {
  const src = senzaCommenti(leggi('app/app/settings/integrations/page.tsx'));

  it('dice cosa c’è oggi, non solo cosa non c’è', () => {
    // Era una voce di menu con dentro una sola card «In arrivo». La risposta
    // vera — i file già nel tracciato dei negozi — esisteva e stava altrove.
    for (const piattaforma of ['Shopify', 'WooCommerce', 'PrestaShop']) {
      expect(src, piattaforma).toContain(piattaforma);
    }
  });

  it('non promette una data che nessuno può mantenere', () => {
    // «Disponibile a breve» è una promessa che scade da sola.
    expect(src).not.toMatch(/a breve/i);
  });
});

describe('l’elenco dei lavori non si ferma a dieci in silenzio', () => {
  it('c’è una pagina con tutti', () => {
    expect(existsSync(join(RADICE, 'app/app/batches/page.tsx'))).toBe(true);
  });

  it('la dashboard dice quanti sono e dove trovarli', () => {
    const dash = leggi('app/app/page.tsx');
    expect(dash).toMatch(/count: 'exact'/);
    // Il conto si dice quando questa lista ne nasconde davvero qualcuno.
    expect(dash).toMatch(/Vedi tutti i \$\{batchTotali\}/);
    // E il collegamento c'è comunque.
    //
    // Prima compariva SOLO sopra i dieci batch — cioè quando la lista era
    // troncata — e sotto i dieci dalla dashboard non si raggiungeva più
    // l'elenco completo: nessun altro punto del prodotto ci portava. Questa
    // riga è la parte che il difetto aveva: la condizione, non il testo.
    expect(dash).toMatch(/\{batches\.length > 0 && \(/);
  });

  it('«Apri» porta nello stesso posto da tutte e due', () => {
    // Due copie della stessa tabella divergerebbero al primo stato nuovo, e
    // una delle due porterebbe da qualche altra parte senza che si veda.
    expect(existsSync(join(RADICE, 'lib/batch-href.ts'))).toBe(true);
    for (const f of ['app/app/page.tsx', 'app/app/batches/page.tsx']) {
      expect(leggi(f), f).toMatch(/from '@\/lib\/batch-href'/);
    }
    expect(leggi('app/app/page.tsx')).not.toMatch(/function batchHref\(/);
  });
});

describe('gli otto giudizi dicono cosa vogliono dire', () => {
  const src = leggi('components/results-table.tsx');

  it('ognuno ha la sua spiegazione', () => {
    for (const chiave of [
      'complete',
      'parziali',
      'verifica',
      'insufficienti',
      'bloccati',
      'modificati',
      'falliti',
    ]) {
      expect(src, chiave).toMatch(new RegExp(`\\n\\s+${chiave}:\\s*\\n?\\s*'`));
    }
  });

  it('«parziale» e «insufficiente» non dicono la stessa cosa', () => {
    // È la differenza che decide se una scheda si pubblica o no, ed era
    // affidata a due aggettivi che si somigliano.
    expect(src).toMatch(/Si pubblica, ma dice meno/);
    expect(src).toMatch(/Aggiungi dati e rigenera/);
  });
});

describe('provare senza rischiare', () => {
  it('il preset di esempio usa le stesse azioni di una persona', () => {
    // Una scorciatoia che scrive in tabella per conto suo resta indietro in
    // silenzio al primo cambiamento: è così che muoiono.
    const src = leggi('lib/actions/esempio.ts');
    for (const azione of [
      'createPreset',
      'ensureDraftVersion',
      'addCategoriesFromListToPreset',
      'addAttributesFromListToPreset',
      'publishPresetVersion',
    ]) {
      expect(src, azione).toContain(azione);
    }
    // E niente scritture diverse da quelle: nessun `.from(` in questo file.
    expect(src).not.toMatch(/\.from\(/);
  });

  it('e lo pubblica: una bozza non la vede il wizard', () => {
    expect(leggi('lib/actions/esempio.ts')).toMatch(/publishPresetVersion\(\{ presetId: creato\.presetId \}\)/);
  });

  it('c’è un esempio per ogni settore davvero configurato', () => {
    // I settori del seed sono food, moda, pharma: un esempio «moda» a chi
    // vende conserve è esattamente il difetto che stiamo togliendo.
    const src = leggi('lib/actions/esempio.ts');
    // I settori stanno in più file di seed: leggerli tutti evita di legare il
    // test a quale file, che è un dettaglio di organizzazione.
    const seedDir = join(process.cwd(), 'supabase');
    const seed = readdirSync(seedDir)
      .filter((f) => f.startsWith('seed') && f.endsWith('.sql'))
      .map((f) => readFileSync(join(seedDir, f), 'utf8'))
      .join('\n');
    for (const settore of ['food', 'moda', 'pharma']) {
      expect(seed, `settore ${settore} nel seed`).toContain(`'${settore}'`);
      expect(src, `esempio per ${settore}`).toMatch(new RegExp(`\\n\\s+${settore}: \\{`));
    }
  });

  it('il listino di esempio esiste, ed è un listino vero', () => {
    const csv = readFileSync(join(RADICE, 'public/listino-di-esempio.csv'), 'utf8');
    const righe = csv.trim().split('\n');
    // Poche righe ma con dentro tutto quello che serve per vedere il prodotto
    // lavorare: codice, nome, categoria e abbastanza dati per una scheda.
    expect(righe.length).toBeGreaterThanOrEqual(6);
    expect(righe[0]).toContain('SKU');
    expect(righe[0]).toContain('Categoria');
    expect(leggi('components/batch/wizard.tsx')).toMatch(/href="\/listino-di-esempio\.csv"/);
  });

  it('la landing non parla solo di moda', () => {
    // L'unico esempio era un blazer in lana, su un prodotto che vende
    // soprattutto al food.
    const landing = leggi('app/page.tsx');
    expect(landing).toMatch(/Anteprima scheda · food/);
    expect(landing).toMatch(/Anteprima scheda · moda/);
  });
});

describe('le rotte dell’applicazione', () => {
  it('non restano cartelle di pagine vuote', () => {
    // Una cartella senza `page.tsx` non è una rotta: è un residuo.
    const cerca = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(join(RADICE, dir), { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const rel = join(dir, e.name);
        const figli = readdirSync(join(RADICE, rel), { withFileTypes: true });
        const haFile = figli.some((f) => f.isFile() && f.name.endsWith('.tsx'));
        const haCartelle = figli.some((f) => f.isDirectory());
        if (!haFile && !haCartelle) out.push(rel);
        if (haCartelle) out.push(...cerca(rel));
      }
      return out;
    };
    expect(cerca('app/app')).toEqual([]);
  });
});
