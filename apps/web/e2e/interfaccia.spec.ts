import { test, expect, type Page } from '@playwright/test';

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
// Qualità dell'interfaccia, misurata su un browser vero.
//
// I 338 test unitari non vedono NIENTE di tutto questo: una pagina che scorre
// di lato sul telefono, un pulsante troppo piccolo per il pollice, un elemento
// che ne copre un altro, un errore JavaScript in console. Sono esattamente i
// difetti che finora ha trovato l'utente usando l'app, non io.
//
// Qui si misura quello che si vede. Le pagine coperte sono quelle PUBBLICHE:
// i flussi autenticati richiedono una sessione e restano da fare.
// ---------------------------------------------------------------------------

const PAGINE_PUBBLICHE = ['/', '/login', '/privacy', '/termini', '/cookie'];

/** L'overlay di sviluppo di Next non fa parte dell'app: va escluso dalle misure. */
const IGNORA = 'nextjs-portal';

const SELETTORE_INTERATTIVI = 'a,button,input,select,textarea,[role="button"]';

async function elementiInterattivi(page: Page) {
  return page.evaluate(
    ([ignora, selettore]) => {
      const out: Array<{ descrizione: string; larghezza: number; altezza: number }> = [];
      for (const el of document.querySelectorAll(selettore)) {
        if (el.closest(ignora)) continue;
        // Un elemento che ne contiene un altro interattivo e' solo un
        // involucro: l'area che il dito tocca e' quella del figlio. Misurare
        // l'involucro darebbe falsi allarmi — un <a> inline attorno a un
        // bottone risulta alto quanto una riga di testo, ma il bottone
        // dentro e' grande e riceve il tocco.
        if (el.querySelector(selettore)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const stile = getComputedStyle(el);
        if (stile.visibility === 'hidden' || stile.display === 'none') continue;
        out.push({
          descrizione: `${el.tagName.toLowerCase()}«${(el.textContent || '').trim().slice(0, 30)}»`,
          larghezza: Math.round(r.width),
          altezza: Math.round(r.height),
        });
      }
      return out;
    },
    [IGNORA, SELETTORE_INTERATTIVI] as const,
  );
}

for (const rotta of PAGINE_PUBBLICHE) {
  test.describe(`pagina ${rotta}`, () => {
    test('si apre senza errori JavaScript', async ({ page }) => {
      const errori: string[] = [];
      page.on('pageerror', (e) => errori.push(e.message));
      const risposta = await page.goto(rotta, { waitUntil: 'networkidle' });
      expect(risposta?.status(), `${rotta} deve rispondere 200`).toBe(200);
      expect(errori, `errori JS su ${rotta}`).toEqual([]);
    });

    test('non scorre in orizzontale', async ({ page }) => {
      await page.goto(rotta, { waitUntil: 'networkidle' });
      const eccesso = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // Lo scorrimento laterale su un telefono e' il difetto piu' fastidioso e
      // il piu' facile da introdurre: basta una tabella o un titolo lungo.
      expect(eccesso, `${rotta} scorre di ${eccesso}px in orizzontale`).toBeLessThanOrEqual(SFORO_TOLLERATO);
    });

    test('nessun testo sotto i 12px', async ({ page }) => {
      await page.goto(rotta, { waitUntil: 'networkidle' });
      const minuscoli = await page.evaluate((ignora) => {
        const out = new Set<string>();
        for (const el of document.querySelectorAll('p,span,li,td,label,div,a,button')) {
          if (el.closest(ignora) || el.children.length) continue;
          const testo = el.textContent?.trim();
          if (!testo) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < 12) out.add(`${px}px "${testo.slice(0, 30)}"`);
        }
        return [...out];
      }, IGNORA);
      expect(minuscoli).toEqual([]);
    });

    test('ogni comando è abbastanza grande da toccarlo (WCAG 2.2 AA: 24px)', async ({ page }) => {
      await page.goto(rotta, { waitUntil: 'networkidle' });
      const troppoPiccoli = (await elementiInterattivi(page))
        .filter((e) => e.altezza < 24 || e.larghezza < 24)
        .map((e) => `${e.descrizione} ${e.larghezza}x${e.altezza}`);
      expect(troppoPiccoli, `comandi sotto la soglia minima su ${rotta}`).toEqual([]);
    });
  });
}

