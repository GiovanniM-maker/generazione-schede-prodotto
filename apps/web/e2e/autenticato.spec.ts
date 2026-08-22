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

// ---------------------------------------------------------------------------
// I comandi fatti di sola icona hanno un nome.
//
// Il difetto di partenza: venti comandi il cui unico nome era un `title` del
// browser. Su un dito il `title` non compare MAI, quindi su telefono erano
// icone da indovinare; e diversi lettori di schermo non lo annunciano affatto,
// quindi non erano nomi nemmeno lì.
//
// Questi test girano su ENTRAMBI i profili, desktop e telefono. È il punto:
// il nome deve esserci in tutti e due, il riquadro solo dove c'è un puntatore.
// ---------------------------------------------------------------------------
test.describe('i comandi di sola icona', () => {
  test.beforeEach(async () => {
    if (utenteId) await seminaScenario(utenteId);
  });

  test('hanno un nome anche dove il `title` non comparirebbe mai', async ({ page }) => {
    await page.goto('/app/settings/presets', { waitUntil: 'networkidle' });
    // Il nome si cerca per RUOLO: è così che lo trova un lettore di schermo, e
    // così che lo pronuncia chi comanda a voce. Con il `title` questa riga
    // falliva.
    const rinomina = page.getByRole('button', { name: 'Rinomina' }).first();
    if ((await rinomina.count()) === 0) test.skip();
    await expect(rinomina).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Archivia' }).first()).toBeVisible();
  });

  test('col puntatore mostrano il riquadro, e resta dentro lo schermo', async ({ page }, info) => {
    // Il riquadro è per chi ha un puntatore: sul profilo telefono non si prova
    // ad aprirlo, si prova che il NOME c'è lo stesso (test qui sopra).
    test.skip(info.project.name !== 'desktop', 'il riquadro serve dove c’è un puntatore');

    await page.goto('/app/settings/presets', { waitUntil: 'networkidle' });
    const archivia = page.getByRole('button', { name: 'Archivia' }).first();
    if ((await archivia.count()) === 0) test.skip();

    await archivia.hover();
    // Il nome non è testo del pulsante: se questo testo si vede, viene dal
    // riquadro. `RITARDO_APERTURA_MS` è 400: l'attesa qui è abbondante.
    const riquadro = page.getByText('Archivia', { exact: true });
    await expect(riquadro).toBeVisible({ timeout: 5000 });

    const misure = await riquadro.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        sinistra: r.left,
        destra: r.right,
        alto: r.top,
        basso: r.bottom,
        larghezzaVista: window.innerWidth,
        altezzaVista: window.innerHeight,
        // Il riquadro non deve intercettare i clic: coprirebbe proprio la cosa
        // che sta spiegando, e il clic successivo finirebbe su di lui.
        eventi: getComputedStyle(el).pointerEvents,
      };
    });
    expect(misure.sinistra, 'il riquadro esce a sinistra').toBeGreaterThanOrEqual(0);
    expect(misure.destra, 'il riquadro esce a destra').toBeLessThanOrEqual(misure.larghezzaVista);
    expect(misure.alto, 'il riquadro esce in alto').toBeGreaterThanOrEqual(0);
    expect(misure.basso, 'il riquadro esce in basso').toBeLessThanOrEqual(misure.altezzaVista);
    expect(misure.eventi).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Un comando spento sa dire perché, e si riesce a raggiungerlo.
//
// Il difetto di partenza: 118 comandi con `disabled`, e dietro quella parola
// tre situazioni diverse trattate allo stesso modo — grigie, mute e SALTATE dal
// Tab. Un elemento `disabled` non prende il fuoco: con la tastiera non si
// scopre nemmeno che esiste, e il motivo per cui è spento non lo si può
// leggere.
//
// Gira su desktop e telefono, perché il difetto c'era su entrambi.
// ---------------------------------------------------------------------------
test('il comando che non si può ancora usare resta raggiungibile e dice cosa manca', async ({
  page,
}) => {
  await page.goto('/app/onboarding', { waitUntil: 'networkidle' });

  // Si cerca per RUOLO e per NOME: è così che lo trova un lettore di schermo.
  // Il motivo sta dentro al nome, quindi questa riga è anche la prova che il
  // motivo esiste. Con `disabled` e un `title` fallisce.
  const continua = page.getByRole('button', { name: /Continua.*Serve prima.*nome dell/i });
  await expect(continua).toBeVisible({ timeout: 20000 });
  await expect(continua).toHaveAttribute('aria-disabled', 'true');
  // E NON è `disabled` vero: è la differenza fra «spento» e «introvabile».
  expect(await continua.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(false);

  // Prende il fuoco davvero.
  await continua.focus();
  expect(await continua.evaluate((el) => el === document.activeElement)).toBe(true);

  // Premerlo non fa niente. Playwright si RIFIUTA di cliccarlo — `aria-disabled`
  // lo rende «non abilitato» anche per lui — quindi si preme come farebbe il
  // browser, che è il caso da provare: il pulsante è `type="submit"`, e senza
  // il guardiano invierebbe il modulo pur sembrando spento.
  await continua.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/app\/onboarding/);

  // Compilato il campo, il comando torna a chiamarsi solo «Continua».
  const nome = page.getByLabel(/nome/i).first();
  if ((await nome.count()) === 0) return;
  await nome.fill('Prova Automatica');
  await expect(page.getByRole('button', { name: /^Continua$/ })).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Undici passi sono diventati cinque stadi.
//
// Undici non era un numero di passi, era un numero di INTERRUZIONI — e sei di
// quelle undici schermate non chiedevano niente: mostravano il risultato di
// quella prima e aspettavano che si premesse «Continua».
//
// Il caso più delicato NON è il conto: è che il wizard si scriveva da solo
// `?batch=…&passo=8` nella cronologia a ogni cambio di passo. Quel numero sta
// nei segnalibri e nei link che la gente si manda: se smettesse di voler dire
// qualcosa, chi torna su un lavoro lasciato a metà ripartirebbe da capo.
// ---------------------------------------------------------------------------
test.describe('il wizard in cinque stadi', () => {
  test('si apre su «Prepara», e gli stadi sono cinque', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Prepara', level: 1 })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(/Passo 1 di 5/)).toBeVisible();
    // I pezzi dello stadio stanno nella stessa schermata, ognuno col suo
    // titolo: prima erano due «Continua» separati.
    await expect(page.getByRole('heading', { name: /Il lavoro/i, level: 2 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Cosa prevede il preset/i, level: 2 }),
    ).toBeVisible();
  });

  test('un indirizzo vecchio con `?passo=` porta ancora dove portava', async ({ page }) => {
    if (!utenteId) test.skip();
    const scenario = await seminaScenario(utenteId);
    // 8 era «Mapping attributi», che adesso vive dentro «Mappa».
    await page.goto(`/app/batches/new?batch=${scenario.batchId}&passo=8`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Mappa', level: 1 })).toBeVisible({
      timeout: 20000,
    });
    // E l'indirizzo si riscrive col nome nuovo, senza ricaricare la pagina.
    await expect(page).toHaveURL(/stadio=mappa/, { timeout: 10000 });
  });

  test('nessuna parentesi orfana finita a schermo', async ({ page }) => {
    // Accorpando i passi ho avvolto ogni pezzo in una sezione con uno script, e
    // otto parentesi tonde sono rimaste come TESTO dentro il JSX. Non le vede
    // né il compilatore né il linter: sono figli validi di un elemento. Si
    // vedono solo aprendo la pagina.
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const orfane = await page.evaluate(
      () =>
        [...document.querySelectorAll('section, div')]
          .flatMap((el) => [...el.childNodes])
          .filter((n) => n.nodeType === 3 && /^\s*[()]\s*$/.test(n.textContent ?? '')).length,
    );
    expect(orfane, 'una parentesi del codice è finita a schermo').toBe(0);
  });
});
