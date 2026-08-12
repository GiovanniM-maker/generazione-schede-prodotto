import { test, expect } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario, seminaOrganizzazioneNuda, type ScenarioSeminato } from './semina';

// ---------------------------------------------------------------------------
// Da ogni pagina si esce.
//
// Sei revisioni indipendenti nel browser hanno trovato la stessa forma di
// difetto in quattro punti diversi: una pagina che si può raggiungere e da cui
// non si può proseguire. Non sono schianti — la pagina si disegna, i test
// unitari sono verdi — è che l'unica strada avanti non c'è.
//
//   · l'elenco «Tutti i lavori» esisteva, ma il solo collegamento compariva
//     sopra i dieci batch: con cinque, ci si arrivava solo a memoria;
//   · qualunque indirizzo sbagliato finiva sul 404 di Next, in inglese e
//     senza un link;
//   · «Torna ai tuoi lavori» apriva la dashboard;
//   · la pagina di avanzamento non aveva NESSUN collegamento finché il lavoro
//     non finiva;
//   · su un'organizzazione nuova il velo della guida copriva l'unico
//     collegamento utile del wizard.
//
// Un vicolo cieco non si vede leggendo il codice di una pagina sola: si vede
// provando ad andarsene. Per questo i test qui sotto CLICCANO e guardano dove
// finiscono, invece di controllare che un href esista.
// ---------------------------------------------------------------------------

const salta = motivoPerSaltare();
test.skip(salta !== null, salta ?? '');

let utenteId: string | null = null;

test.afterEach(async () => {
  if (utenteId) await eliminaUtenteDiProva(utenteId);
  utenteId = null;
});

test.describe('con un catalogo già configurato', () => {
  let scenario: ScenarioSeminato;

  test.beforeEach(async ({ context }, info) => {
    const utente = await creaUtenteDiProva(`vu${info.parallelIndex}`);
    utenteId = utente.id;
    await accedi(context, utente);
    scenario = await seminaScenario(utente.id);
  });

  test('l’elenco dei lavori si raggiunge dall’intestazione, da qualunque pagina', async ({
    page,
  }) => {
    // Da una pagina di configurazione: è il punto in cui si finiva senza più
    // sapere come tornare ai propri batch.
    await page.goto('/app/settings/presets', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Lavori', exact: true }).click();
    await page.waitForURL(/\/app\/batches$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /tutti i lavori/i })).toBeVisible();
  });

  test('un indirizzo che non esiste offre una via d’uscita, in italiano', async ({ page }) => {
    const risposta = await page.goto('/app/una-pagina-che-non-esiste', {
      waitUntil: 'networkidle',
    });
    expect(risposta?.status()).toBe(404);

    const corpo = (await page.locator('body').innerText()).toLowerCase();
    expect(corpo).not.toContain('this page could not be found');

    // Non «c'è un link»: ci si clicca sopra e si guarda dove si arriva.
    await page.getByRole('link', { name: /vai ai tuoi lavori/i }).click();
    await page.waitForURL(/\/app\/batches$/, { timeout: 15000 });
  });

  test('«Torna ai tuoi lavori» porta ai lavori, non alla dashboard', async ({ page }) => {
    // Una rotta che ESISTE, con un batch che non esiste: è il caso che porta
    // al 404 curato dei batch. L'indirizzo nudo `/app/batches/<id>` non è una
    // rotta del prodotto e finisce sul 404 generale — provato, e sarebbe stato
    // un test che misura un'altra pagina.
    await page.goto('/app/batches/00000000-0000-4000-8000-000000000000/results', {
      waitUntil: 'networkidle',
    });
    await page.getByRole('link', { name: /torna ai tuoi lavori/i }).click();
    await page.waitForURL(/\/app\/batches$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /tutti i lavori/i })).toBeVisible();
  });

  test('dalla pagina di avanzamento si esce anche mentre il lavoro gira', async ({ page }) => {
    await page.goto(`/app/batches/${scenario.batchId}/processing`, {
      waitUntil: 'networkidle',
    });
    // Il collegamento dentro il contenuto, non quello dell'intestazione:
    // l'intestazione c'è ovunque, il punto era che QUESTA pagina non ne aveva
    // nessuno.
    await page.locator('main').getByRole('link', { name: /tutti i lavori/i }).click();
    await page.waitForURL(/\/app\/batches$/, { timeout: 15000 });
  });
});

test.describe('su un’organizzazione appena creata', () => {
  test.beforeEach(async ({ context }, info) => {
    const utente = await creaUtenteDiProva(`vn${info.parallelIndex}`);
    utenteId = utente.id;
    await accedi(context, utente);
    await seminaOrganizzazioneNuda(utente.id);
  });

  test('la guida non copre il collegamento che sblocca il wizard', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });

    // Il riquadro che spiega il blocco vero.
    await expect(page.getByText(/nessun preset pubblicato/i)).toBeVisible({ timeout: 20000 });

    // `click()` fallisce da solo se qualcosa sta davanti: prima andava in
    // timeout perché il velo della guida a fumetti prendeva il colpo.
    await page
      .getByRole('link', { name: /vai alle impostazioni preset/i })
      .click({ timeout: 10000 });
    // Attesa generosa: in sviluppo la rotta di destinazione viene compilata al
    // primo accesso, e la prima volta ci mette più di quindici secondi. Il
    // fallimento che ne usciva sembrava un difetto del prodotto.
    await page.waitForURL(/\/app\/settings\/presets/, { timeout: 45000 });
  });
});
