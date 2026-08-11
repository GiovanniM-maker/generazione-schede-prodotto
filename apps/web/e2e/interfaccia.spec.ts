import { test, expect, type Page } from '@playwright/test';

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
      expect(eccesso, `${rotta} scorre di ${eccesso}px in orizzontale`).toBeLessThanOrEqual(0);
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
