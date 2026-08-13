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

  test('il banner cookie non copre le modali', async ({ page }) => {
    // Il banner è `fixed` e stava a `z-50`, cioè alla stessa quota delle
    // modali — ma reso DOPO nel documento, quindi vinceva lui. Copriva anche i
    // cassetti dei risultati (z-40) e del preset (z-40). Alla prima visita, su
    // telefono, non si riusciva a creare un attributo senza prima accettare i
    // cookie: il banner è arredamento di pagina, e stava sopra il lavoro.
    //
    // Il consenso sta in `localStorage`, non nei cookie: cancellare i cookie
    // qui butterebbe via la sessione e basta — il primo tentativo è finito
    // proprio così, sulla pagina di accesso, ad aspettare per un minuto un
    // pulsante che stava dietro un login.
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('cookie-consent-v1');
      } catch {
        /* private mode */
      }
    });
    await page.setViewportSize(TELEFONO);
    await page.goto('/app/settings/categories', { waitUntil: 'networkidle' });

    const banner = page.getByRole('region', { name: /avviso cookie/i });
    if ((await banner.count()) === 0) test.skip();

    const apri = page.getByRole('button', { name: /nuova categoria/i }).first();
    await apri.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 15000 });

    // Il confronto NON si fa col riquadro bianco della modale: su un telefono
    // quello sta in alto e il banner in fondo, quindi non si toccano quasi mai
    // e la verifica passerebbe per assenza di bersaglio. Il primo tentativo di
    // questo test faceva esattamente così — verde, e non guardava niente.
    //
    // Il bersaglio giusto è la **velatura**, che è `fixed inset-0`: copre tutto
    // lo schermo, quindi copre sempre anche il banner. Se col dito sul banner
    // si tocca il banner invece della velatura, allora il banner sta davanti a
    // una modale aperta — che è il difetto, ed è quello che si vedeva: il
    // rettangolo bianco del banner bucava lo schermo scurito.
    const davanti = await page.evaluate(() => {
      const b = document.querySelector('[aria-label="Avviso cookie"]') as HTMLElement | null;
      const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
      const velo = d?.parentElement as HTMLElement | null;
      if (!b || !velo) return 'manca un pezzo';
      const rb = b.getBoundingClientRect();
      const rv = velo.getBoundingClientRect();
      if (rv.bottom <= rb.top || rv.top >= rb.bottom) return 'la velatura non copre il banner';
      const el = document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2);
      return b.contains(el) ? 'banner' : 'velatura';
    });
    expect(davanti, 'con la modale aperta il banner cookie resta cliccabile').toBe('velatura');
  });

  test('ogni comando si prende col dito, anche dentro l’applicazione', async ({ page }) => {
    // La soglia WCAG 2.2 AA è 24×24. Il controllo esisteva solo per le pagine
    // pubbliche, e dentro l'applicazione restavano «Cosa significa?» e «Chiudi
    // la guida» a 20×20, il pulsante di chiusura delle modali esattamente a 24
    // — cioè sul filo, che non è un margine — e «Modifica preset» alto 17 px,
    // perché un collegamento di testo è alto quanto il testo.
    await page.setViewportSize(TELEFONO);
    for (const rotta of ['/app/batches/new', '/app/settings/presets', '/app/settings/team']) {
      await page.goto(rotta, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const piccoli = await page.evaluate(() => {
        const out: string[] = [];
        for (const b of document.querySelectorAll('button, a')) {
          const el = b as HTMLElement;
          if (el.closest('nextjs-portal') || el.querySelector('button,a')) continue;
          const s = getComputedStyle(el);
          // `sr-only`: ritagliato a 1×1 finché non riceve il fuoco.
          if (s.clipPath !== 'none' || s.clip !== 'auto') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 24 || r.height < 24) {
            out.push(
              `${el.getAttribute('aria-label') ?? (el.textContent || '').trim().slice(0, 22)} ` +
                `${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        }
        return [...new Set(out)];
      });
      expect(piccoli, `comandi sotto i 24px su ${rotta}`).toEqual([]);
    }
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
