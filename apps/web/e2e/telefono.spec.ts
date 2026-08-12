import { test, expect, type Page } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario, type ScenarioSeminato } from './semina';

// ---------------------------------------------------------------------------
// Quello che si rompe solo su un telefono.
//
// Non sono difetti «di stile»: sono difetti che rendono il prodotto scomodo o
// inutilizzabile proprio dove viene usato di più. E nessuno di loro si vede a
// desktop, che è dove li ho scritti.
//
//   · un menu che si prende metà della prima schermata, su tutte e nove le
//     pagine della configurazione;
//   · una modale che copre la pagina ma la lascia scorrere sotto, così
//     chiudendola ci si ritrova altrove;
//   · un banner appoggiato sopra i link legali — compreso quello che il banner
//     stesso cita;
//   · un'etichetta che esce dalla pillola del pulsante, bianca su fondo crema.
//
// Le misure qui sotto sono quelle dell'audit, rifatte: 390×844 è l'iPhone
// diffuso, 360 l'Android.
// ---------------------------------------------------------------------------

const TELEFONO = { width: 390, height: 844 };

/** Comandi il cui testo non ci sta dentro: esce sopra, sotto o di lato. */
async function comandiChePerdonoIlTesto(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const b of document.querySelectorAll('button, a[class*="rounded"]')) {
      if (b.closest('nextjs-portal')) continue;
      const el = b as HTMLElement;
      if (el.offsetHeight === 0) continue;
      // Il «salta al contenuto» è `sr-only`: ritagliato a 1×1 finché non
      // riceve il fuoco, quindi «contiene più di quanto misura» per
      // costruzione. Misurarlo qui è un falso allarme — è il terzo strumento
      // in cui inciampa, ed è sempre lo stesso elemento.
      const stile = getComputedStyle(el);
      if (stile.clipPath !== 'none' || stile.clip !== 'auto') continue;
      // Un'altezza fissa (h-8/h-10/h-11) non cresce con una seconda riga: il
      // testo esce dalla pillola invece di allargarla.
      const sfora = el.scrollHeight > el.offsetHeight + 1 || el.scrollWidth > el.offsetWidth + 1;
      if (sfora) {
        out.push(
          `«${(el.textContent || '').trim().slice(0, 28)}» ${el.offsetWidth}x${el.offsetHeight} ` +
            `contiene ${el.scrollWidth}x${el.scrollHeight}`,
        );
      }
    }
    return [...new Set(out)];
  });
}

test.describe('pagine pubbliche', () => {
  test('il banner cookie non copre i link legali', async ({ page }) => {
    // Il banner è `fixed`: non occupa posto nel flusso, quindi arrivati in
    // fondo si appoggiava sopra «Privacy · Termini · Cookie» — compreso il
    // collegamento alla Cookie Policy **che il banner stesso cita**. Per
    // leggerlo bisognava accettare: decidere prima di poter leggere.
    await page.setViewportSize(TELEFONO);
    await page.goto('/', { waitUntil: 'networkidle' });

    const banner = page.getByRole('region', { name: /avviso cookie/i });
    if ((await banner.count()) === 0) test.skip();

    // Due volte: il banner si fa spazio in un effetto, cioè dopo il primo
    // disegno. Scorrendo una volta sola si arriva al fondo di *prima*.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
    }

    const coperti = await page.evaluate(() => {
      const b = document.querySelector('[aria-label="Avviso cookie"]');
      const piede = document.querySelector('footer');
      if (!b || !piede) return null;
      const rb = b.getBoundingClientRect();
      return [...piede.querySelectorAll('a')]
        .filter((a) => {
          const r = a.getBoundingClientRect();
          return r.top < rb.bottom && r.bottom > rb.top && r.left < rb.right && r.right > rb.left;
        })
        .map((a) => (a.textContent || '').trim());
    });

    expect(coperti, 'il banner copre dei collegamenti del piede').toEqual([]);
  });

  test('nessun comando perde il testo fuori dalla propria pillola', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const rotta of ['/', '/login', '/privacy']) {
      await page.goto(rotta, { waitUntil: 'networkidle' });
      expect(await comandiChePerdonoIlTesto(page), rotta).toEqual([]);
    }
  });
});

const salta = motivoPerSaltare();

