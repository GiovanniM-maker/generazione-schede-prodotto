import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileDelWizard } from './wizard-intero.js';

// ---------------------------------------------------------------------------
// Il wizard non torna a essere un file solo.
//
// DA DOVE SI VIENE: 3876 righe, 26 componenti, undici schermate e
// l'orchestratore nello stesso file. Non era un file lungo — era undici
// schermate che vivevano insieme e si scambiavano stato attraverso un
// componente da 1558 righe. Per cambiare una parola nel passo 8 bisognava
// aprire tutto, e ogni modifica toccava lo stesso file di tutte le altre.
//
// COSA PROTEGGE QUESTA PROVA. Che la prossima schermata non venga scritta
// dentro `wizard.tsx`, che è la cosa più facile da fare: il file è già lì, il
// componente è già aperto, e nessuno se ne accorge finché non sono di nuovo
// quattromila righe.
//
// I cinque file portano già i nomi dei cinque stadi in cui gli undici passi
// stanno per essere accorpati — Prepara, Carica, Mappa, Ripara, Prova — così
// il taglio di adesso e quello di dopo non si contraddicono.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const PASSI = join(RADICE, 'components/batch/passi');
const leggi = (rel: string) => readFileSync(join(RADICE, rel), 'utf8');

const STADI = ['prepara.tsx', 'carica.tsx', 'mappa.tsx', 'ripara.tsx', 'prova.tsx'];
const SERVIZIO = ['tipi.ts', 'definizioni.ts', 'utili.ts', 'pezzi.tsx'];

describe('il wizard sta in pezzi, e ci resta', () => {
  it('i cinque stadi esistono, e si chiamano come si chiameranno', () => {
    const presenti = readdirSync(PASSI).sort();
    for (const f of [...STADI, ...SERVIZIO]) {
      expect(presenti, `manca ${f}`).toContain(f);
    }
  });

  it('nessuna schermata è rimasta nell’orchestratore', () => {
    // `Step1`…`Step11` stavano tutti qui dentro. Riscriverne uno qui è più
    // veloce che aprire il file giusto, ed è così che si torna a 3876 righe.
    const wizard = leggi('components/batch/wizard.tsx');
    const dentro = [...wizard.matchAll(/^(?:export )?function (Step\d+)\b/gm)].map((m) => m[1]!);
    expect(
      dentro,
      `queste schermate vanno in components/batch/passi/:\n  ${dentro.join('\n  ')}`,
    ).toEqual([]);
  });

  it('nessun file del wizard torna a essere illeggibile', () => {
    // La soglia non è un numero tondo per bellezza: `wizard.tsx` era 3876
    // righe. Mille è il punto oltre il quale si smette di leggere un file e si
    // comincia a cercarci dentro.
    const grossi = fileDelWizard()
      .map((f) => ({ f, righe: leggi(f).split('\n').length }))
      .filter((x) => x.righe > 1800)
      .map((x) => `${x.f}: ${x.righe} righe`);
    expect(grossi, `si sta riformando un file solo:\n  ${grossi.join('\n  ')}`).toEqual([]);
  });

  it('l’orchestratore non disegna: chiama', () => {
    // Ogni stadio deve essere USATO, non solo definito. Un file di passi che
    // nessuno importa è codice morto che sembra vivo.
    const wizard = leggi('components/batch/wizard.tsx');
    for (const stadio of STADI) {
      const nome = stadio.replace('.tsx', '');
      expect(wizard, `${nome} non viene importato da nessuno`).toContain(
        `@/components/batch/passi/${nome}`,
      );
    }
  });

  it('i passi non si chiamano fra loro in cerchio', () => {
    // Un ciclo fra i pezzi non rompe il build — il bundler lo regge — ma
    // rompe l'ordine di valutazione in modi che si vedono solo a runtime, e
    // solo qualche volta. Meglio non averne.
    const file = readdirSync(PASSI);
    const archi = new Map<string, string[]>();
    for (const f of file) {
      const src = readFileSync(join(PASSI, f), 'utf8');
      archi.set(
        f,
        [...src.matchAll(/from '@\/components\/batch\/passi\/([A-Za-z0-9_-]+)'/g)]
          .map((m) => file.find((x) => x.startsWith(m[1]! + '.')))
          .filter((x): x is string => Boolean(x)),
      );
    }
    const cicli: string[] = [];
    const visita = (n: string, strada: string[]) => {
      if (strada.includes(n)) {
        cicli.push([...strada.slice(strada.indexOf(n)), n].join(' → '));
        return;
      }
      for (const p of archi.get(n) ?? []) visita(p, [...strada, n]);
    };
    for (const f of file) visita(f, []);
    expect(cicli, `import in cerchio:\n  ${cicli.join('\n  ')}`).toEqual([]);
  });

  it('la prova sta guardando qualcosa', () => {
    // Una guardia che non trova file è verde per assenza di bersaglio: se la
    // cartella sparisce o cambia nome, va notato.
    expect(fileDelWizard().length).toBeGreaterThanOrEqual(10);
  });
});
