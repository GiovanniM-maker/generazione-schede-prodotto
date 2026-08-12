import { test, expect } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario } from './semina';

// ---------------------------------------------------------------------------
// I flussi che richiedono di essere dentro l'app.
//
// Sono quelli costruiti alla cieca: onboarding, wizard, risultati. Fino a oggi
// l'unico modo per sapere se funzionavano era che qualcuno li usasse e se ne
// lamentasse. Qui li apre un browser.
//
// Si saltano da soli se manca la chiave di servizio o QA_ALLOW_WRITES=1:
// creano un utente vero sul database configurato, e non deve succedere per
// sbaglio. Vedi il commento in sessione.ts.
// ---------------------------------------------------------------------------

const salta = motivoPerSaltare();
test.skip(salta !== null, salta ?? '');

let utenteId: string | null = null;

test.beforeEach(async ({ context }, info) => {
  // Un utente per worker: i profili desktop e telefono girano in parallelo.
  const utente = await creaUtenteDiProva(`w${info.parallelIndex}`);
  utenteId = utente.id;
  await accedi(context, utente);
});

test.afterEach(async () => {
  if (utenteId) await eliminaUtenteDiProva(utenteId);
  utenteId = null;
});

test('un utente nuovo viene portato all’onboarding, non a una pagina vuota', async ({ page }) => {
  await page.goto('/app');
  // Il reindirizzamento passa dal middleware: si aspetta l'URL, non si legge
  // subito. Leggerlo appena dopo `goto` rendeva il test intermittente.
  await page.waitForURL(/\/app\/onboarding/, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: /benvenuto/i })).toBeVisible();
});

test('l’app si chiama con il suo nome, ovunque', async ({ page }) => {
  await page.goto('/app/onboarding', { waitUntil: 'networkidle' });
  const testo = (await page.locator('body').innerText()).toLowerCase();
  // Il prodotto si e' chiamato "Schede AI" e "Schede Prodotto" prima di
  // diventare "Verificato": i residui del nome vecchio sono la prima cosa che
  // vede un utente nuovo.
  expect(testo).not.toContain('schede ai');
  expect(testo).not.toMatch(/benvenuto in schede prodotto/);
});

test('l’intestazione mostra la navigazione e il logo alla misura giusta', async ({ page }) => {
  await page.goto('/app/onboarding', { waitUntil: 'networkidle' });
  const logo = page.locator('header svg').first();
  const box = await logo.boundingBox();
  // Un'icona senza vincolo di dimensione si prende tutta la pagina: e'
  // successo davvero, con un CSS non caricato.
  expect(box!.width).toBeLessThan(80);
  expect(box!.height).toBeLessThan(80);
  await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
});

test('il primo passo dell’onboarding accetta i dati dell’azienda', async ({ page }) => {
  await page.goto('/app/onboarding', { waitUntil: 'networkidle' });
  await page.getByRole('region', { name: /avviso cookie/i }).getByRole('button', { name: /ho capito/i }).click({ timeout: 3000 }).catch(() => {});

  await page.getByLabel(/nome azienda/i).fill('Cascina Verde S.r.l.');
  await page.getByLabel(/nome brand/i).fill('Cascina Verde');
  await page.getByRole('button', { name: /continua/i }).click();

  await expect(page.getByText(/passaggio 2 di 7/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: /qual è il tuo settore/i })).toBeVisible();
});

test('la scelta del settore porta alle sue categorie, non a quelle di un altro', async ({ page }) => {
  await page.goto('/app/onboarding', { waitUntil: 'networkidle' });
  await page.getByRole('region', { name: /avviso cookie/i }).getByRole('button', { name: /ho capito/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByLabel(/nome azienda/i).fill('Cascina Verde S.r.l.');
  await page.getByRole('button', { name: /continua/i }).click();
  await expect(page.getByText(/passaggio 2 di 7/i)).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: /food/i }).first().click();
  await page.getByRole('button', { name: /continua/i }).click();

  await expect(page.getByText(/passaggio 3 di 7/i)).toBeVisible({ timeout: 15000 });
  const categorie = (await page.locator('body').innerText()).toLowerCase();
  expect(categorie).toContain('conserve');
  // Nessuna categoria di un altro settore in mezzo.
  expect(categorie).not.toContain('taglia');
});

