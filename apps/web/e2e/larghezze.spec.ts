import { test, expect, type Page } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario, type ScenarioSeminato } from './semina';

// ---------------------------------------------------------------------------
// La pagina non scorre di lato. Mai.
//
// È già successo tre volte, in tre punti diversi, e ogni volta con la stessa
// causa: un elemento con `truncate` dentro un flex o un grid senza `min-w-0`.
// La troncatura si VEDE — i puntini ci sono — ma la larghezza intrinseca
// continua a propagarsi verso l'alto, e la traccia della griglia si dimensiona
// sul testo intero.
//
// L'ultima volta il risultato era questo: su un telefono da 390px il documento
// pretendeva 768px. Non «un titolo che sborda»: 768 supera la soglia del layout
// desktop, quindi **il telefono riceveva il layout grande e ne vedeva metà**,
// con «Apri» e il cestino fuori schermo.
//
// Nessun test unitario può vederlo: serve un browser che disegni davvero, e
// serve che nell'elenco ci sia un nome lungo. Per questo il caso limite qui
// sotto è seminato apposta.
//
// Le larghezze provate sono quelle dove si rompe, non quelle comode: 320 è il
// telefono più piccolo ancora in giro, 360 l'Android diffuso, 390 l'iPhone,
// 768 il tablet in verticale — che è anche lo zoom al 200% su 1536.
// ---------------------------------------------------------------------------

const salta = motivoPerSaltare();
test.skip(salta !== null, salta ?? '');

const LARGHEZZE = [320, 360, 390, 768];

/** Un nome che nessuno scriverebbe per sbaglio, e che qualcuno scriverà. */
const NOME_LUNGO =
  'Listino conserve e sott’oli primavera-estate con etichette nuove e allergeni rivisti';

let utenteId: string | null = null;
let scenario: ScenarioSeminato;

test.beforeEach(async ({ context }, info) => {
  const utente = await creaUtenteDiProva(`lw${info.parallelIndex}`);
  utenteId = utente.id;
  await accedi(context, utente);
  scenario = await seminaScenario(utente.id);
});

test.afterEach(async () => {
  if (utenteId) await eliminaUtenteDiProva(utenteId);
  utenteId = null;
});

/**
 * Mette un nome lungo nel primo titolo di scheda.
 *
 * Il difetto vive nei dati: senza un nome lungo nell'elenco non si vede niente.
 * Si aspetta che la pagina abbia finito di muoversi, altrimenti l'iniezione
 * cade dentro una navigazione e il test fallisce per conto suo — come è
 * successo alla prima stesura.
 */
async function conNomeLungo(page: Page, rotta: string): Promise<void> {
  await page.goto(rotta, { waitUntil: 'networkidle' });
  await page.locator('h3').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.evaluate((nome) => {
    const h3 = document.querySelector('h3');
    if (h3) h3.textContent = nome;
  }, NOME_LUNGO);
  await page.waitForTimeout(200);
}

/** Quanto il documento pretende, oltre quello che lo schermo offre. */
async function sforo(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
}

/** Chi sta spingendo: serve per correggere, non solo per sapere che c'è. */
async function colpevoli(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((e) => !e.closest('nextjs-portal'))
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.right > limite + 1)
      .slice(0, 8)
      .map(
        ({ e, r }) =>
          `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} ` +
          `esce di ${Math.round(r.right - limite)}px — «${(e.textContent || '').trim().slice(0, 40)}»`,
      );
  });
}