test.describe('landing', () => {
  test('mostra la promessa e l’invito ad agire', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /prova con 3 prodotti/i }).first()).toBeVisible();
  });

  // Il prezzo era già nel database, ma la regola RLS su `billing_products`
  // diceva `to authenticated`: il listino si leggeva solo DOPO essersi
  // iscritti. Cioè mai, per chi doveva ancora decidere se iscriversi — e la
  // sezione «Pacchetti di crediti» si apriva su tre cartellini vuoti.
  //
  // Questo test conta perché il contesto di Playwright parte SENZA sessione:
  // è un visitatore qualunque. Provata dal server, o da un utente collegato,
  // quella lettura sarebbe passata comunque e il difetto sarebbe rimasto.
  test('un visitatore senza account vede quanto costa', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Per intestazione, non per testo: «pacchetti di crediti» ricompare nella
    // risposta di una FAQ, e `hasText` prendeva quella.
    const listino = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Pacchetti di crediti' }) });
    await expect(listino).toBeVisible();

    // Una cifra con i centesimi e la valuta: «29,00 €». Non il numero esatto —
    // i prezzi cambiano dal database, ed è il punto.
    const prezzi = listino.getByText(/\d+,\d{2}\s*€/);
    expect(await prezzi.count(), 'nessun prezzo nella sezione dei pacchetti').toBeGreaterThan(0);

    // `—` è il segnaposto di un pacchetto senza prezzo: nel listino esposto non
    // ci deve essere.
    await expect(listino.getByText('—', { exact: true })).toHaveCount(0);
  });

  test('il banner cookie non copre il proprio pulsante', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const bottone = page.getByRole('region', { name: /avviso cookie/i }).getByRole('button', { name: /ho capito/i });
    if ((await bottone.count()) === 0) test.skip();
    // `click` fallisce da solo se qualcosa sta davanti: e' la verifica migliore.
    await bottone.click({ timeout: 5000 });
    await expect(bottone).toBeHidden();
  });
});

test.describe('login', () => {
  test('il campo email è raggiungibile e digitabile', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });
    const email = page.getByLabel(/email/i);
    await email.fill('prova@esempio.it');
    await expect(email).toHaveValue('prova@esempio.it');
  });
});

// ---------------------------------------------------------------------------

test.describe('pagine legali', () => {
  // Erano pubbliche, rispondevano 200 e avevano l'aria di documenti veri, ma
  // contenevano «[Ragione sociale]», «[email di contatto]», «[città]». Una
  // privacy policy con le parentesi quadre dentro è peggio di una assente: la
  // seconda si nota, la prima no.

  for (const rotta of ['/privacy', '/termini', '/cookie']) {
    test(`${rotta} non mostra segnaposto nel testo`, async ({ page }) => {
      await page.goto(rotta, { waitUntil: 'networkidle' });
      const testo = (await page.locator('body').innerText()) ?? '';
      for (const segnaposto of [
        '[Ragione sociale]',
        '[indirizzo]',
        '[email di contatto]',
        '[città]',
      ]) {
        expect(testo, `${rotta} contiene ancora ${segnaposto}`).not.toContain(segnaposto);
      }
    });

    test(`${rotta} dichiara di essere una bozza finché i dati non ci sono`, async ({ page }) => {
      await page.goto(rotta, { waitUntil: 'networkidle' });
      const testo = (await page.locator('body').innerText()) ?? '';
      // O il documento è completo (nessuna dicitura, nessun «da indicare»), o
      // lo dice apertamente. Le due cose insieme non possono stare.
      const incompleto = testo.includes('da indicare');
      const dichiarato = testo.includes('Documento non ancora valido');
      expect(incompleto).toBe(dichiarato);
    });
  }

  test('una bozza chiede ai motori di non indicizzarla', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'networkidle' });
    const testo = (await page.locator('body').innerText()) ?? '';
    if (!testo.includes('Documento non ancora valido')) test.skip();
    // Una pagina legale incompleta, una volta indicizzata, resta in giro per mesi.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/i,
    );
  });
});

