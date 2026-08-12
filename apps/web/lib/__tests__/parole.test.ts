import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Le parole a schermo.
//
// Sono la parte del prodotto che si legge davvero, e sono quella che scivola
// per prima: un'etichetta che promette una pagina che non esiste, un contatore
// che chiama «duplicati» il caso normale, una parola inglese in mezzo a una
// frase italiana. Nessuna di queste rompe niente — e proprio per questo
// nessuno le corregge.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const leggi = (rel: string) => readFileSync(join(RADICE, rel), 'utf8');

function tsx(dir: string): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  for (const e of readdirSync(join(RADICE, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsx(rel));
    else if (e.name.endsWith('.tsx')) out.push({ path: rel, src: leggi(rel) });
  }
  return out;
}

const sorgenti = [...tsx('components'), ...tsx('app')];

describe('un’etichetta non promette una pagina che non esiste', () => {
  it('nessun «Registrati» che porta su «Accedi»', () => {
    // `/signup` risponde 404 e nessun collegamento ci punta: non era un
    // collegamento rotto, era un'etichetta che prometteva una pagina che non
    // c'è. Il percorso è uno solo, e il primo accesso crea l'account.
    const colpevoli = sorgenti.filter((f) => />Registrati</.test(f.src)).map((f) => f.path);
    expect(colpevoli).toEqual([]);
  });

  it('la pagina di accesso dice che serve anche a registrarsi', () => {
    expect(leggi('app/login/page.tsx')).toMatch(/Accedi o registrati/);
  });
});

describe('i contatori dicono cosa è successo', () => {
  it('«da rivedere» non c’è più: quelle righe sono scartate', () => {
    // Promettevano una revisione che non esiste da nessuna parte.
    const colpevoli = sorgenti.filter((f) => /\{importSummary\.invalid\} da rivedere/.test(f.src));
    expect(colpevoli.map((f) => f.path)).toEqual([]);
    expect(leggi('components/batch/wizard.tsx')).toMatch(/righe scartate/);
  });

  it('e si può vedere QUALI righe sono cadute, con il perché', () => {
    // Prima ne restava solo il numero: l'unico modo di scoprire quali era
    // confrontare a mano il file con il catalogo importato.
    const azioni = readFileSync(join(RADICE, 'lib/actions/batch-wizard.ts'), 'utf8');
    expect(azioni).toMatch(/scartate: RigaScartata\[\]/);
    for (const motivo of ['codice non valido', 'codice ripetuto nel file', 'dati insufficienti']) {
      expect(azioni, motivo).toContain(`'${motivo}'`);
    }
    expect(leggi('components/batch/wizard.tsx')).toMatch(/Quali righe sono state scartate/);
  });

  it('lo stesso file caricato due volte non si chiama «SKU duplicati»', () => {
    // Era falso e allarmava per una cosa che va benissimo: due foto con lo
    // stesso codice sono il caso NORMALE — fronte, retro, etichetta — e il
    // sistema le raggruppa apposta.
    const banner = leggi('components/import-issues-banner.tsx');
    expect(banner).not.toMatch(/label: 'SKU duplicati'/);
    expect(banner).toMatch(/Stesso file caricato due volte/);
  });
});

describe('il conto dei passi non cambia strada facendo', () => {
  it('il totale si dice solo quando si conosce', () => {
    // Con un Excel i passi sono due in più: finché la fonte non è scelta il
    // totale non si sa, e prometterne uno vuol dire passare da «di 9» a «di 11»
    // senza aver fatto niente di sbagliato.
    const wizard = leggi('components/batch/wizard.tsx');
    expect(wizard).toMatch(/totaleNoto \? ` di \$\{steps\.length\}` : ''/);
    expect(wizard).toMatch(/totaleNoto=\{sourceMode !== null\}/);
  });
});

describe('l’aiuto non copre il comando principale', () => {
  it('su telefono il pulsante flottante non c’è', () => {
    // La barra dei comandi è `sticky`: con poco contenuto si ferma a metà
    // schermo, proprio dove galleggiava «Serve aiuto?». Misurato: si
    // sovrapponevano a «Crea e continua».
    const guida = leggi('components/onboarding/wizard-guide.tsx');
    expect(guida).toMatch(/hidden items-center gap-2 rounded-full sm:flex/);
  });

  it('e nella barra c’è il suo comando', () => {
    expect(leggi('components/batch/wizard.tsx')).toMatch(/aria-label="Apri la guida"/);
  });
});

describe('una parola per una cosa', () => {
  it('niente «Custom» in un prodotto italiano', () => {
    const colpevoli = sorgenti
      .filter((f) => !f.path.endsWith('badge.tsx'))
      .filter((f) => />Custom(\s|<|\{)/.test(f.src))
      .map((f) => f.path);
    expect(colpevoli).toEqual([]);
  });

  it('gli indirizzi sono in inglese, tutti', () => {
    // `/storico` era l'unico in italiano fra sette in inglese. Una sola
    // eccezione non è una convenzione: è un inciampo.
    expect(existsSync(join(RADICE, 'app/app/settings/activity/page.tsx'))).toBe(true);
    expect(leggi('components/settings/settings-nav.tsx')).toMatch(/'\/app\/settings\/activity'/);
  });

  it('il vecchio indirizzo continua a funzionare', () => {
    // I segnalibri di chi lo usava non si rompono per una questione di
    // coerenza nostra.
    expect(leggi('app/app/settings/storico/page.tsx')).toMatch(
      /permanentRedirect\('\/app\/settings\/activity'\)/,
    );
  });
});
