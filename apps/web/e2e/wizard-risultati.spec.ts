import { test, expect, type Page } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario, type ScenarioSeminato } from './semina';

// ---------------------------------------------------------------------------
// Le due pagine costruite alla cieca: il wizard e i risultati.
//
// Erano fuori portata perche' arrivarci richiede un'organizzazione configurata,
// un batch e delle schede generate. Invece di percorrere sette passi di
// onboarding e aspettare l'AI a ogni test, lo stato si semina direttamente
// (vedi semina.ts) e il browser guarda le pagine che contano.
//
// Qui si verifica cio' che i test unitari non possono vedere: che la tabella
// diventi davvero un elenco di schede sul telefono, che nulla scorra di lato,
// che i comandi si possano toccare.
// ---------------------------------------------------------------------------

const salta = motivoPerSaltare();
test.skip(salta !== null, salta ?? '');

let utenteId: string | null = null;
let scenario: ScenarioSeminato;

test.beforeEach(async ({ context }, info) => {
  // Un utente per worker: i profili desktop e telefono girano in parallelo.
  const utente = await creaUtenteDiProva(`w${info.parallelIndex}`);
  utenteId = utente.id;
  await accedi(context, utente);
  scenario = await seminaScenario(utente.id);
});

test.afterEach(async () => {
  if (utenteId) await eliminaUtenteDiProva(utenteId);
  utenteId = null;
});

/** Il banner cookie copre il fondo pagina: va tolto prima di misurare. */
async function chiudiBanner(page: Page) {
  await page
    .getByRole('button', { name: /ho capito/i })
    .click({ timeout: 3000 })
    .catch(() => undefined);
}

/** Comandi sotto la soglia di tocco, esclusi gli involucri e l'overlay di Next. */
async function comandiTroppoPiccoli(page: Page) {
  return page.evaluate(() => {
    const selettore = 'a,button,input,select,textarea,[role="button"]';
    const out: string[] = [];
    for (const el of document.querySelectorAll(selettore)) {
      if (el.closest('nextjs-portal') || el.querySelector(selettore)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 24 || r.width < 24) {
        out.push(`${el.tagName.toLowerCase()}«${(el.textContent || '').trim().slice(0, 24)}» ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return [...new Set(out)];
  });
}

// ---------------------------------------------------------------------------

test.describe('risultati', () => {
  test('mostra le schede generate del batch', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /risultati/i })).toBeVisible();
    for (const sku of scenario.sku) {
      // Lo SKU compare due volte nel DOM: nella scheda per telefono e nella
      // riga della tabella. Una delle due e' sempre nascosta, quindi si cerca
      // quella VISIBILE — non la prima che capita.
      await expect(page.getByText(sku, { exact: false }).filter({ visible: true }).first()).toBeVisible();
    }
  });

  test('offre l’export nei formati previsti', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /^csv$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^xlsx$/i })).toBeVisible();
  });

  test('nessun errore JavaScript', async ({ page }) => {
    const errori: string[] = [];
    page.on('pageerror', (e) => errori.push(e.message));
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    expect(errori).toEqual([]);
  });

  test('non scorre in orizzontale', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    const eccesso = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(eccesso).toBeLessThanOrEqual(0);
  });

  test('ogni comando si può toccare (24px)', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    expect(await comandiTroppoPiccoli(page)).toEqual([]);
  });
});

test.describe('risultati su telefono', () => {
  test.skip(({ isMobile }) => !isMobile, 'solo sul profilo telefono');

  test('la tabella lascia il posto a un elenco di schede', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    // Una tabella a otto colonne su 390px si legge solo trascinandola di lato:
    // per questo su telefono viene sostituita da una scheda per prodotto.
    const tabellaVisibile = await page.evaluate(() => {
      const t = document.querySelector('table');
      if (!t) return false;
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    expect(tabellaVisibile).toBe(false);
    // E i prodotti ci sono comunque.
    await expect(
      page.getByText(scenario.sku[0]!, { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test('ogni scheda porta con sé le sue azioni', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    const rivedi = page.getByRole('button', { name: /rivedi/i });
    expect(await rivedi.count()).toBeGreaterThanOrEqual(scenario.sku.length);
    await expect(rivedi.first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('wizard nuovo batch', () => {
  test('si apre al primo passo', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /nuovo batch/i })).toBeVisible();
    await expect(page.getByText(/passo 1 di/i)).toBeVisible();
  });

  test('nessun errore JavaScript', async ({ page }) => {
    const errori: string[] = [];
    page.on('pageerror', (e) => errori.push(e.message));
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    expect(errori).toEqual([]);
  });

  test('non scorre in orizzontale', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    const eccesso = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(eccesso).toBeLessThanOrEqual(0);
  });

  test('il preset seminato compare fra quelli scegliibili', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await expect(page.getByText(/preset food/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('il pulsante per proseguire è raggiungibile senza cercarlo', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    const avanti = page.getByRole('button', { name: /crea e continua/i });
    await expect(avanti).toBeVisible();
    // Su telefono la barra e' fissa in basso: deve stare dentro lo schermo
    // senza scorrere. Prima scorreva via in fondo alla pagina.
    const box = await avanti.boundingBox();
    const altezza = page.viewportSize()!.height;
    expect(box!.y).toBeLessThan(altezza);
  });
});
