import { test, expect, type Page } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario, type ScenarioSeminato } from './semina';

// ---------------------------------------------------------------------------
// La soglia dello sforo è UN pixel, non zero.
//
// Non è un ammorbidimento: è la risoluzione della misura. La stessa pagina,
// nello stesso stato, misura 0 px qui e 1 px sul runner di CI — cambia il
// motore di disegno dei caratteri, non il layout. L'ho verificato mettendo a
// confronto le due esecuzioni sulla pagina che falliva.
//
// I difetti per cui questi test esistono erano di 288 px e 768 px: due ordini
// di grandezza sopra. Tenere lo zero vorrebbe dire far dichiarare alla suite un
// difetto di prodotto dove c'è una differenza d'ambiente — cioè il modo più
// rapido per insegnare a ignorare il rosso, che è esattamente l'errore già
// scritto in `flow.spec.ts` (un test rimasto rosso per mesi).
// ---------------------------------------------------------------------------
const SFORO_TOLLERATO = 1;


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

/**
 * Il banner cookie copre il fondo pagina: va tolto prima di misurare.
 *
 * Si cerca DENTRO il suo riquadro: il fumetto della guida dice «Ho capito» con
 * le stesse parole, e prendere il primo che capita chiudeva quello sbagliato
 * lasciando il banner a intercettare i clic.
 */
async function chiudiBanner(page: Page) {
  // Il banner si monta dopo l'idratazione: cercarlo subito significa non
  // trovarlo e ritrovarselo un attimo dopo sopra al pulsante principale.
  const banner = page.getByRole('region', { name: /avviso cookie/i });
  await banner.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
  await banner
    .getByRole('button', { name: /ho capito/i })
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await banner.waitFor({ state: 'detached', timeout: 4000 }).catch(() => undefined);
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
      // Il «salta al contenuto» è invisibile finché non riceve il fuoco, e
      // quando è invisibile misura 1×1: è il modo standard di nasconderlo
      // (`sr-only` ritaglia, non spegne). Misurarlo come bersaglio da toccare
      // è sbagliato — nessun dito lo troverà mai lì — e faceva fallire due
      // test da quando il collegamento è stato aggiunto. Chi lo raggiunge lo
      // raggiunge col Tab, e allora è grande.
      if (getComputedStyle(el).clipPath !== 'none' || getComputedStyle(el).clip !== 'auto') continue;
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
    expect(eccesso).toBeLessThanOrEqual(SFORO_TOLLERATO);
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
    expect(eccesso).toBeLessThanOrEqual(SFORO_TOLLERATO);
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
    // «Passo 1», non «Passo 1 di N».
    //
    // Quanti passi ci sono dipende da come si caricano i prodotti — file,
    // foto, URL — e finché la fonte non è scelta il totale non si sa. Il
    // wizard tace invece di inventarne uno, ed è la scelta giusta: era il test
    // a chiedere un numero che il prodotto ha smesso di promettere.
    await expect(page.getByText(/passo 1\b/i).first()).toBeVisible();
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
    expect(eccesso).toBeLessThanOrEqual(SFORO_TOLLERATO);
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

test.describe('fatturazione', () => {
  test('non dichiara acquisti simulati quando non lo sono', async ({ page }) => {
    await page.goto('/app/billing', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /pacchetti di crediti/i })).toBeVisible();
    // La frase «l'acquisto è simulato: i crediti vengono accreditati senza
    // addebito reale» era scritta fissa. In produzione sarebbe rimasta a
    // schermo nel punto esatto in cui si incassa — e ENABLE_MOCK_BILLING non
    // può nemmeno essere true in produzione, quindi era falsa per costruzione.
    const testo = (await page.locator('body').innerText()) ?? '';
    expect(testo).not.toMatch(/acquisto è simulato/i);
    expect(testo).not.toMatch(/senza addebito reale/i);
  });

  test('il saldo dice da dove vengono i crediti e quando scadono', async ({ page }) => {
    // Un utente appena creato ha i dieci crediti di prova, che scadono fra
    // trenta giorni. Prima qui c'era un numero solo — «10 crediti» — e le due
    // domande che uno si fa davvero (da dove vengono, quando se ne vanno) non
    // avevano risposta da nessuna parte nel prodotto.
    await page.goto('/app/billing', { waitUntil: 'networkidle' });
    const testo = await page.locator('main').innerText();

    expect(testo, 'il saldo non dice la provenienza dei crediti').toMatch(/Prova gratuita/i);
    expect(testo, 'nessuna data di scadenza accanto ai crediti').toMatch(/scade il \d{1,2} \w+ \d{4}/i);
    expect(testo, 'i crediti in scadenza non sono segnalati').toMatch(/crediti scadono entro 30 giorni/i);
  });

  test('lo stato dell’assistente è a schermo, e dice che è compreso', async ({ page }) => {
    // La regola nuova è che l'assistente NON si paga due volte. Se il prodotto
    // non lo dice, per il cliente la regola non esiste.
    await page.goto('/app/billing', { waitUntil: 'networkidle' });
    const testo = await page.locator('main').innerText();
    expect(testo).toMatch(/L’assistente è compreso/i);
    expect(testo).toMatch(/100 richieste/);
  });

  test('la cronologia non parla inglese', async ({ page }) => {
    // I tipi di movimento sono chiavi tecniche (`welcome`, `subscription_grant`,
    // `expiry`): finché qualcuno non le traduce, finiscono a schermo così.
    await page.goto('/app/billing', { waitUntil: 'networkidle' });
    const testo = await page.locator('main').innerText();
    for (const chiave of ['welcome', 'purchase', 'subscription_grant', 'expiry', 'admin_adjustment']) {
      expect(testo, `«${chiave}» è finito a schermo senza traduzione`).not.toContain(chiave);
    }
    expect(testo).toMatch(/Benvenuto/);
  });
});

