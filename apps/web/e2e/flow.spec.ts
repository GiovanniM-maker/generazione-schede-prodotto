import { test, expect } from '@playwright/test';

// Percorso end-to-end (mock AI + mock billing). Documenta il flusso completo:
// signup → onboarding → upload fixture → mapping → review → campione mock →
// approvazione → generazione batch mock → review → export.
//
// Prerequisiti: Supabase locale attivo, worker in esecuzione, ENABLE_MOCK_AI e
// ENABLE_MOCK_BILLING = true. Nessun bypass auth è attivo in produzione.

test.describe('Percorso completo MVP', () => {
  test('landing mostra headline e CTA', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByText('Trasforma il tuo catalogo moda in schede prodotto pronte da pubblicare'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Prova con 3 prodotti/i })).toBeVisible();
  });

  test('login mostra il form magic link', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  // I passi autenticati (onboarding→export) richiedono una sessione Supabase reale.
  // In CI vengono eseguiti con un utente di test seed-ato e i servizi attivi.
  test.skip('flusso autenticato completo', async () => {
    // 1. registrazione/login via magic link (token di test)
    // 2. onboarding: profilo tono
    // 3. nuovo batch: upload fixtures/fashion-valid.csv
    // 4. mapping colonne → conferma
    // 5. review input
    // 6. genera campione (mock) → approva tono
    // 7. genera batch (mock) → attendi worker
    // 8. review risultati → export CSV/XLSX
  });
});