test.describe('dentro l’applicazione', () => {
  test.skip(salta !== null, salta ?? '');

  let utenteId: string | null = null;
  let scenario: ScenarioSeminato;

  test.beforeEach(async ({ context }, info) => {
    const utente = await creaUtenteDiProva(`tel${info.parallelIndex}`);
    utenteId = utente.id;
    await accedi(context, utente);
    scenario = await seminaScenario(utente.id);
  });

  test.afterEach(async () => {
    if (utenteId) await eliminaUtenteDiProva(utenteId);
    utenteId = null;
  });

  test('la configurazione non spende mezza schermata in menu', async ({ page }) => {
    // Era una colonna di 358×344 px, `position: static`, senza modo di
    // chiuderla: il titolo della pagina cominciava al **56% dell'altezza dello
    // schermo**, su tutte e nove le pagine.
    await page.setViewportSize(TELEFONO);
    await page.goto('/app/settings/presets', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const quota = await page.evaluate(() => {
      const h1 = document.querySelector('main h1');
      if (!h1) return null;
      return h1.getBoundingClientRect().top / window.innerHeight;
    });
    expect(quota, 'nessun <h1> nella pagina di configurazione').not.toBeNull();
    expect(
      quota!,
      `il titolo comincia al ${Math.round(quota! * 100)}% dello schermo`,
    ).toBeLessThan(0.4);
  });

  test('tutte le voci della configurazione restano raggiungibili', async ({ page }) => {
    // Comprimere il menu è utile finché non nasconde delle destinazioni: la
    // striscia scorre, non taglia.
    await page.setViewportSize(TELEFONO);
    await page.goto('/app/settings/presets', { waitUntil: 'networkidle' });
    const nav = page.getByRole('navigation', { name: /configurazione catalogo/i });
    for (const voce of ['Preset', 'Categorie', 'Attributi', 'Settori', 'Storico', 'Team', 'Account']) {
      await expect(nav.getByRole('link', { name: voce, exact: true })).toHaveCount(1);
    }
  });

  test('con una modale aperta la pagina sotto non scorre', async ({ page }) => {
    // Una rotellata, o una passata di pollice sulla velatura, e il contenuto
    // coperto scivolava via di 1200 px: chiudendo la modale ci si ritrovava in
    // un punto della pagina che non si era scelto.
    await page.setViewportSize(TELEFONO);
    await page.goto('/app/settings/categories', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const apri = page.getByRole('button', { name: /nuova categoria|aggiungi/i }).first();
    if ((await apri.count()) === 0) test.skip();
    await apri.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });

    const bloccato = await page.evaluate(() => getComputedStyle(document.body).overflow);
    expect(bloccato, 'la pagina sotto la modale scorre ancora').toBe('hidden');

    // E alla chiusura torna com'era: una pagina che resta bloccata è peggio.
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    const dopo = await page.evaluate(() => getComputedStyle(document.body).overflow);
    expect(dopo, 'la pagina resta bloccata dopo la chiusura').not.toBe('hidden');
  });

  test('nei risultati nessun comando perde il testo', async ({ page }) => {
    // «Accetta selezionati (1)» a 360 px: il pulsante misurava 32 px di altezza
    // con dentro 46 px di testo, che usciva sopra e sotto la pillola rossa —
    // bianco su fondo crema.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const casella = page.locator('input[type="checkbox"]').first();
    if (await casella.count()) await casella.check().catch(() => {});
    await page.waitForTimeout(300);

    expect(await comandiChePerdonoIlTesto(page)).toEqual([]);
  });

  test('la barra dei comandi del wizard non è traslucida', async ({ page }) => {
    // Il 5% di trasparenza più la sfocatura non nascondono il testo sotto: lo
    // rendono illeggibile ma visibile.
    await page.setViewportSize(TELEFONO);
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const barra = await page.evaluate(() => {
      const d = [...document.querySelectorAll('div')].find(
        (x) => getComputedStyle(x).position === 'sticky' && x.querySelector('button'),
      );
      if (!d) return null;
      const s = getComputedStyle(d);
      return { sfondo: s.backgroundColor, filtro: s.backdropFilter };
    });
    expect(barra, 'nessuna barra dei comandi trovata').not.toBeNull();
    // `rgb(...)` senza canale alfa = opaca. `rgba(..., 0.95)` no.
    expect(barra!.sfondo, `fondo ${barra!.sfondo}`).toMatch(/^rgb\(/);
  });
});
