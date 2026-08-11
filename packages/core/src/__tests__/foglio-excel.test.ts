import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseXlsx } from '../xlsx.js';

// ---------------------------------------------------------------------------
// Quale foglio di un Excel viene letto.
//
// Il ripiego «prendi il primo foglio con almeno due righe» era stato scritto
// per un caso vero e frequente: «Sheet1» di servizio vuoto e i dati sul foglio
// dopo. Funziona per quello — e sbaglia quando il primo foglio ha contenuto che
// non è un listino. Con «Istruzioni» + «Listino 2024» + «Listino 2025» veniva
// importato *Istruzioni* (intestazione: LEGGIMI), e nessuno lo diceva.
//
// Non è un errore casuale: è una regola giusta applicata a un caso che non
// prevedeva. La correzione non è cambiare il ripiego, è **dire cosa si è
// letto** e lasciar scegliere.
// ---------------------------------------------------------------------------

async function excel(fogli: Array<{ nome: string; righe: string[][] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const f of fogli) {
    const ws = wb.addWorksheet(f.nome);
    for (const r of f.righe) ws.addRow(r);
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

const LISTINO = [
  ['sku', 'nome', 'formato'],
  ['OLI-001', 'Olio EVO', '500 ml'],
  ['PAS-002', 'Spaghetti', '500 g'],
];
const ISTRUZIONI = [['LEGGIMI'], ['Compila il foglio Listino con i tuoi prodotti.']];

describe('scelta del foglio', () => {
  it('con un foglio solo lo legge e lo dichiara', async () => {
    const r = await parseXlsx(await excel([{ nome: 'Prodotti', righe: LISTINO }]));
    expect(r.sheet).toBe('Prodotti');
    expect(r.sheets).toEqual(['Prodotti']);
    expect(r.rows).toHaveLength(2);
  });

  it('elenca tutti i fogli, non solo quello letto', async () => {
    const r = await parseXlsx(
      await excel([
        { nome: 'Istruzioni', righe: ISTRUZIONI },
        { nome: 'Listino 2024', righe: LISTINO },
        { nome: 'Listino 2025', righe: LISTINO },
      ]),
    );
    // È l'elenco che rende possibile la scelta: senza, l'utente non sa nemmeno
    // che ci sono altri fogli.
    expect(r.sheets).toEqual(['Istruzioni', 'Listino 2024', 'Listino 2025']);
  });

  it('senza indicazioni sbaglia in modo prevedibile, e lo dice', async () => {
    const r = await parseXlsx(
      await excel([
        { nome: 'Istruzioni', righe: ISTRUZIONI },
        { nome: 'Listino 2024', righe: LISTINO },
      ]),
    );
    // «Istruzioni» ha due righe, quindi il ripiego lo sceglie. Non è quello
    // che l'utente voleva — ma adesso `sheet` lo dichiara, e la scelta esiste.
    expect(r.sheet).toBe('Istruzioni');
    expect(r.headers).toEqual(['LEGGIMI']);
  });

  it('il foglio richiesto vince sul ripiego', async () => {
    const r = await parseXlsx(
      await excel([
        { nome: 'Istruzioni', righe: ISTRUZIONI },
        { nome: 'Listino 2024', righe: LISTINO },
      ]),
      { sheet: 'Listino 2024' },
    );
    expect(r.sheet).toBe('Listino 2024');
    expect(r.headers).toEqual(['sku', 'nome', 'formato']);
    expect(r.rows).toHaveLength(2);
  });

  it('un nome di foglio inesistente ricade sul ripiego invece di fallire', async () => {
    const r = await parseXlsx(
      await excel([{ nome: 'Prodotti', righe: LISTINO }]),
      { sheet: 'Foglio che non c’è' },
    );
    // Un file può essere stato sostituito con uno diverso: meglio leggere
    // qualcosa e dire quale, che rispondere «niente».
    expect(r.sheet).toBe('Prodotti');
    expect(r.rows).toHaveLength(2);
  });

  it('salta il primo foglio se è davvero vuoto', async () => {
    // Il caso per cui il ripiego era stato scritto: resta valido.
    const r = await parseXlsx(
      await excel([
        { nome: 'Sheet1', righe: [] },
        { nome: 'Dati', righe: LISTINO },
      ]),
    );
    expect(r.sheet).toBe('Dati');
    expect(r.rows).toHaveLength(2);
  });

  it('un file con soli fogli vuoti non inventa righe', async () => {
    const r = await parseXlsx(await excel([{ nome: 'Vuoto', righe: [] }]));
    expect(r.rows).toEqual([]);
    expect(r.sheets).toEqual(['Vuoto']);
  });
});
