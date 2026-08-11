import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Il batch che stai guardando esiste davvero?
//
// Le pagine sotto `/app/batches/[batchId]` controllavano solo che ci fosse una
// sessione, mai che quel batch esistesse o fosse tuo. I dati non uscivano — le
// query passano dalle regole di accesso del database e un batch altrui non
// restituisce righe — ma la pagina si disegnava lo stesso: intestazione,
// tabella vuota e un pulsante «Configura tono e campione» che portava avanti
// dentro un batch inesistente.
//
// È lo stesso difetto per cui è stata tolta `/app/batches/[id]/mapping`: una
// pagina che si apre e non ha niente da dire non è un errore, è un vicolo
// cieco. Chi ci finisce non ha modo di capire se ha sbagliato indirizzo, se il
// batch è stato cancellato o se il prodotto è rotto.
//
// Qui il batch si legge una volta sola, sotto le regole di accesso: se non
// torna niente la pagina è quella di «questo lavoro non c'è più».
//
// Una precisazione onesta: quella pagina arriva con stato HTTP 200, non 404.
// Il guscio dell'applicazione è dinamico e la risposta è già partita quando
// `notFound()` scatta, quindi l'intestazione non si può più cambiare da qui.
// Per l'utente non cambia niente — vede la pagina giusta — e queste rotte
// stanno dietro l'accesso, quindi nessun motore di ricerca le guarda. Sistemarlo
// vorrebbe dire un giro al database nel middleware a ogni apertura: un costo
// vero per un codice che qui non legge nessuno.
// ---------------------------------------------------------------------------

export interface BatchDiPagina {
  id: string;
  name: string;
  status: string;
  brandProfileVersionId: string | null;
}

/**
 * Il batch, o un 404 parlante.
 *
 * Da chiamare **prima** di qualsiasi altra lettura: leggere i prodotti di un
 * batch che non esiste dà zero righe, indistinguibili da un batch vuoto.
 */
export async function batchDiPagina(batchId: string): Promise<BatchDiPagina> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('batches')
    .select('id, name, status, brand_profile_version_id')
    .eq('id', batchId)
    .maybeSingle();
  if (!data) notFound();
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    brandProfileVersionId: data.brand_profile_version_id,
  };
}
