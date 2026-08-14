'use server';

import { verificaBatch, type EsitoBatch } from '@app/core';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { leggiDiritti } from '@/lib/entitlements';
import { getServiceClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// «Ci sono abbastanza crediti?», chiesto prima di premere.
//
// Fino a ieri questa domanda si poteva fare in un modo solo: premere «Genera» e
// leggere la risposta del server, che arrivava come 402 con la frase
//
//     «Crediti insufficienti per generare l'intero batch.
//      Acquista crediti dalla pagina Abbonamento.»
//
// Tre cose sbagliate in due righe. Non dice **quanti** ne mancano. Non dice
// cosa comprare. E manda a una pagina chiamata «Abbonamento», che nel prodotto
// non esiste: si chiama Fatturazione.
//
// Chi ha appena caricato cinquecento righe merita di saperlo mentre le guarda.
// ---------------------------------------------------------------------------

export interface ConteggiBatch {
  idonei: number;
  soloImmagini: number;
}

export type VerificaBatchResult =
  | ({ ok: true; conteggi: ConteggiBatch } & EsitoBatch)
  | { ok: false; error: string };

/**
 * Dice se il batch si può avviare, con quanto manca e cosa comprare.
 *
 * Non lancia mai oltre il confine server: in produzione Next.js oscura i
 * messaggi delle eccezioni, e un errore oscurato qui diventerebbe un pulsante
 * che non funziona senza dire perché.
 */
export async function verificaCreditiBatch(batchId: string): Promise<VerificaBatchResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const org = await getUserOrg(user.id);
  if (!org) return { ok: false, error: 'Nessuna organizzazione' };

  const service = getServiceClient();

  // Il batch deve essere di questa organizzazione: il `batchId` arriva dal
  // client, e un conteggio di crediti su un batch altrui sarebbe una fessura da
  // cui si legge quanto lavoro fa qualcun altro.
  const { data: batch } = await service
    .from('batches')
    .select('id')
    .eq('id', batchId)
    .eq('organization_id', org.organizationId)
    .maybeSingle();
  if (!batch) return { ok: false, error: 'Batch non accessibile' };

  // Gli idonei con la stessa condizione che userà `enqueueBatch`: se le due
  // divergono, il conto mostrato non è il conto addebitato.
  const { count: idonei } = await service
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('verification_status', 'eligible');

  // I «solo-immagini» non sono una colonna: sono i prodotti non ancora idonei
  // che hanno almeno una foto, e che l'AI potrebbe rendere idonei leggendo le
  // etichette all'avvio.
  const { data: conFoto } = await service
    .from('products')
    .select('id, product_assets!inner(id)')
    .eq('batch_id', batchId)
    .neq('verification_status', 'eligible');

  const soloImmagini = new Set((conFoto ?? []).map((p) => p.id)).size;
  const conteggi: ConteggiBatch = { idonei: idonei ?? 0, soloImmagini };

  const d = await leggiDiritti(org.organizationId);
  return { ok: true, conteggi, ...verificaBatch(d, conteggi) };
}