test.describe('wizard · non perde il lavoro', () => {
  // Questi percorrono il wizard davvero: creano un batch e ricaricano.
  test.setTimeout(120_000);

  /** Il velo della guida copre i pulsanti: un clic lo chiude. */
  async function chiudiGuida(page: Page) {
    for (let i = 0; i < 4; i++) {
      const velo = page.locator('[role="dialog"][aria-label^="Guida"]');
      if ((await velo.count()) === 0) break;
      await velo.first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  test('il ricaricamento non riporta al primo passo', async ({ page }) => {
    // Era il difetto trovato da tre revisioni su sei: F5 al passo 4 riportava
    // al passo 1 e il batch creato restava irraggiungibile nel database.
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await chiudiGuida(page);

    await page.locator('#batch-name').fill('Batch che sopravvive a F5');
    await chiudiGuida(page);
    // Il preset si sceglie da solo appena l'elenco arriva: prima di allora il
    // pulsante è disabilitato, ed è giusto così.
    const avanti = page.getByRole('button', { name: /crea e continua/i });
    await expect(avanti).toBeEnabled({ timeout: 20000 });
    // La guida va chiusa DOPO che il pulsante è pronto: il fumetto compare
    // quando il passo ha finito di caricare, quindi prima sarebbe troppo presto.
    await chiudiGuida(page);
    await avanti.click();
    await expect(page.getByText(/passo 2\b/i).first()).toBeVisible({ timeout: 15000 });

    // L'indirizzo porta con sé dove siamo: è quello che rende possibile tornare.
    await expect(page).toHaveURL(/\?batch=[0-9a-f-]{36}&passo=2/i);

    await page.reload({ waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await expect(page.getByText(/passo 2\b/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('un batch riaperto ritrova il suo nome', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await chiudiGuida(page);
    await page.locator('#batch-name').fill('Catalogo da ritrovare');
    await chiudiGuida(page);
    const avanti = page.getByRole('button', { name: /crea e continua/i });
    await expect(avanti).toBeEnabled({ timeout: 20000 });
    await chiudiGuida(page);
    await avanti.click();
    await expect(page.getByText(/passo 2\b/i).first()).toBeVisible({ timeout: 15000 });
    // L'indirizzo si aggiorna dopo il render: aspettarlo invece di leggerlo
    // subito, altrimenti si legge quello di prima.
    await expect(page).toHaveURL(/\?batch=[0-9a-f-]{36}/i, { timeout: 10000 });

    const url = new URL(page.url());
    const id = url.searchParams.get('batch');
    expect(id).toBeTruthy();

    // Si riapre al passo 1, come farebbe chi torna dalla dashboard.
    await page.goto(`/app/batches/new?batch=${id}&passo=1`, { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    await expect(page.locator('#batch-name')).toHaveValue('Catalogo da ritrovare', { timeout: 15000 });
  });

  test('la guida si chiude con un clic invece di rubarlo', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });
    await chiudiBanner(page);
    const velo = page.locator('[role="dialog"][aria-label^="Guida"]');
    if ((await velo.count()) === 0) test.skip();
    // Prima un clic fuori dal fumetto FACEVA AVANZARE la guida: su undici passi,
    // ognuno col suo fumetto, era un clic sprecato a ogni passo.
    await velo.first().click({ position: { x: 5, y: 5 }, force: true });
    await expect(velo).toHaveCount(0, { timeout: 5000 });
  });
});

test.describe('larghezze intermedie', () => {
  // I test provavano 390 e 1280: il difetto stava esattamente in mezzo.
  // Fra 640 e 928px le etichette dell'intestazione comparivano ma non
  // entravano, e il documento scorreva di lato fino a 288px spingendo «Esci»
  // fuori schermo. È la fascia del tablet in verticale E dello zoom al 200% su
  // 1440 — cioè di chi ha bisogno di ingrandire per leggere.
  test.skip(({ isMobile }) => isMobile === true, 'il profilo telefono è già coperto');

  for (const larghezza of [320, 640, 700, 800, 928, 1024]) {
    test(`la dashboard non scorre di lato a ${larghezza}px`, async ({ page }) => {
      await page.setViewportSize({ width: larghezza, height: 900 });
      await page.goto('/app', { waitUntil: 'networkidle' });
      await chiudiBanner(page);
      const eccesso = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(eccesso, `a ${larghezza}px la pagina scorre di ${eccesso}px`).toBeLessThanOrEqual(SFORO_TOLLERATO);
    });
  }

  test('a 800px l’uscita resta dentro lo schermo', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto('/app', { waitUntil: 'networkidle' });
    const esci = page.getByRole('button', { name: /esci/i }).first();
    await expect(esci).toBeVisible();
    const box = await esci.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(800);
  });
});

test.describe('chiedere aiuto', () => {
  // Dentro /app c'erano quattro link in tutto e la parola «supporto» non
  // compariva mai: chi si blocca a metà di un import non aveva modo di
  // chiedere niente a nessuno. Privacy e termini erano raggiungibili solo
  // uscendo dall'applicazione.

  test('il piede offre un contatto, o tace', async ({ page }) => {
    await page.goto('/app', { waitUntil: 'networkidle' });
    const piede = page.getByRole('contentinfo');
    await expect(piede).toBeVisible();
    const testo = await piede.innerText();

    // Questo test diceva: «o c'è un indirizzo, o si dice apertamente che non è
    // configurato». La seconda metà era una decisione mia, e si è rivelata
    // sbagliata: «Contatto di assistenza non ancora configurato», in fondo a
    // ogni schermata, è stato letto come un guasto del prodotto da tre
    // revisioni su sei. È un messaggio nostro, su una cosa che il cliente non
    // può sistemare — e ora vive nella pagina «Servizio», dove lo legge chi
    // può.
    //
    // Quello che resta vero, e che questo test difende, sono due cose: al
    // cliente non si racconta cosa manca a noi, e non gli si offre mai un
    // recapito che non porta da nessuna parte.
    expect(testo, 'il piede racconta al cliente una nostra mancanza').not.toMatch(
      /non ancora configurat|non configurat/i,
    );

    const mail = piede.locator('a[href^="mailto:"]');
    if ((await mail.count()) > 0) {
      expect(testo).toMatch(/serve aiuto\?/i);
      const href = await mail.first().getAttribute('href');
      // `mailto:` seguito da niente, o da un indirizzo senza chiocciola, è il
      // link che non porta da nessuna parte.
      expect(href, `recapito non scrivibile: ${href}`).toMatch(/^mailto:[^@\s]+@[^@\s]+/);
    }
  });

  test('le pagine legali si raggiungono senza uscire', async ({ page }) => {
    await page.goto('/app', { waitUntil: 'networkidle' });
    const legali = page.getByRole('navigation', { name: /informazioni legali/i });
    await expect(legali.getByRole('link', { name: /^privacy$/i })).toBeVisible();
    await expect(legali.getByRole('link', { name: /^termini$/i })).toBeVisible();
    await expect(legali.getByRole('link', { name: /^cookie$/i })).toBeVisible();
  });

  test('il contatto, se c’è, è un indirizzo scrivibile', async ({ page }) => {
    await page.goto('/app', { waitUntil: 'networkidle' });
    const link = page.getByRole('contentinfo').locator('a[href^="mailto:"]');
    if ((await link.count()) === 0) test.skip();
    // L'oggetto precompilato risparmia all'utente di doversi spiegare da zero.
    await expect(link.first()).toHaveAttribute('href', /^mailto:.+@.+\?subject=/);
  });
});
