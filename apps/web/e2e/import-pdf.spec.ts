import { test, expect } from '@playwright/test';
import { accedi, creaUtenteDiProva, eliminaUtenteDiProva, motivoPerSaltare } from './sessione';
import { seminaScenario } from './semina';

// ---------------------------------------------------------------------------
// L'import da PDF, dall'inizio alla fine, in un browser vero e su un database
// vero.
//
// Le prove unitarie dicono che il testo si estrae e che i fatti si
// riconoscono. Non dicono niente di quello che succede dopo: che il prodotto
// arriva a database, che i valori nuovi degli enum esistono davvero
// (`pdf_upload`, `pdf_source`: se la migrazione 38 non è stata applicata, qui
// si vede — e non in produzione al primo cliente), che la scheda «PDF» del
// wizard porta dove dice di portare.
// ---------------------------------------------------------------------------

const salta = motivoPerSaltare();

/** Un PDF minimo e valido con del testo posizionato in due colonne. */
function schedaTecnicaPdf(righe: Array<[string, string]>, titolo: string): Buffer {
  let y = 740;
  let ops = `BT /F1 22 Tf 60 780 Td (${titolo}) Tj ET\n`;
  for (const [k, v] of righe) {
    ops += `BT /F1 11 Tf 60 ${y} Td (${k}) Tj ET\nBT /F1 11 Tf 260 ${y} Td (${v}) Tj ET\n`;
    y -= 22;
  }
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offset: number[] = [];
  oggetti.forEach((o, i) => {
    offset.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test.describe('import da PDF', () => {
  test.skip(salta !== null, salta ?? '');

  let utenteId: string | null = null;

  test.beforeEach(async ({ context }, info) => {
    const utente = await creaUtenteDiProva(`pdf${info.parallelIndex}`);
    utenteId = utente.id;
    await accedi(context, utente);
    await seminaScenario(utente.id);
  });

  test.afterEach(async () => {
    if (utenteId) await eliminaUtenteDiProva(utenteId);
    utenteId = null;
  });

  test('una scheda tecnica diventa un prodotto con i suoi fatti', async ({ page }) => {
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });

    // La guida a fumetti copre i campi: si chiude prima.
    for (let i = 0; i < 3; i++) {
      const velo = page.locator('[role="dialog"][aria-label^="Guida"]');
      if ((await velo.count()) === 0) break;
      await velo.first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
      await page.waitForTimeout(250);
    }

    // Passo 1: i preset arrivano dalla rete, e il passo non è completo finché
    // non ce n'è uno scelto.
    await expect(page.getByRole('button', { name: /Preset/i }).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /Preset/i }).first().click();
    await page.locator('#batch-name').fill('Import da PDF');
    await page.getByRole('button', { name: /crea e continua/i }).click();
    await expect(page).toHaveURL(/batch=/, { timeout: 20000 });

    // Passo 2 (preset) → passo 3 (fonti).
    await page.getByRole('button', { name: /^continua$/i }).first().click();
    await expect(page.getByText(/scegli da dove arrivano i dati/i)).toBeVisible({ timeout: 15000 });

    // La scheda «PDF» non è più «In arrivo»: si può scegliere.
    await page.getByRole('button', { name: /^PDF/ }).click();
    const campo = page.getByTestId('pdf-input');
    await expect(campo).toBeAttached({ timeout: 10000 });

    await campo.setInputFiles({
      name: 'sedia-aurora.pdf',
      mimeType: 'application/pdf',
      buffer: schedaTecnicaPdf(
        [
          ['Marca', 'Ferrini'],
          ['Codice articolo', 'SED-AUR-01'],
          ['Materiale', 'Faggio massello'],
          ['Peso', '6,4 kg'],
        ],
        'Sedia Ergonomica Aurora',
      ),
    });

    await page.getByRole('button', { name: /importa e continua/i }).click();

    // Il prodotto esiste: nome dal titolo, SKU dal codice articolo. Se la
    // migrazione 38 mancasse, l'import fallirebbe qui e non a casa di qualcuno.
    await expect(page.getByText('SED-AUR-01').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/Sedia Ergonomica Aurora/).first()).toBeVisible({ timeout: 20000 });
  });
});
