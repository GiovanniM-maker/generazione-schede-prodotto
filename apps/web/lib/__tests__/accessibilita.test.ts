import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('nessun riquadro rosso resta scritto a mano', () => {
    // Erano trenta, con quattro spaziature diverse e nessun ruolo.
    const colpevoli = sorgenti
      .filter((f) => !f.path.endsWith('avviso.tsx'))
      .filter((f) => /<div className="rounded-lg border border-red-200 bg-red-50[^"]*">/.test(f.src))
      .map((f) => f.path);
    expect(colpevoli).toEqual([]);
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
