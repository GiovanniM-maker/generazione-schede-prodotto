import { parse } from 'csv-parse/sync';
import { normalizeCell } from './normalize.js';
import type { RawRow } from './types.js';

// ---------------------------------------------------------------------------
// Parsing CSV server-side. Rileva delimitatore, gestisce UTF-8 (+ BOM),
// segnala header duplicati, ignora righe vuote, mantiene i valori come stringhe.
// Nessuna formula eseguita (il CSV è testo).
// ---------------------------------------------------------------------------

export interface ParseResult {
  headers: string[];
  rows: RawRow[];
  summary: {
    totalRows: number;
    emptyRowsSkipped: number;
    duplicateHeaders: string[];
    delimiter: string;
  };
}

const DELIMITERS = [',', ';', '\t', '|'];

/** Euristica: sceglie il delimitatore più frequente nella prima riga non vuota. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\ufeff/, '').split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Rende univoci gli header duplicati (append _2, _3) e li segnala. */
function dedupeHeaders(headers: string[]): { headers: string[]; duplicates: string[] } {
  const seen = new Map<string, number>();
  const out: string[] = [];
  const duplicates: string[] = [];
  for (const h of headers) {
    const key = h.trim();
    const n = seen.get(key) ?? 0;
    if (n > 0) {
      duplicates.push(key);
      out.push(`${key}_${n + 1}`);
    } else {
      out.push(key);
    }
    seen.set(key, n + 1);
  }
  return { headers: out, duplicates: [...new Set(duplicates)] };
}

export function parseCsv(input: string | Buffer, opts?: { maxRows?: number }): ParseResult {
  const text = (typeof input === 'string' ? input : input.toString('utf8')).replace(/^\ufeff/, '');
  const delimiter = detectDelimiter(text);

  const records = parse(text, {
    delimiter,
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
    bom: true,
  }) as string[][];

  if (records.length === 0) {
    return {
      headers: [],
      rows: [],
      summary: { totalRows: 0, emptyRowsSkipped: 0, duplicateHeaders: [], delimiter },
    };
  }

  const rawHeaders = (records[0] ?? []).map((h) => normalizeCell(String(h)));
  const { headers, duplicates } = dedupeHeaders(rawHeaders);

  const rows: RawRow[] = [];
  let emptyRowsSkipped = 0;
  const maxRows = opts?.maxRows ?? Infinity;

  for (let i = 1; i < records.length && rows.length < maxRows; i++) {
    const rec = records[i] ?? [];
    const values = rec.map((v) => normalizeCell(String(v ?? '')));
    if (values.every((v) => v === '')) {
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
      duplicateHeaders: duplicates,
      delimiter,
    },
  };
}
