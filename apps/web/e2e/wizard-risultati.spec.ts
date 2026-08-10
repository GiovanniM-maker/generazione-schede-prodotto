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

  test('offre l’export nei formati previsti', async ({ page, isMobile }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    // Su telefono l'export sta nella barra strumenti, che parte chiusa.
    if (isMobile) await page.getByRole('button', { name: /cerca, filtra ed esporta/i }).click();
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


test.describe('risultati · vista lettura', () => {
  test('si può scegliere fra tabella e lettura', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('radio', { name: /tabella/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /lettura/i })).toBeVisible();
    // Si parte dalla tabella: e' la vista che c'era prima, nessuno viene spostato.
    await expect(page.getByRole('radio', { name: /tabella/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('in lettura il testo non è troncato e la tabella sparisce', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('radio', { name: /lettura/i }).click();

    const tabellaVisibile = await page.evaluate(() => {
      const t = document.querySelector('table');
      if (!t) return false;
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    expect(tabellaVisibile).toBe(false);

    // I titoli sono interi: nella tabella erano tagliati a meta'.
    await expect(
      page.getByRole('heading', { name: /pomodori pelati san marzano 220 g/i }),
    ).toBeVisible();
  });

  test('«Leggi tutto» apre descrizione lunga e domande frequenti', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('radio', { name: /lettura/i }).click();

    const apri = page.getByRole('button', { name: /leggi tutto/i }).first();
    await expect(apri).toHaveAttribute('aria-expanded', 'false');
    await apri.click();
    await expect(page.getByText(/domande frequenti/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /mostra meno/i }).first()).toBeVisible();
  });

  test('la scelta della vista resta al ricaricamento', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('radio', { name: /lettura/i }).click();
    await page.reload({ waitUntil: 'networkidle' });
    // E' una preferenza: sceglierla a ogni visita sarebbe una seccatura.
    await expect(page.getByRole('radio', { name: /lettura/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('ogni scheda conserva le sue azioni', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('radio', { name: /lettura/i }).click();
    for (const azione of [/rivedi/i, /accetta/i, /rifiuta/i, /rigenera/i]) {
      expect(await page.getByRole('button', { name: azione }).count()).toBeGreaterThanOrEqual(
        scenario.sku.length,
      );
    }
  });

  test('non scorre in orizzontale e i comandi si toccano', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('radio', { name: /lettura/i }).click();
    const eccesso = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(eccesso).toBeLessThanOrEqual(0);
    expect(await comandiTroppoPiccoli(page)).toEqual([]);
  });

  test('la scheda mostra la foto del prodotto', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('radio', { name: /lettura/i }).click();

    // Rivedere una scheda guardando il prodotto e' un'altra cosa che leggere
    // solo le parole: la foto caricata dev'essere nella scheda.
    const foto = page.getByRole('link', { name: new RegExp(`apri la foto di`, 'i') });
    expect(await foto.count()).toBeGreaterThanOrEqual(scenario.sku.length);
    // Si apre a grandezza intera in una scheda nuova.
    await expect(foto.first()).toHaveAttribute('target', '_blank');
  });

  test('la foto ha un testo alternativo, non un alt vuoto', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('radio', { name: /lettura/i }).click();
    const alt = await page
      .locator('article img')
      .first()
      .getAttribute('alt');
    expect((alt ?? '').trim().length).toBeGreaterThan(0);
  });
});

test.describe('risultati · barra strumenti su telefono', () => {
  test.skip(({ isMobile }) => !isMobile, 'solo sul profilo telefono');

  test('la barra parte chiusa e le schede si vedono subito', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    const apri = page.getByRole('button', { name: /cerca, filtra ed esporta/i });
    await expect(apri).toBeVisible();
    await expect(apri).toHaveAttribute('aria-expanded', 'false');
    // Ricerca, export e filtri occupavano mezzo schermo prima dei prodotti.
    await expect(page.getByRole('textbox', { name: /^cerca$/i })).toBeHidden();
    await expect(page.getByRole('button', { name: /^csv$/i })).toBeHidden();
  });

  test('aprendola compaiono ricerca, export e filtri', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await page.getByRole('button', { name: /cerca, filtra ed esporta/i }).click();
    await expect(page.getByRole('textbox', { name: /^cerca$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^csv$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^tutti/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /cerca, filtra ed esporta/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  test('la scelta della vista resta sempre a portata', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    // Passare a "Lettura" non deve costare un'apertura di menu: e' la ragione
    // per cui il selettore sta fuori dalla barra collassabile.
    await expect(page.getByRole('radio', { name: /lettura/i })).toBeVisible();
  });
});

test.describe('risultati · barra strumenti su schermo grande', () => {
  test.skip(({ isMobile }) => isMobile === true, 'solo sul profilo desktop');

  test('la barra è aperta senza doverla chiedere', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/results`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    // Da tablet in su lo spazio c'e': nascondere gli strumenti sarebbe un passo
    // in piu' per niente.
    await expect(page.getByRole('textbox', { name: /^cerca$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^csv$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cerca, filtra ed esporta/i })).toBeHidden();
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
