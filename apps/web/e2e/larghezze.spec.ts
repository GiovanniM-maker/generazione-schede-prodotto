import { test, expect, type Page } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario, type ScenarioSeminato } from './semina';

// ---------------------------------------------------------------------------
// La soglia dello sforo è UN pixel, non zero.
//
// Non è un ammorbidimento: è la risoluzione della misura. La stessa pagina,
// nello stesso stato, misura 0 px qui e 1 px sul runner di CI — cambia il
// motore di disegno dei caratteri, non il layout. L'ho verificato mettendo a
// confronto le due esecuzioni sulla pagina che falliva.
//
// I difetti per cui questi test esistono erano di 288 px e 768 px: due ordini
// di grandezza sopra. Tenere lo zero vorrebbe dire far dichiarare alla suite un
// difetto di prodotto dove c'è una differenza d'ambiente — cioè il modo più
// rapido per insegnare a ignorare il rosso, che è esattamente l'errore già
// scritto in `flow.spec.ts` (un test rimasto rosso per mesi).
// ---------------------------------------------------------------------------
const SFORO_TOLLERATO = 1;


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
      expect(px, `sforo di ${px}px — ${(await colpevoli(page)).join(' | ')}`).toBeLessThanOrEqual(SFORO_TOLLERATO);
    });

    // Tre pagine, non una.
    //
    // Questo test guardava solo `/app/settings/presets`, ed è per quello che
    // non ha visto niente quando `categories` e `attributes` hanno cominciato
    // a sforare di 147 px: hanno tre pulsanti in barra invece di due, e una
    // barra che non va a capo. Una sola pagina campione non copre una sezione.
    for (const rotta of [
      '/app/settings/presets',
      '/app/settings/categories',
      '/app/settings/attributes',
    ]) {
      test(`${rotta} non sfora a ${larghezza}px`, async ({ page }) => {
        // Le tabelle scorrono dentro il loro contenitore: quello che non deve
        // succedere è che scorra la PAGINA.
        await page.setViewportSize({ width: larghezza, height: 800 });
        await page.goto(rotta, { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);

        const px = await sforo(page);
        expect(px, `sforo di ${px}px — ${(await colpevoli(page)).join(' | ')}`).toBeLessThanOrEqual(SFORO_TOLLERATO);
      });
    }

    test(`i risultati non sforano a ${larghezza}px`, async ({ page }) => {
      await page.setViewportSize({ width: larghezza, height: 800 });
      await page.goto(`/app/batches/${scenario.batchId}/results`);
      await page.waitForTimeout(300);

      const px = await sforo(page);
      expect(px, `sforo di ${px}px — ${(await colpevoli(page)).join(' | ')}`).toBeLessThanOrEqual(SFORO_TOLLERATO);
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

test.describe('i dati respirano', () => {
  // ---------------------------------------------------------------------------
  // La tabella dei risultati vuole 1314 px. Ne riceveva 1102, perché il guscio
  // dell'app è fisso a `max-w-6xl` — e quel numero non dipende dallo schermo.
  // Misurato a 1280, 1440, 1920 e 2560: **scorreva di lato di 212 px a tutte e
  // quattro le larghezze**, identiche. Su un monitor da 2560 restavano 1408 px
  // di margine vuoto ai lati di una tabella che scorreva.
  //
  // E ogni cella misurata era troncata — sei su sei: nomi di prodotto,
  // titoli, descrizioni. Non «qualcuna a volte»: tutte.
  //
  // Questo test guarda la proprietà, non il numero: su uno schermo largo la
  // pagina dei dati deve prendersi più spazio della pagina di lettura accanto,
  // e la tabella deve starci dentro.
  // ---------------------------------------------------------------------------

  test('su uno schermo largo i risultati prendono più spazio di una pagina di lettura', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });

    await page.goto('/app/batches', { waitUntil: 'networkidle' });
    const lettura = await page.evaluate(() => document.querySelector('main')!.clientWidth);

    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const dati = await page.evaluate(() => document.querySelector('main')!.clientWidth);

    expect(dati, `i dati hanno ${dati}px, la lettura ${lettura}px`).toBeGreaterThan(lettura);

    // E l'intestazione si allarga con loro: un logo allineato a 1152 sopra una
    // tabella che parte da 1600 sono due colonne di lettura invece di una.
    const scarto = await page.evaluate(() => {
      const barra = document.querySelector('header > div')!.getBoundingClientRect();
      const contenuto = document.querySelector('main')!.getBoundingClientRect();
      return Math.abs(barra.left - contenuto.left);
    });
    expect(scarto, `intestazione e contenuto disallineati di ${scarto}px`).toBeLessThanOrEqual(2);
  });

  test('a 1920 la tabella dei risultati ci sta, senza scorrere e senza troncare', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const m = await page.evaluate(() => {
      const tab = document.querySelector('table');
      if (!tab) return null;
      const scatola = tab.parentElement as HTMLElement;
      const troncate: string[] = [];
      for (const td of document.querySelectorAll('tbody td')) {
        const e = td as HTMLElement;
        if (e.scrollWidth > e.clientWidth + 1) {
          troncate.push(`«${(e.textContent || '').trim().slice(0, 24)}» ${e.clientWidth}<${e.scrollWidth}`);
        }
      }
      return { diLato: scatola.scrollWidth - scatola.clientWidth, troncate };
    });

    expect(m, 'nessuna tabella nei risultati').not.toBeNull();
    // Qui resta ZERO: non è lo sforo del documento, è il riquadro della
    // tabella, e a 1920 la misura è esatta perché la tabella ci sta dentro
    // con margine. La tolleranza di sopra vale per la larghezza del
    // documento, dove il carattere disegnato cambia da una macchina all'altra.
    expect(m!.diLato, `la tabella scorre ancora di ${m!.diLato}px`).toBeLessThanOrEqual(0);
    expect(m!.troncate, 'celle troncate con lo spazio disponibile').toEqual([]);
  });

  test('le intestazioni di colonna non se ne vanno con lo scorrimento', async ({ page }) => {
    // Sulla pagina degli attributi, arrivati a metà, la testa stava a −516 px e
    // sotto restavano 1878 px di righe: si leggeva una colonna di valori senza
    // sapere di quale colonna si trattasse. E in una schermata di
    // configurazione le colonne si somigliano tutte.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/settings/attributes', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const prima = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
    if (prima < 12) test.skip();

    // Si scorre DENTRO il riquadro della tabella, che è chi scorre davvero.
    const stato = await page.evaluate(async () => {
      const tab = document.querySelector('table')!;
      const scatola = tab.parentElement as HTMLElement;
      scatola.scrollTop = scatola.scrollHeight;
      await new Promise((r) => setTimeout(r, 150));
      const th = tab.querySelector('thead th')!.getBoundingClientRect();
      const sr = scatola.getBoundingClientRect();
      return {
        scorso: scatola.scrollTop,
        restaSotto: scatola.scrollHeight - scatola.clientHeight - scatola.scrollTop,
        testaDentro: th.top >= sr.top - 2 && th.bottom <= sr.bottom + 2,
      };
    });

    expect(stato.scorso, 'il riquadro della tabella non scorre').toBeGreaterThan(100);
    expect(stato.testaDentro, 'le intestazioni sono uscite dal riquadro').toBe(true);
  });
});
