'use server';

import { logWrite } from '@app/core';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess, soloProprietario } from '@/lib/ownership';

// ---------------------------------------------------------------------------
// Quel che resta del flusso batch della prima versione.
//
// `createBatchAction`, `uploadAndParseAction` e `confirmMappingAndImportAction`
// sono state rimosse insieme alla loro interfaccia (`/app/batches/[id]/mapping`,
// `mapping-editor`, `new-batch-flow`): il wizard v2 le ha sostituite da tempo,
// ma la pagina restava raggiungibile dalla dashboard e portava in un vicolo
// cieco che parlava del «preset Moda». In Next ogni funzione esportata da un
// file 'use server' è un endpoint di rete: azioni senza chiamanti non sono
// codice morto, sono superficie viva.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Eliminazione batch (con conferma lato UI).
// ---------------------------------------------------------------------------

/**
 * Elimina un batch e tutti i dati collegati (prodotti, generazioni, job,
 * sorgenti) via cascade. Rifiuta se il batch è in coda/elaborazione per non
 * lasciare crediti riservati orfani o job attivi senza batch.
 */
export async function deleteBatchAction(input: {
  batchId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return { ok: false, error: 'Batch non accessibile' };
  // Cancellare un batch distrugge il lavoro di tutti, e `batches` non registra
  // chi l'ha creato: senza quella colonna non c'è una regola più fine di
  // questa.
  const permesso = await soloProprietario('eliminare un batch');
  if (!permesso.ok) return { ok: false, error: permesso.error };
  const service = getServiceClient();

  const { data: batch } = await service
    .from('batches')
    .select('status')
    .eq('id', input.batchId)
    .maybeSingle();
  if (!batch) return { ok: false, error: 'Batch non trovato' };
  if (batch.status === 'queued' || batch.status === 'processing') {
    return {
      ok: false,
      error: 'Il batch è in elaborazione: attendi il completamento prima di eliminarlo.',
    };
  }

  const { error } = await service.from('batches').delete().eq('id', input.batchId);
  if (error) return { ok: false, error: error.message };

  await logWrite('app_events.insert', service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'batch_deleted',
    metadata_json: {},
  }));
  return { ok: true };
}
