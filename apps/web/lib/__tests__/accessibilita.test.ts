import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { senzaCommenti } from './senza-commenti.js';

// ---------------------------------------------------------------------------
// Quello che il prodotto dice a chi non guarda lo schermo.
//
// Non era «poco»: era **niente**. Zero `aria-live`, zero `role="status"`, zero
// `role="alert"` su 55 riquadri di riscontro. Si premeva «Salva» e non
// arrivava nessuna notizia — né buona né cattiva. Le modali non erano modali: il
// fuoco restava fuori, e continuando con Tab si finiva a navigare la pagina
// coperta. E per arrivare al contenuto servivano dieci tappe di tastiera, a
// ogni pagina.
//
// Sono difetti che non si vedono guardando, e per questo erano passati: la
// pagina, a occhio, funzionava benissimo.
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

describe('la modale è davvero una modale', () => {
  const modale = leggi('components/settings/modal.tsx');

  it('si dichiara per quello che è', () => {
    expect(modale).toMatch(/role="dialog"/);
    expect(modale).toMatch(/aria-modal="true"/);
    // Senza `aria-labelledby` un lettore di schermo annuncia «dialogo» e basta.
    expect(modale).toMatch(/aria-labelledby=\{titoloId\}/);
  });

  it('il fuoco entra all’apertura', () => {
    expect(modale).toMatch(/querySelector<HTMLElement>\(FUOCABILI\)/);
    expect(modale).toMatch(/\?\?\s*riquadro\.current\)\?\.focus\(\)/);
  });

  it('il fuoco resta dentro: Tab e Shift+Tab girano', () => {
    expect(modale).toMatch(/e\.key !== 'Tab'/);
    expect(modale).toMatch(/e\.shiftKey/);
    expect(modale).toMatch(/ultimo\.focus\(\)/);
    expect(modale).toMatch(/primo\.focus\(\)/);
  });

  it('e alla chiusura torna da dove era partito', () => {
    // È quella che si dimentica sempre, ed è quella che si sente di più: senza,
    // dopo aver chiuso una modale si riparte dall'inizio della pagina.
    expect(modale).toMatch(/const prima = document\.activeElement/);
    expect(modale).toMatch(/prima\?\.focus\?\.\(\)/);
  });

  it('l’effetto non dipende da `onClose`', () => {
    // `onClose` è quasi sempre scritta al volo nel punto d'uso, quindi cambia
    // identità a ogni render: con lei fra le dipendenze la pulizia
    // rimetterebbe il fuoco sul pulsante di apertura *mentre* la modale è
    // aperta, a ogni battuta di tasto.
    expect(modale).toMatch(/\}, \[open\]\);/);
    expect(modale).toMatch(/chiudi\.current\(\)/);
  });
});

describe('i riquadri di riscontro parlano', () => {
  const avviso = leggi('components/ui/avviso.tsx');

  it('l’errore interrompe, la conferma aspetta il suo turno', () => {
    // Non è una sfumatura: un errore non detto lascia credere che sia andata
    // bene, una conferma detta subito interrompe la lettura per nulla.
    expect(avviso).toMatch(/errore:[\s\S]{0,200}ruolo: 'alert'/);
    expect(avviso).toMatch(/riuscito:[\s\S]{0,200}ruolo: 'status'/);
    expect(avviso).toMatch(/aria-live=/);
  });

  // -------------------------------------------------------------------------
  // Questo test cercava una stringa, e per questo non vedeva niente.
  //
  // Chiedeva `<div className="rounded-lg border border-red-200 bg-red-50…">`:
  // cioè pretendeva che le classi COMINCIASSERO così. Il riquadro d'errore
  // della pagina di accesso scriveva
  // `flex items-start gap-2 rounded-lg border border-red-200 …` — stesse
  // classi, ordine diverso — ed è rimasto muto per mesi sull'unica porta
  // d'ingresso del prodotto. Erano tredici in tutto, e nessuno li vedeva.
  //
  // Ora si cerca la PROPRIETÀ: un fondo della tavolozza dei riscontri
  // (`bg-red-50`, `bg-amber-50`, `bg-emerald-50`, anche con opacità) insieme al
  // bordo intonato. Le classi si estraggono da `className`, quindi l'ordine e
  // la spaziatura non contano, e nemmeno i rami di un ternario.
  //
  // Le eccezioni sono elencate una per una col loro perché. Un elenco corto e
  // motivato è una scelta; un elenco lungo sarebbe il difetto travestito da
  // test verde.
  // -------------------------------------------------------------------------

  /** Non sono riquadri di riscontro: la tavolozza qui vuol dire altro. */
  const NON_SONO_RISCONTRI: Record<string, string> = {
    'ui/badge.tsx': 'è il componente che DEFINISCE quella tavolozza',
    'settings/account-client.tsx': 'bordo di una scheda pericolosa, sempre presente',
    'settings/preset-copilot-panel.tsx': 'evidenzia le righe aggiunte in un confronto',
    'copilot/copilot-panel.tsx': 'pannello di registrazione in corso, con i suoi comandi',
    'results-table.tsx': 'tinta di riga e bordo di un pulsante, non un messaggio',
    'batch/wizard.tsx': 'riquadro con dentro un campo da scegliere, e un bordo di stato',
  };

  /** Le classi dichiarate in `className`, ovunque e comunque scritte. */
  function classi(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{[^}]*\})/g)) {
      if (m[1]) out.push(m[1]);
    }
    // I rami di un ternario sono stringhe a sé: si prendono tutte.
    for (const m of src.matchAll(/'([^']*(?:bg-(?:red|amber|emerald)-50)[^']*)'/g)) {
      out.push(m[1]!);
    }
    return out;
  }

  const TAVOLOZZA = /\bbg-(red|amber|emerald)-50(\/\d+)?\b/;
  const BORDO = /\bborder-(red|amber|emerald)-(200|300)\b/;

  it('nessun riquadro di riscontro resta scritto a mano', () => {
    const colpevoli = sorgenti
      .filter((f) => !f.path.endsWith('avviso.tsx'))
      .filter((f) => !Object.keys(NON_SONO_RISCONTRI).some((k) => f.path.endsWith(k)))
      .filter((f) => classi(f.src).some((c) => TAVOLOZZA.test(c) && BORDO.test(c)))
      .map((f) => f.path);
    expect(colpevoli, 'usa <Avviso>: porta il ruolo giusto e una spaziatura sola').toEqual([]);
  });

  it('le eccezioni sono poche e ognuna ha il suo perché', () => {
    // Il numero è il freno: se cresce, non è più un elenco di eccezioni — è il
    // difetto che sta tornando dalla porta di servizio.
    expect(Object.keys(NON_SONO_RISCONTRI).length).toBeLessThanOrEqual(8);
    for (const [file, perche] of Object.entries(NON_SONO_RISCONTRI)) {
      expect(perche.length, `«${file}» senza motivo scritto`).toBeGreaterThan(20);
    }
  });
});

