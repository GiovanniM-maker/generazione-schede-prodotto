import ExcelJS from 'exceljs';
import { normalizeCell } from './normalize.js';
import type { ParseResult } from './csv.js';
import type { RawRow } from './types.js';

// ---------------------------------------------------------------------------
// Parsing XLSX server-side con exceljs. Nessuna formula eseguita: leggiamo il
// valore risultante/testo, mai la formula. Rifiuto di .xlsm gestito a monte.
// ---------------------------------------------------------------------------

/** Estrae il testo di una cella senza mai valutare formule. */
function cellToString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    // Formula: usa SOLO il risultato pre-calcolato, mai la formula stessa.
    if ('result' in v && v.result !== undefined && v.result !== null) {
      return String(v.result);
    }
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((r) => r.text).join('');
    }
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('hyperlink' in v && typeof v.text === 'string') return v.text;
  }
  return '';
}

export async function parseXlsx(input: Buffer, opts?: { maxRows?: number }): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // Copia in un ArrayBuffer dedicato: aggira l'attrito di tipi tra il Buffer
  // generico di @types/node 22 e la firma di exceljs, senza usare `any`.
  const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  await wb.xlsx.load(ab as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    return {
      headers: [],
      rows: [],
      summary: { totalRows: 0, emptyRowsSkipped: 0, duplicateHeaders: [], delimiter: 'xlsx' },
    };
  }

  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = normalizeCell(cellToString(cell));
    });
    matrix.push(values);
  });

  if (matrix.length === 0) {
    return {
      headers: [],
      rows: [],
      summary: { totalRows: 0, emptyRowsSkipped: 0, duplicateHeaders: [], delimiter: 'xlsx' },
    };
  }

  const rawHeaders = (matrix[0] ?? []).map((h) => normalizeCell(String(h ?? '')));
  // Dedup header
  const seen = new Map<string, number>();
  const headers: string[] = [];
  const duplicates: string[] = [];
  for (const h of rawHeaders) {
    const n = seen.get(h) ?? 0;
    if (n > 0) {
      duplicates.push(h);
      headers.push(`${h}_${n + 1}`);
    } else {
      headers.push(h);
    }
    seen.set(h, n + 1);
  }

  const rows: RawRow[] = [];
  let emptyRowsSkipped = 0;
  const maxRows = opts?.maxRows ?? Infinity;
  for (let i = 1; i < matrix.length && rows.length < maxRows; i++) {
    const values = matrix[i] ?? [];
    if (values.every((v) => (v ?? '') === '')) {
      emptyRowsSkipped++;
      continue;
    }
    const row: RawRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return {
    headers,
    rows,
    summary: {
      totalRows: rows.length,
      emptyRowsSkipped,
      duplicateHeaders: [...new Set(duplicates)],
      delimiter: 'xlsx',
    },
  };
}
