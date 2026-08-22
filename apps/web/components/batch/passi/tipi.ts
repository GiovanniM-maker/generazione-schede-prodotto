import { analyzeBatch } from '@/lib/actions/batch-wizard';


// I tipi che il wizard si scambia fra i passi.
//
// Stavano in cima a un file da 3876 righe, insieme a undici schermate: per
// sapere cos'era un `SourceMode` bisognava aprire tutto.
// ---------------------------------------------------------------------------

export type AnalyzeData = Extract<Awaited<ReturnType<typeof analyzeBatch>>, { ok: true }>['data'];

/** Copy generata per il campione (mostrata inline nello step Campione). */
export interface SampleCopy {
  title?: string;
  shortDescription?: string;
  longDescription?: string;
  bullets?: string[];
  metaDescription?: string;
}

export type SourceMode = 'images' | 'spreadsheet' | 'both' | 'url' | 'pdf' | 'sku';

export interface StepDef {
  id: number;
  title: string;
}

export interface SourceCard {
  mode: SourceMode | null;
  title: string;
  description: string;
  disabled?: boolean;
  note?: string;
}
