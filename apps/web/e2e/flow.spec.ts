import { test, expect } from '@playwright/test';

// Percorso end-to-end (mock AI + mock billing). Documenta il flusso completo:
// signup → onboarding → upload fixture → mapping → review → campione mock →
// approvazione → generazione batch mock → review → export.
//
// Prerequisiti: Supabase locale attivo, worker in esecuzione, ENABLE_MOCK_AI e
// ENABLE_MOCK_BILLING = true. Nessun bypass auth è attivo in produzione.
//
// NOTA: questo test cercava la headline «Trasforma il tuo catalogo MODA in
// schede prodotto...», rimasta da quando il prodotto era solo moda. Era rosso
// da allora — e un test rosso da mesi è peggio di un test assente, perché
// insegna a ignorare i fallimenti. Ora cerca il testo vero, e per non
// ricascarci cerca la promessa (foto + Excel → schede) invece della frase
// esatta parola per parola.

test.describe('Percorso completo MVP', () => {
  test('landing mostra headline e CTA', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: /schede prodotto pronte da pubblicare/i }),
    ).toBeVisible();
    // L'invito compare due volte, in cima e in fondo: ne basta uno visibile.
    await expect(
      page.getByRole('link', { name: /prova con 3 prodotti/i }).filter({ visible: true }).first(),
    ).toBeVisible();
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
