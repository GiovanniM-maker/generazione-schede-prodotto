import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@app/database';

// Calcola i conteggi dei problemi di importazione di un batch a partire da
// `batches` (prodotti validi/esclusi) e da `source_items` (stato per riga/file).
// Sola lettura: la risoluzione completa dei conflitti è una fase successiva.

export interface ImportIssues {
  missingSku: number; // righe/file senza SKU
  duplicateFile: number; // SKU/file duplicati
  unmatched: number; // immagini non associate ad alcuno SKU
  emptyFile: number; // file vuoti
  unsupportedFormat: number; // formati non supportati
  excludedProducts: number; // prodotti ancora esclusi (conteggio live)
  total: number;
}

type Client = SupabaseClient<Database>;

const EMPTY: ImportIssues = {
  missingSku: 0,
  duplicateFile: 0,
  unmatched: 0,
  emptyFile: 0,
  unsupportedFormat: 0,
  excludedProducts: 0,
  total: 0,
};

export async function computeImportIssues(
  supabase: Client,
  batchId: string,
): Promise<ImportIssues> {
  const { data: batch } = await supabase
    .from('batches')
    .select('id')
    .eq('id', batchId)
    .maybeSingle();

  // Conta gli esclusi DAL VIVO: il contatore batches.invalid_products è una
  // fotografia dell'import e resta stantio dopo che l'estrazione visiva ha
  // promosso i prodotti a idonei (falso allarme "N esclusi" a batch riuscito).
  const { count: excludedNow } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('verification_status', 'excluded');

  const { data: sources } = await supabase
    .from('batch_sources')
    .select('id')
    .eq('batch_id', batchId);

  const sourceIds = (sources ?? []).map((s) => s.id);

  let items: { status: string }[] = [];
  if (sourceIds.length > 0) {
    const { data } = await supabase
      .from('source_items')
      .select('status')
      .in('batch_source_id', sourceIds);
    items = (data ?? []) as { status: string }[];
  }

  const count = (status: string) => items.filter((i) => i.status === status).length;

  const issues: ImportIssues = {
    missingSku: count('missing_sku'),
    duplicateFile: count('duplicate_file'),
    unmatched: count('unmatched'),
    emptyFile: count('empty_file'),
    unsupportedFormat: count('unsupported_format'),
    excludedProducts: excludedNow ?? 0,
    total: 0,
  };
  issues.total =
    issues.missingSku +
    issues.duplicateFile +
    issues.unmatched +
    issues.emptyFile +
    issues.unsupportedFormat +
    issues.excludedProducts;

  return batch || sourceIds.length > 0 ? issues : EMPTY;
}
