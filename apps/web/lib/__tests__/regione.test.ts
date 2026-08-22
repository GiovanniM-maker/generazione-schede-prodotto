import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Le funzioni girano dove sta il database.
//
// PERCHÉ ESISTE QUESTA PROVA
//
// Il 22 agosto 2026, in produzione, i numeri erano questi:
//
//     Time to First Byte   1,22 s  (media)   ← quanto ci mette a rispondere
//     Active CPU             51 ms (media)   ← quanto ci mette a lavorare
//
// Su 1,22 secondi, 51 millisecondi erano lavoro. Tutto il resto era ATTESA, e
// la causa stava scritta accanto: le funzioni giravano a `iad1` — Washington —
// e Supabase sta in `eu-west-1`, Irlanda. Ogni singola andata e ritorno verso
// il database attraversava l'Atlantico, e una pagina ne fa da sei a nove in
// fila.
//
// La prova più netta era nella tabella delle rotte: `/login`, l'unica pagina
// che non interroga il database, rispondeva in 34 ms. `/app` in 2,42 secondi.
// Stesso server, stessa build: la differenza era solo quante volte
// attraversava l'oceano.
//
// COSA PROTEGGE
//
// `vercel.json` è un file che si tocca di rado e si legge poco: una `regions`
// cancellata per sbaglio in un conflitto non la nota nessuno, e il prodotto
// tornerebbe lento senza che nulla si rompa — che è il modo peggiore di
// regredire. Qui la regione delle funzioni resta legata a quella del database,
// e se le due si separano questa prova diventa rossa.
// ---------------------------------------------------------------------------

/** Dove sta il progetto Supabase di produzione. */
const REGIONE_DATABASE = 'eu-west-1';

/**
 * Le regioni Vercel che stanno in Irlanda o abbastanza vicino.
 *
 * `dub1` è Dublino, cioè lo stesso data center di `eu-west-1`: è la scelta
 * giusta. Le altre due sono europee e restano accettabili — venti o trenta
 * millisecondi invece di due — ma non sono la stessa cosa, e chi le sceglie
 * dovrebbe saperlo.
 */
const REGIONI_AMMESSE = ['dub1', 'fra1', 'arn1'];

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'apps/web/vercel.json'), 'utf8'),
) as { regions?: string[] };

describe('la regione delle funzioni', () => {
  it('è dichiarata', () => {
    // Senza la chiave, Vercel usa la sua predefinita — `iad1`, Washington — e
    // il difetto non si manifesta come un errore: si manifesta come un secondo
    // di attesa in più su ogni pagina.
    expect(config.regions, 'vercel.json senza «regions»: le funzioni finirebbero a Washington').toBeDefined();
    expect(config.regions?.length).toBeGreaterThan(0);
  });

  it('sta accanto al database, non dall’altra parte dell’oceano', () => {
    for (const r of config.regions ?? []) {
      expect(
        REGIONI_AMMESSE,
        `la regione «${r}» non è in Europa, e il database sta in ${REGIONE_DATABASE}`,
      ).toContain(r);
    }
  });

  it('il cron resta configurato', () => {
    // Aggiungere `regions` vuol dire riscrivere questo file: la prova sta qui
    // perché la modifica che ci ha portati non deve portarsi via altro.
    const completo = JSON.parse(
      readFileSync(join(process.cwd(), 'apps/web/vercel.json'), 'utf8'),
    ) as { crons?: Array<{ path: string; schedule: string }> };
    expect(completo.crons?.some((c) => c.path === '/api/cron/drain')).toBe(true);
  });
});
