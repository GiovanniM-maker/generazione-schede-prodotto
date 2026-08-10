import { test, expect } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';

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
  await page.getByRole('button', { name: /ho capito/i }).click({ timeout: 3000 }).catch(() => {});

  await page.getByLabel(/nome azienda/i).fill('Cascina Verde S.r.l.');
  await page.getByLabel(/nome brand/i).fill('Cascina Verde');
  await page.getByRole('button', { name: /continua/i }).click();

  await expect(page.getByText(/passaggio 2 di 7/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: /qual è il tuo settore/i })).toBeVisible();
});

test('la scelta del settore porta alle sue categorie, non a quelle di un altro', async ({ page }) => {
  await page.goto('/app/onboarding', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /ho capito/i }).click({ timeout: 3000 }).catch(() => {});
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
  await page.getByRole('button', { name: /ho capito/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByLabel(/nome azienda/i).fill('Cascina Verde S.r.l.');
  await page.getByRole('button', { name: /continua/i }).click();
  await expect(page.getByText(/passaggio 2 di 7/i)).toBeVisible({ timeout: 15000 });
  expect(errori).toEqual([]);
});
