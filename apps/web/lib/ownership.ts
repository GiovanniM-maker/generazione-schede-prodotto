import { createSupabaseServerClient } from '@/lib/supabase/server';

// Verifica (sotto RLS) che l'utente autenticato possa accedere al batch.
// Ritorna organization_id se autorizzato, altrimenti null.
export async function assertBatchAccess(batchId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('batches')
    .select('id, organization_id')
    .eq('id', batchId)
    .maybeSingle();
  return data?.organization_id ?? null;
}
