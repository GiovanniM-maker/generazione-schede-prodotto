// build-xlsx.mjs
//
// Genera fixtures/fashion-conflicting-data.xlsx a partire dai dati qui sotto,
// che sono l'esatto gemello del file fashion-conflicting-data.csv committato
// (il CSV esiste cosi' i test hanno dati anche PRIMA che l'xlsx venga costruito).
//
// exceljs NON e' installato di default in questo repo. Per generare l'xlsx:
//
//     pnpm add -D exceljs        # oppure: npm install exceljs
//     node fixtures/build-xlsx.mjs
//
// Lo script scrive fashion-conflicting-data.xlsx nella stessa cartella fixtures/.
// Se exceljs non e' installato, lo script stampa un messaggio e termina senza
// errori bloccanti, cosi' la pipeline dei test puo' comunque proseguire usando
// il CSV gemello.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'fashion-conflicting-data.xlsx');

// Gemello esatto di fashion-conflicting-data.csv (header + righe).
const HEADER = [
  'sku',
  'nome',
  'colore_gestionale',
  'colore_foto',
  'composizione_dichiarata',
  'composizione_etichetta',
  'vestibilita',
  'note',
];

const ROWS = [
  ['CNF-01', 'Camicia in cotone', 'Blu', 'Nero', '100% cotone', '100% cotone', 'Slim fit', 'Colore gestionale e foto discordanti: vince il gestionale (Blu)'],
  ['CNF-02', 'Maglione girocollo', 'Grigio', 'Grigio', '100% lana merino', '70% lana 30% acrilico', 'Regular fit', 'Composizione dichiarata e composizione etichetta discordanti'],
  ['CNF-03', 'Pantalone chino', 'Beige', 'Beige', '97% cotone 3% elastan', '', 'Slim fit', 'Etichetta mancante: usare solo la composizione dichiarata'],
  ['CNF-04', 'Giacca in lino', 'Sabbia', 'Avorio', '100% lino', '55% lino 45% viscosa', 'Regular fit', 'Doppio conflitto colore e composizione sulla stessa riga'],
  ['CNF-05', 'Abito in seta', 'Rosso', 'Bordeaux', '100% seta', '100% seta', 'Vestibilita morbida', 'Colore foto piu scuro del gestionale: vince il gestionale'],
  ['CNF-06', 'Felpa con cappuccio', 'Verde', 'Verde', '80% cotone 20% poliestere', '80% cotone 20% poliestere', 'Oversize', 'Nessun conflitto: riga di controllo coerente'],
];

async function main() {
  let ExcelJS;
  try {
    ExcelJS = (await import('exceljs')).default;
  } catch {
    console.error(
      "[build-xlsx] exceljs non installato. Esegui `pnpm add -D exceljs` e riprova.\n" +
        '            I test possono comunque usare fashion-conflicting-data.csv (gemello).',
    );
    process.exit(0);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'fixtures/build-xlsx.mjs';
  const ws = wb.addWorksheet('Prodotti');

  ws.addRow(HEADER);
  for (const row of ROWS) {
    const added = ws.addRow(row);
    // Forza lo sku come testo per preservare eventuali zeri iniziali.
    added.getCell(1).numFmt = '@';
  }

  ws.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(OUT);
  console.log(`[build-xlsx] Scritto ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
