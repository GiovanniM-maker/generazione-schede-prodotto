import { test, expect } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario } from './semina';

// ---------------------------------------------------------------------------
// La fonte «Lista SKU», nel browser.
//
// Qui la ricerca NON è configurata — in CI non c'è nessuna chiave — e il
// fornitore finto non inventa risultati. Quindi questa prova verifica una cosa
// precisa e che vale: che il percorso arrivi fino in fondo e dica la verità.
// Nessun prodotto importato, e il motivo scritto a schermo.
//
// Se un giorno questa prova cominciasse a vedere prodotti importati senza che
// nessuno abbia messo una chiave, vorrebbe dire che qualcuno ha insegnato al
// finto a inventare pagine — ed è il difetto peggiore che questa funzione
// possa avere.
// ---------------------------------------------------------------------------

const salta = motivoPerSaltare();

test.describe('fonte Lista SKU', () => {
  test.skip(salta !== null, salta ?? '');

  let utenteId: string | null = null;

  test.beforeEach(async ({ context }, info) => {
    const utente = await creaUtenteDiProva(`sku${info.parallelIndex}`);
    utenteId = utente.id;
    await accedi(context, utente);
    await seminaScenario(utente.id);
    await context.addInitScript(() => {
      try {
        for (let i = 1; i <= 11; i++) localStorage.setItem(`tour.wizard.${i}.v1`, '1');
      } catch {
        /* se lo storage non funziona, restano i fumetti */
      }
    });
  });

  test.afterEach(async () => {
    if (utenteId) await eliminaUtenteDiProva(utenteId);
    utenteId = null;
  });

  test('si sceglie come fonte, e dice il vero quando la ricerca non è configurata', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });

    await expect(page.getByRole('button', { name: /Preset/i }).first()).toBeVisible({ timeout: 20000 });
    await page.locator('#batch-name').fill('Lista SKU');
    await page.getByRole('button', { name: /crea e continua/i }).click();
    await expect(page).toHaveURL(/batch=/, { timeout: 20000 });

    await page.getByRole('button', { name: /^continua$/i }).first().click();
    await expect(page.getByText(/scegli da dove arrivano i dati/i)).toBeVisible({ timeout: 15000 });

    // La scheda esiste e non è «In arrivo».
    const scheda = page.getByRole('button', { name: /^Lista SKU/ });
    await expect(scheda).toBeEnabled();
    await scheda.click();

    const campo = page.locator('#sku-list');
    await expect(campo).toBeVisible({ timeout: 10000 });
    await campo.fill('SED-AUR-01\nSED-AUR-02\nSED-AUR-03');

    // L'anteprima dei costi compare dove si decide, non altrove.
    await campo.blur();
    await expect(page.getByText(/3 codici →/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/crediti di generazione/)).toBeVisible();

    // Il caricamento da file: le colonne si riconoscono da sole, e l'anteprima
    // si rifà sui numeri del foglio invece che su quelli incollati.
    await campo.fill('');
    await page.getByTestId('sku-file').setInputFiles({
      name: 'codici.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'SKU,Modello,Marca\nTS100-RED,TS100,Ferrini\nTS100-BLU,TS100,Ferrini\nTS100-NER,TS100,Ferrini\nPL200-RED,PL200,Ferrini\n',
        'utf8',
      ),
    });

    await expect(page.getByText(/4 righe lette/)).toBeVisible({ timeout: 20000 });
    // La colonna dei codici è stata riconosciuta: senza, non ci sarebbe niente
    // da cercare e il pulsante resterebbe spento.
    await expect(page.locator('#sku-col-sku')).toHaveValue('SKU');
    await expect(page.locator('#sku-col-marca')).toHaveValue('Marca');
    // Col codice modello dichiarato non si indovina niente: quattro codici, due
    // prodotti — TS100 con tre varianti e PL200 da solo.
    await expect(page.getByText(/4 codici → 2 prodotti/)).toBeVisible({ timeout: 20000 });

    // Il pulsante della scheda, non quello della barra in fondo: fanno la
    // stessa cosa e portano la stessa scritta, come per le fonti URL e PDF.
    await page.locator('[data-tour="sku-import"]').click();

    // E dice cosa è successo davvero: nessuna pagina trovata. Non «fatto».
    await expect(page.getByText(/Nessun prodotto importato/i)).toBeVisible({ timeout: 60000 });
  });
});