test('nessun errore JavaScript durante l’onboarding', async ({ page }) => {
  const errori: string[] = [];
  page.on('pageerror', (e) => errori.push(e.message));
  await page.goto('/app/onboarding', { waitUntil: 'networkidle' });
  await page.getByRole('region', { name: /avviso cookie/i }).getByRole('button', { name: /ho capito/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByLabel(/nome azienda/i).fill('Cascina Verde S.r.l.');
  await page.getByRole('button', { name: /continua/i }).click();
  await expect(page.getByText(/passaggio 2 di 7/i)).toBeVisible({ timeout: 15000 });
  expect(errori).toEqual([]);
});

test.describe('con un catalogo configurato', () => {
  // L'utente del `beforeEach` sopra non ha un'organizzazione: `/app/settings`
  // lo rimanda all'onboarding, e i test che vivono lì si saltano da soli senza
  // dire niente. Qui se ne semina una.
  test.beforeEach(async () => {
    if (utenteId) await seminaScenario(utenteId);
  });

  test('l’errore di una modale si vede dentro la modale', async ({ page }) => {
    // Era il difetto che avevo archiviato come «non riprodotto»: l'avviso viene
    // reso nel corpo della pagina, la modale è `fixed inset-0`, quindi il
    // messaggio finiva DIETRO la velatura. Riprovato con più pazienza, si
    // riproduce: premendo «Crea» senza nome la modale resta aperta, l'avviso
    // esiste con `role="alert"` — e nel suo punto centrale l'elemento davanti è
    // il velo. Chi guarda non vede succedere niente e ripreme.
    //
    // Chi usa un lettore di schermo lo sentiva comunque: uno dei rari casi in cui
    // era informato meglio di chi lo schermo lo guarda.
    await page.goto('/app/settings/categories', { waitUntil: 'networkidle' });
    const apri = page.getByRole('button', { name: /nuova categoria/i }).first();
    if ((await apri.count()) === 0) test.skip();
    await apri.click();

    const modale = page.locator('[role="dialog"]');
    await expect(modale).toBeVisible({ timeout: 15000 });
    await modale.getByRole('button', { name: /^crea$/i }).click();

    // L'avviso deve comparire DENTRO la modale…
    const dentro = modale.getByRole('alert');
    await expect(dentro).toBeVisible({ timeout: 15000 });
    await expect(dentro).toContainText(/obbligatorio/i);

    // …e non deve essercene una seconda copia coperta dal velo: due `role=alert`
    // identici vengono annunciati due volte.
    //
    // Si contano le copie di QUESTO messaggio, non gli `alert` della pagina:
    // l'overlay di sviluppo di Next ne tiene uno vuoto in fondo al body, e
    // contando quello il test falliva solo sul profilo telefono — cioè per una
    // ragione che col prodotto non c'entra niente.
    await expect(page.getByRole('alert').filter({ hasText: /obbligatorio/i })).toHaveCount(1);

    // Nessuno gli sta davanti: è la prova che vale, perché un elemento «visibile»
    // per Playwright può comunque stare sotto una velatura.
    const scoperto = await page.evaluate(() => {
      const a = [...document.querySelectorAll('[role="alert"]')].find((x) =>
        /obbligatorio/i.test(x.textContent || ''),
      );
      if (!a) return false;
      const r = a.getBoundingClientRect();
      const sopra = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!sopra && (a === sopra || a.contains(sopra));
    });
    expect(scoperto, 'l’avviso è coperto da qualcosa').toBe(true);
  });
});
