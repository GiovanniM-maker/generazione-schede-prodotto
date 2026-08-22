import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Il wizard, tutto.
//
// PERCHÉ ESISTE. Diverse guardie parlano di «cosa dice il wizard»: che i
// contatori usino le parole del prodotto, che il listino di esempio si possa
// scaricare, che il totale dei passi non cambi strada facendo. Fino a ieri
// leggevano un file solo, perché il wizard ERA un file solo — 3876 righe con
// dentro undici schermate.
//
// Adesso le schermate stanno in `batch/passi/`. Quelle guardie parlano del
// PERCORSO, non del file: farle leggere ancora `wizard.tsx` le lascerebbe
// verdi per assenza di bersaglio, cioè le spegnerebbe senza che si veda.
//
// Legge la cartella, non un elenco scritto a mano: un passo nuovo entra da
// solo. Un elenco si dimentica di aggiornare, e si dimentica in silenzio.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const PASSI = join(RADICE, 'components/batch/passi');

/** L'orchestratore più tutte le schermate, come un testo solo. */
export function wizardIntero(): string {
  const pezzi = [readFileSync(join(RADICE, 'components/batch/wizard.tsx'), 'utf8')];
  for (const nome of readdirSync(PASSI).sort()) {
    pezzi.push(readFileSync(join(PASSI, nome), 'utf8'));
  }
  return pezzi.join('\n');
}

/** I file che compongono il wizard, con il percorso relativo ad `apps/web`. */
export function fileDelWizard(): string[] {
  return [
    'components/batch/wizard.tsx',
    ...readdirSync(PASSI)
      .sort()
      .map((n) => `components/batch/passi/${n}`),
  ];
}