// ---------------------------------------------------------------------------

test.describe('come si presenta un link fuori dal prodotto', () => {
  // Non c'era niente: zero `og:`, zero `twitter:`, zero `canonical`. Incollato
  // su WhatsApp o LinkedIn, l'indirizzo restava un indirizzo nudo — nessun
  // titolo, nessuna immagine, nessuna frase — e chi lo riceveva doveva fidarsi
  // di un link e basta.
  //
  // Si prova sulla pagina renderizzata, non sul file dei metadati: `metadata`
  // in Next si eredita, si sovrascrive e si ignora in silenzio (un componente
  // client che esporta `metadata` non produce niente, senza un errore). L'unico
  // posto dove la verità è visibile è il `<head>` che arriva al browser.

  const PUBBLICHE = ['/', '/privacy', '/termini', '/cookie', '/login'];

  async function tag(page: import('@playwright/test').Page, selettore: string, attributo: string) {
    const el = page.locator(selettore);
    return (await el.count()) > 0 ? el.first().getAttribute(attributo) : null;
  }

  test('la vetrina si presenta con titolo, frase e immagine', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    expect(await tag(page, 'meta[property="og:title"]', 'content')).toBeTruthy();
    expect(await tag(page, 'meta[property="og:site_name"]', 'content')).toBe('Verificato');
    expect(await tag(page, 'meta[name="twitter:card"]', 'content')).toBe('summary_large_image');

    const descrizione = await tag(page, 'meta[property="og:description"]', 'content');
    expect(descrizione, 'og:description assente').toBeTruthy();
    // La descrizione prometteva «catalogo moda», scritta quando il prodotto era
    // solo per la moda: chi cercava schede per alimentari leggeva di vestiti.
    expect(descrizione!.toLowerCase()).not.toContain('catalogo moda');
  });

  test('l’immagine dell’anteprima esiste davvero', async ({ page, request }) => {
    // Un `og:image` che risponde 404 è peggio di nessun `og:image`: la
    // piattaforma mostra un riquadro rotto invece di un link pulito.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const src = await tag(page, 'meta[property="og:image"]', 'content');
    expect(src, 'og:image assente').toBeTruthy();

    const risposta = await request.get(src!);
    expect(risposta.status(), `og:image risponde ${risposta.status()}`).toBe(200);
    expect(risposta.headers()['content-type']).toContain('image/');
    // 1200×630 è la misura che le piattaforme ritagliano bene; se qualcuno la
    // cambia, l'anteprima esce tagliata e nessuno se ne accorge da qui dentro.
    expect(await tag(page, 'meta[property="og:image:width"]', 'content')).toBe('1200');
    expect(await tag(page, 'meta[property="og:image:height"]', 'content')).toBe('630');
  });

  for (const rotta of PUBBLICHE) {
    test(`${rotta} dichiara sé stessa come indirizzo canonico`, async ({ page }) => {
      // Il difetto che questo test esiste per fermare l'ho fatto io, mettendo
      // `canonical: '/'` nel guscio: essendo ereditato finiva su OGNI pagina,
      // e diceva ai motori che privacy, termini, cookie e accesso **sono** la
      // vetrina. È il modo più rapido di far sparire tre documenti legali
      // dall'indice, e a schermo non cambia niente.
      await page.goto(rotta, { waitUntil: 'domcontentloaded' });
      const canonico = await tag(page, 'link[rel="canonical"]', 'href');
      expect(canonico, `nessun canonical su ${rotta}`).toBeTruthy();

      const percorso = new URL(canonico!).pathname.replace(/\/$/, '') || '/';
      expect(percorso, `${rotta} si dichiara ${percorso}`).toBe(rotta);
    });
  }

  test('il titolo di una pagina interna porta con sé il marchio', async ({ page }) => {
    // Uscivano come «Privacy Policy», senza dire di chi.
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/privacy policy — verificato/i);
  });
});
