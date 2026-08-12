import { cache } from 'react';
import { getServiceClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Chi è, e come sta messo — in una chiamata sola.
//
// Ogni pagina dietro l'accesso pagava tre andate e ritorno in fila: verifica del
// token, «di che organizzazione fa parte», e infine saldo crediti più dubbi
// aperti. Le ultime due partivano insieme, ma solo dopo che la seconda era
// finita, perché servono l'id dell'organizzazione. Un giro singolo verso il
// database costa 165-300 ms: tre in fila fanno il pavimento di ~800 ms misurato
// su ogni pagina autenticata, contro i 111-246 ms di quelle pubbliche.
//
// I passi 2 e 3 sono una domanda sola, e qui lo diventano davvero.
//
// Resta un giro che non si toglie da qui: la verifica del token. Si potrebbe
// evitare solo verificando la firma in locale, il che richiede che il progetto
// usi chiavi asimmetriche — una scelta di configurazione, non di codice.
// ---------------------------------------------------------------------------

export interface ContestoApp {
  organizationId: string;
  role: 'owner' | 'member';
  credits: number;
  openDoubts: number;
}

/**
 * Il contesto dell'utente per l'intestazione dell'applicazione.
 *
 * `userId` deve essere già verificato (viene da `getSessionUser`): la funzione
 * SQL è SECURITY DEFINER e non passa dalle regole di accesso — esattamente come
 * le tre letture che sostituisce.
 *
 * Memoizzata per richiesta, come le altre letture di sessione: layout e pagina
 * si rendono nello stesso giro e non devono pagarla due volte.
 */
export const contestoApp = cache(async (userId: string): Promise<ContestoApp | null> => {
  const service = getServiceClient();
  const { data, error } = await service.rpc('contesto_app', { u: userId });
  const riga = Array.isArray(data) ? data[0] : null;
  // Senza organizzazione la funzione non restituisce righe: è il caso di chi
  // deve ancora fare l'onboarding, non un guasto.
  if (error || !riga) return null;
  return {
    organizationId: riga.organization_id,
    role: riga.role === 'owner' ? 'owner' : 'member',
    credits: riga.credits ?? 0,
    openDoubts: riga.open_doubts ?? 0,
  };
});
