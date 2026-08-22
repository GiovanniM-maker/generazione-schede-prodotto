import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Una sola finestra sovrapposta, e nessuna domanda del browser.
//
// PERCHÉ ESISTE QUESTA PROVA
//
// Il prodotto aveva QUATTRO implementazioni di finestra sovrapposta, e tre non
// trattenevano il fuoco: premendo Tab si usciva dal pannello e si finiva a
// navigare la pagina sottostante, che intanto era coperta da un velo e non si
// poteva usare. Chi non vede lo schermo si ritrovava a leggere qualcosa che per
// tutti gli altri non c'era più.
//
// Non erano quattro sviste: erano quattro occasioni di sbagliare la stessa
// cosa. E la quinta sarebbe arrivata al prossimo pannello, perché scrivere
// `fixed inset-0` è più veloce che cercare il componente giusto.
//
// COSA PROTEGGE. Che il quinto non venga scritto. La regressione qui non si
// vede: la finestra funziona benissimo col mouse, e il difetto salta fuori solo
// premendo Tab per la ventesima volta — cioè mai, prima di un rilascio.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');

function tsx(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next') continue;
    const percorso = join(dir, nome);
    if (statSync(percorso).isDirectory()) tsx(percorso, acc);
    else if (nome.endsWith('.tsx')) acc.push(percorso);
  }
  return acc;
}

const FILE = [...tsx(join(RADICE, 'components')), ...tsx(join(RADICE, 'app'))];
const leggi = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(RADICE.length + 1);

describe('le finestre sovrapposte', () => {
  it('sono disegnate da un componente solo', () => {
    // `fixed inset-0` è la firma di una finestra fatta a mano. L'unico posto in
    // cui è legittima è il componente condiviso; l'altro è la guida a fumetti,
    // che NON è una finestra modale — è un alone col buco sopra la pagina, e
    // deve poter lasciar passare i clic.
    const AMMESSI = new Set(['components/ui/overlay.tsx', 'components/onboarding/guided-tour.tsx']);
    const colpevoli = FILE.filter((p) => leggi(p).includes('fixed inset-0')).map(rel).filter((p) => !AMMESSI.has(p));
    expect(
      colpevoli,
      `finestra disegnata a mano: usa <Overlay> da @/components/ui/overlay.\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  it('trattengono il fuoco, e il componente che lo fa è quello', () => {
    const overlay = leggi(join(RADICE, 'components/ui/overlay.tsx'));
    // Le quattro cose che distinguono una finestra modale da un riquadro
    // sovrapposto. Erano presenti in una implementazione su quattro.
    expect(overlay, 'manca role="dialog"').toContain('role="dialog"');
    expect(overlay, 'manca aria-modal').toContain('aria-modal="true"');
    expect(overlay, 'il fuoco non viene trattenuto').toContain('prossimoFuoco');
    expect(overlay, 'lo scorrimento della pagina sotto non viene bloccato').toContain(
      "document.body.style.overflow = 'hidden'",
    );
    // La quinta, quella che si dimentica sempre: il fuoco deve TORNARE dove
    // stava. Senza, dopo aver chiuso si riparte dall'inizio della pagina.
    expect(overlay, 'il fuoco non torna al punto di partenza').toMatch(/prima\?\.focus\?\.\(\)/);
  });

  it('la decisione su dove va il fuoco non è scritta nel componente', () => {
    // Sta in `@app/core/interfaccia`, dove si prova esaustivamente senza
    // montare un DOM. Il componente la chiama e basta.
    const core = leggi(join(process.cwd(), 'packages/core/src/interfaccia.ts'));
    expect(core).toContain('export function prossimoFuoco');
    expect(core).toContain('export function serveIntervenire');
  });
});

describe('le domande all’utente', () => {
  it('nessuna passa dal dialogo del browser', () => {
    // `window.confirm` blocca il thread, non si può disegnare, e su alcuni
    // browser mostra il dominio — il che lo fa sembrare un avviso di sistema
    // invece che una domanda del prodotto. Era la crepa più visibile
    // nell'illusione dell'applicazione, e stava in due punti.
    const colpevoli = FILE.filter((p) => {
      const testo = leggi(p);
      // Nei commenti si può nominare: è il modo di spiegare perché non si usa.
      return testo
        .split('\n')
        .some((riga) => riga.includes('window.confirm(') && !riga.trimStart().startsWith('*') && !riga.trimStart().startsWith('//'));
    }).map(rel);
    expect(
      colpevoli,
      `usa <ConfermaDistruttiva> invece di window.confirm.\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('i comandi', () => {
  it('rispondono alla pressione', () => {
    // Su telefono il passaggio del mouse non esiste: senza `:active`, toccare
    // un comando non produce NESSUN segnale finché la risposta non arriva. Su
    // una rete lenta sono secondi in cui non si sa se il tocco è stato preso.
    const bottone = leggi(join(RADICE, 'components/ui/button.tsx'));
    expect(bottone, 'manca lo stato premuto').toContain('active:scale-');
    // E chi ha chiesto meno movimento non lo subisce.
    expect(bottone).toContain('motion-reduce:active:scale-100');
  });

  it('sanno dire che stanno lavorando senza cambiare misura', () => {
    const bottone = leggi(join(RADICE, 'components/ui/button.tsx'));
    expect(bottone, 'manca lo stato di caricamento').toContain('loading?: boolean');
    // `aria-busy`: senza, il comando diventa muto e spento, e sembra rotto
    // invece che occupato.
    expect(bottone).toContain('aria-busy');
  });
});

// La scala tipografica arriva con la sua PR: qui era stata infilata e faceva
// scorrere di lato la dashboard di 6 px a 320 px.
describe('i piani dell’impilamento', () => {
  const config = readFileSync(join(RADICE, 'tailwind.config.ts'), 'utf8');

  it('l’impilamento ha dei nomi, non dei numeri a caso', () => {
    // Erano otto valori scelti uno alla volta: 10, 20, 30, 40, 50, 60, 70, 100.
    // Il nono sarebbe stato scelto allo stesso modo.
    for (const nome of ['sticky', 'header', 'overlay', 'guida', 'toast']) {
      expect(config, `manca il piano «${nome}»`).toContain(`${nome}: '`);
    }
  });

  it('i riscontri stanno sopra le finestre e sopra la guida', () => {
    // Un errore deve poter comparire mentre è aperta una finestra e durante la
    // guida guidata. A parità di piano vincerebbe l'ordine nel documento, che
    // è esattamente il tipo di dipendenza che si rompe da sola.
    const piano = (nome: string) => Number(config.match(new RegExp(`${nome}: '(\\d+)'`))?.[1]);
    expect(piano('toast')).toBeGreaterThan(piano('guida'));
    expect(piano('guida')).toBeGreaterThan(piano('overlay'));
    expect(piano('overlay')).toBeGreaterThan(piano('header'));
    expect(piano('header')).toBeGreaterThan(piano('sticky'));
  });
});
