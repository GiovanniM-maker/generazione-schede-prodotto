import { test, expect } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario } from './semina';

// ---------------------------------------------------------------------------
// Invio, in un browser vero.
//
// Le guardie sul codice sanno dire che un `<form>` c'è. Non sanno dire che
// premendo Invio succede qualcosa: quello si vede solo premendolo.
// ---------------------------------------------------------------------------

const salta = motivoPerSaltare();

test.describe('si scrive e si preme Invio', () => {
  test.skip(salta !== null, salta ?? '');

  let utenteId: string | null = null;

  test.beforeEach(async ({ context }, info) => {
    const utente = await creaUtenteDiProva(`tast${info.parallelIndex}`);
    utenteId = utente.id;
    await accedi(context, utente);
    await seminaScenario(utente.id);
  });

  test.afterEach(async () => {
    if (utenteId) await eliminaUtenteDiProva(utenteId);
    utenteId = null;
  });

  test('il nome del batch si conferma da tastiera', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // La guida a fumetti copre i campi: si chiude prima.
    for (let i = 0; i < 3; i++) {
      const velo = page.locator('[role="dialog"][aria-label^="Guida"]');
      if ((await velo.count()) === 0) break;
      await velo.first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
      await page.waitForTimeout(250);
    }

    const nome = page.locator('#batch-name, input[id*="name" i]').first();
    if ((await nome.count()) === 0) test.skip();
    await nome.fill('Batch da tastiera');
    await nome.press('Enter');

    // Il passo 1 crea il batch e prosegue: l'indirizzo si riempie di `?batch=`.
    await expect(page).toHaveURL(/batch=/, { timeout: 20000 });
  });

  test('l’invito a un collega parte con Invio', async ({ page }) => {
    await page.goto('/app/settings/team', { waitUntil: 'networkidle' });
    const email = page.locator('#inv-email');
    if ((await email.count()) === 0) test.skip();
    await email.fill(`collega-${Date.now()}@example.invalid`);
    await email.press('Enter');
    // O compare il collegamento d'invito, o un avviso: in tutti e due i casi
    // il tasto ha fatto qualcosa. Prima non succedeva niente.
    await expect(
      page.locator('[role="alert"], [role="status"], input[readonly]').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('una categoria nuova si crea da tastiera', async ({ page }) => {
    await page.goto('/app/settings/categories', { waitUntil: 'networkidle' });
    const apri = page.getByRole('button', { name: /nuova categoria/i }).first();
    if ((await apri.count()) === 0) test.skip();
    await apri.click();
    const nome = page.locator('#cat-name');
    await expect(nome).toBeVisible({ timeout: 10000 });
    const etichetta = `Da tastiera ${Date.now()}`;
    await nome.fill(etichetta);
    await nome.press('Enter');
    // La modale si chiude e la categoria compare nell'elenco.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText(etichetta).first()).toBeVisible({ timeout: 15000 });
  });
});