test.describe('nessuna pagina scorre di lato', () => {
  for (const larghezza of LARGHEZZE) {
    // Il nome lungo si prova su `/app/batches` e non sulla dashboard: l'utente
    // di prova non ha completato l'onboarding, quindi `/app` lo rimanda alla
    // configurazione e non elenca nessun batch. La scheda però è la stessa
    // (`RecentBatchCard`), quindi il difetto verrebbe preso comunque.
    test(`l’elenco dei lavori regge un nome lungo a ${larghezza}px`, async ({ page }) => {
      await page.setViewportSize({ width: larghezza, height: 800 });
      await conNomeLungo(page, '/app/batches');

      const px = await sforo(page);
      expect(px, `sforo di ${px}px — ${(await colpevoli(page)).join(' | ')}`).toBeLessThanOrEqual(0);
    });

    test(`la configurazione non sfora a ${larghezza}px`, async ({ page }) => {
      // Le tabelle di preset e attributi scorrono dentro il loro contenitore:
      // quello che non deve succedere è che scorra la PAGINA.
      await page.setViewportSize({ width: larghezza, height: 800 });
      await page.goto('/app/settings/presets', { waitUntil: 'networkidle' });
      await page.waitForTimeout(200);

      const px = await sforo(page);
      expect(px, `sforo di ${px}px — ${(await colpevoli(page)).join(' | ')}`).toBeLessThanOrEqual(0);
    });

    test(`i risultati non sforano a ${larghezza}px`, async ({ page }) => {
      await page.setViewportSize({ width: larghezza, height: 800 });
      await page.goto(`/app/batches/${scenario.batchId}/results`);
      await page.waitForTimeout(300);

      const px = await sforo(page);
      expect(px, `sforo di ${px}px — ${(await colpevoli(page)).join(' | ')}`).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('l’intestazione non si accavalla', () => {
  // `scrollWidth` non basta.
  //
  // Il gruppo dei comandi ha `min-w-0`: quando lo spazio manca **si comprime
  // invece di spingere fuori la pagina**, quindi il documento resta largo
  // quanto lo schermo e i test di sforo restano verdi mentre due comandi
  // finiscono uno sopra l'altro. È successo aggiungendo il settimo comando:
  // a 320px il gruppo partiva da 9px e copriva il logo.
  for (const larghezza of LARGHEZZE) {
    test(`nessun comando ne copre un altro a ${larghezza}px`, async ({ page }) => {
      await page.setViewportSize({ width: larghezza, height: 800 });
      await page.goto('/app/batches', { waitUntil: 'networkidle' });
      await page.waitForTimeout(200);

      const sovrapposti = await page.evaluate(() => {
        const comandi = [...document.querySelectorAll('header a, header button')]
          // Un elemento che ne contiene un altro cliccabile è solo un
          // involucro: si accavalla col figlio per costruzione.
          .filter((e) => !e.querySelector('a,button'))
          .map((e) => ({
            nome: (e.getAttribute('aria-label') || e.textContent || '?').trim().slice(0, 20),
            r: e.getBoundingClientRect(),
          }))
          .filter(({ r }) => r.width > 0 && r.height > 0);

        const fuori: string[] = [];
        for (let i = 0; i < comandi.length; i++) {
          for (let j = i + 1; j < comandi.length; j++) {
            const a = comandi[i]!;
            const b = comandi[j]!;
            // Un pixel di tolleranza: i bordi arrotondati si sfiorano.
            const orizzontale = a.r.left < b.r.right - 1 && b.r.left < a.r.right - 1;
            const verticale = a.r.top < b.r.bottom - 1 && b.r.top < a.r.bottom - 1;
            if (orizzontale && verticale) fuori.push(`«${a.nome}» sotto «${b.nome}»`);
          }
        }
        return fuori;
      });

      expect(sovrapposti, 'comandi accavallati nell’intestazione').toEqual([]);
    });
  }
});

test.describe('i comandi di una riga si raggiungono sempre', () => {
  test('nei risultati la colonna azioni resta agganciata al bordo', async ({ page }) => {
    // La tabella è più larga del suo contenitore, e va bene: è una tabella di
    // dati. Quello che non va bene è che scorrendo spariscano i comandi per
    // agire sulla riga — prima «Rifiuta» e «Rigenera» erano invisibili a
    // QUALSIASI larghezza di schermo, perché il limite è il guscio, non il
    // monitor.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/app/batches/${scenario.batchId}/results`);
    await page.waitForTimeout(400);

    const visibilita = await page.evaluate(() => {
      const tab = document.querySelector('table');
      if (!tab) return null;
      let cont: HTMLElement | null = tab.parentElement;
      while (cont && getComputedStyle(cont).overflowX !== 'auto') cont = cont.parentElement;
      if (!cont) return null;
      const cr = cont.getBoundingClientRect();
      const cella = tab.querySelector('tbody tr:first-child td:last-child');
      if (!cella) return null;
      return [...cella.querySelectorAll('button, a')].map((b) => {
        const r = b.getBoundingClientRect();
        const dentro = Math.max(0, Math.min(r.right, cr.right) - Math.max(r.left, cr.left));
        return {
          nome: b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '?',
          quota: r.width > 0 ? dentro / r.width : 0,
        };
      });
    });

    expect(visibilita, 'nessuna tabella con righe nei risultati').not.toBeNull();
    for (const b of visibilita!) {
      expect(b.quota, `«${b.nome}» visibile solo al ${Math.round(b.quota * 100)}%`).toBeGreaterThan(
        0.99,
      );
    }
  });
});
