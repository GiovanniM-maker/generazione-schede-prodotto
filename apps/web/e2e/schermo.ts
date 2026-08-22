import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Le due cose che coprono lo schermo alla prima visita.
//
// Stavano scritte dentro `wizard-risultati.spec.ts` e le usava solo lui. Le
// altre prove che aprono il wizard ci passavano sopra per un caso di tempi: la
// guida è un velo `fixed inset-0` che si chiude con un clic, quindi finché è
// aperta INTERCETTA i clic sul comando principale. Restare senza è un test che
// misura la fortuna.
// ---------------------------------------------------------------------------

/** Toglie l'avviso dei cookie, che alla prima visita sta sopra il comando. */
export async function chiudiBanner(page: Page): Promise<void> {
  // Si monta dopo l'idratazione: cercarlo subito vuol dire non trovarlo e
  // ritrovarselo un attimo dopo sopra al pulsante principale.
  const banner = page.getByRole('region', { name: /avviso cookie/i });
  await banner.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
  await banner
    .getByRole('button', { name: /ho capito/i })
    .click({ timeout: 3000 })
    .catch(() => undefined);
}

/** Chiude la guida a fumetti, che si apre da sola la prima volta. */
export async function chiudiGuida(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const velo = page.locator('[role="dialog"][aria-label^="Guida"]');
    if ((await velo.count()) === 0) break;
    await velo.first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
}
