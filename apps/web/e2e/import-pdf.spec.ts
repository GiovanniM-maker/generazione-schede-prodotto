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
    // La guida a fumetti del wizard è un velo `fixed inset-0` e intercetta i
    // clic a ogni passo. Chiuderla a mano una volta non basta — ne compare una
    // nuova al passo dopo — e questo test parla dell'import, non di come si
    // scacciano i fumetti. Si dichiara già vista, com'è per chi il wizard
    // l'ha già aperto una volta.
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

  test('una scheda tecnica diventa un prodotto con i suoi fatti', async ({ page }) => {
    // Sono undici passi di wizard, la creazione del batch, la lettura del PDF
    // e la scrittura del prodotto: il minuto predefinito è appena sufficiente,
    // e appena sufficiente vuol dire rosso su una macchina lenta per una
    // ragione che col prodotto non c'entra.
    test.setTimeout(120_000);
    await page.goto('/app/batches/new', { waitUntil: 'networkidle' });

    // Passo 1: i preset arrivano dalla rete e il primo si sceglie da sé, ma
    // finché non sono arrivati il passo non è completo. Una persona aspetta di
    // vederli; il test deve fare lo stesso, o misura la rete.
    await expect(page.getByRole('button', { name: /Preset/i }).first()).toBeVisible({ timeout: 20000 });
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

    // L'azione principale del passo sta nella barra in fondo, ed è una sola.
    await page.getByRole('button', { name: /importa i PDF/i }).click();

    // Il prodotto esiste: nome dal titolo, SKU dal codice articolo. Se la
    // migrazione 38 mancasse, l'import fallirebbe qui e non a casa di qualcuno.
    await expect(page.getByText('SED-AUR-01').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/Sedia Ergonomica Aurora/).first()).toBeVisible({ timeout: 20000 });
  });
});
