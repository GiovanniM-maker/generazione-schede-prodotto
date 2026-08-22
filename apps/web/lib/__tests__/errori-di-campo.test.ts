import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Il campo che il server accusa deve esistere davvero.
//
// PERCHÉ ESISTE QUESTA PROVA
//
// Quando un'azione risponde `{ ok: false, campo: 'fat-indirizzo', … }`, il
// modulo porta il fuoco su quell'id. Se l'id non esiste — e nel primo giro non
// esisteva, il campo si chiamava `fat-via` — non succede NIENTE:
// `getElementById` torna `null`, `?.focus()` non fa nulla, e non c'è alcun
// errore da nessuna parte.
//
// È il tipo di difetto peggiore: silenzioso, e presente proprio nel meccanismo
// che serviva a togliere il silenzio. Chi preme «Salva» vedrebbe l'errore in
// cima e il fuoco fermo dov'era — cioè esattamente la situazione di prima.
//
// Nessun compilatore lo può vedere: da una parte c'è una stringa, dall'altra
// un attributo JSX. Questa prova mette in comunicazione le due.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const leggi = (rel: string) => readFileSync(join(RADICE, rel), 'utf8');

/** Le coppie azione → modulo che si scambiano gli id dei campi. */
const COPPIE: Array<{ azione: string; modulo: string; nome: string }> = [
  {
    nome: 'dati di fatturazione',
    azione: 'lib/actions/fatturazione.ts',
    modulo: 'components/billing/dati-fatturazione-form.tsx',
  },
];

describe('gli id dei campi accusati dal server', () => {
  for (const { nome, azione, modulo } of COPPIE) {
    it(`esistono nel modulo · ${nome}`, () => {
      const sorgenteAzione = leggi(azione);
      const sorgenteModulo = leggi(modulo);

      const accusati = [...sorgenteAzione.matchAll(/campo:\s*'([^']+)'/g)].map((m) => m[1]!);
      // Una prova che non trova niente da controllare è verde per assenza di
      // bersaglio: se un giorno l'azione smette di dire quale campo, va notato.
      expect(accusati.length, 'l’azione non indica più il campo colpevole').toBeGreaterThan(0);

      const esistenti = new Set(
        [...sorgenteModulo.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!),
      );
      const fantasmi = [...new Set(accusati)].filter((id) => !esistenti.has(id));
      expect(
        fantasmi,
        `il server accusa un campo che nel modulo non esiste: il fuoco non ci arriva e nessuno se ne accorge.\n  ${fantasmi.join('\n  ')}`,
      ).toEqual([]);
    });

    it(`il sommario elenca gli stessi campi · ${nome}`, () => {
      // Il sommario in cima porta al primo campo colpevole. Se un id accusato
      // dal server non è nel suo elenco, quell'errore non viene mai contato:
      // il riquadro dice «nessun problema» mentre il campo è rosso.
      const accusati = new Set(
        [...leggi(azione).matchAll(/campo:\s*'([^']+)'/g)].map((m) => m[1]!),
      );
      const sorgenteModulo = leggi(modulo);
      const elenco = /riassuntoErrori\([\s\S]*?\]\);/.exec(sorgenteModulo)?.[0] ?? '';
      const nelSommario = new Set([...elenco.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]!));

      const fuori = [...accusati].filter((id) => !nelSommario.has(id));
      expect(fuori, `campi accusati ma non contati nel sommario:\n  ${fuori.join('\n  ')}`).toEqual([]);
    });
  }
});

describe('il modulo di fatturazione', () => {
  const modulo = leggi('components/billing/dati-fatturazione-form.tsx');

  it('mostra l’errore sul campo, non solo in cima', () => {
    // Prima l'errore era una stringa sola in un riquadro: su dieci campi
    // diceva «qualcosa non va» senza dire dove.
    expect(modulo).toMatch(/errore=\{erroriCampo\[/);
  });

  it('porta il fuoco sul campo colpevole', () => {
    expect(modulo).toMatch(/getElementById\(res\.campo/);
    expect(modulo).toMatch(/el\?\.focus\(\)/);
  });

  it('cancella l’errore mentre si rimedia', () => {
    // Senza, bisognerebbe reinviare il modulo per sapere se il campo adesso va
    // bene: si scrive alla cieca.
    expect(modulo).toMatch(/if \(id && erroriCampo\[id\]\)/);
  });

  it('il sommario si può premere e porta da qualche parte', () => {
    // Un sommario che dice «3 campi da sistemare» e non è cliccabile lascia
    // comunque il lavoro di andarli a cercare.
    expect(modulo).toMatch(/sommario\.titolo/);
    expect(modulo).toMatch(/sommario\.primo/);
  });
});