describe('arrivare al contenuto', () => {
  it('c’è un «salta al contenuto», ed è la prima cosa che si incontra', () => {
    // Dieci tappe di Tab prima del contenuto, a ogni pagina.
    const layout = leggi('app/app/layout.tsx');
    expect(layout).toMatch(/href="#contenuto"/);
    expect(layout).toMatch(/id="contenuto"/);
    // Invisibile finché non riceve il fuoco: allora compare.
    expect(layout).toMatch(/sr-only focus:not-sr-only/);
    // Il bersaglio deve poter ricevere il fuoco, altrimenti il salto sposta la
    // vista ma non il punto di lettura.
    expect(layout).toMatch(/id="contenuto" tabIndex=\{-1\}/);
  });
});

describe('il testo si legge', () => {
  it('nessun testo a `gray-400`: è 2,4:1 sul nostro fondo', () => {
    // #9ca3af sul crema #fbf8f3 fa 2,4:1, contro un minimo di 4,5:1. Resta
    // legittimo sulle icone, che sono decorative.
    const ICONA = /aria-hidden|h-[23456] |w-[23456] |className="h-|<X |<Check|Icon|icon/;
    const colpevoli: string[] = [];
    for (const f of sorgenti) {
      for (const riga of f.src.split('\n')) {
        if (riga.includes('text-gray-400') && !ICONA.test(riga)) {
          colpevoli.push(`${f.path}: ${riga.trim().slice(0, 60)}`);
        }
      }
    }
    expect(colpevoli).toEqual([]);
  });
});

describe('lo stato non si affida al solo colore', () => {
  it('nella lista di completezza la spunta ce l’ha solo chi ha finito', () => {
    // L'icona era la stessa per «fatto» e «da fare», cambiava solo il colore:
    // con la configurazione appena iniziata si vedevano cinque spunte grigie
    // accanto al conteggio «0/5». Si contraddicono a vista — e chi non
    // distingue grigio da verde leggeva cinque cose fatte.
    const dash = leggi('app/app/page.tsx');
    expect(dash).toMatch(/item\.done \? <Check[^>]*\/> : <Circle/);
    // E detto anche a chi ascolta: l'icona è decorativa, lo stato no.
    expect(dash).toMatch(/item\.done \? 'Fatto:' : 'Da fare:'/);
  });

  it('una fonte non ancora disponibile non ha l’aria di una novità', () => {
    // «Novità» (fonte attiva), «In arrivo» e «Prossimamente» (fonti
    // disabilitate) portavano la STESSA pastiglia viola. Il viola dice «guarda
    // qui», e su una cosa che non si può cliccare è un invito a vuoto. Erano
    // anche due parole diverse per lo stesso stato, affiancate.
    const wizard = senzaCommenti(leggi('components/batch/wizard.tsx'));
    expect(wizard).toMatch(/card\.disabled \? \(\s*<Badge tone="gray">In arrivo<\/Badge>/);
    expect(wizard).not.toMatch(/Prossimamente/);
  });
});
