'use server';

import { giudicaDistanza, riassumiMisure, type Giudizio } from '@app/core';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Quanto costa parlare con Supabase, misurato da dentro.
//
// Non misura una query: misura la DISTANZA. È l'unico numero che da fuori non
// si può conoscere — il database dichiara di rispondere in 0,16 millisecondi,
// ma quel numero è il tempo che passa fra quando la richiesta arriva e quando
// riparte. Tutto il viaggio per arrivarci non lo vede nessuno.
//
// Serve a rispondere a una domanda sola, e a rispondere prima di toccare
// qualsiasi altra cosa: le funzioni girano accanto al database o dall'altra
// parte dell'oceano? Se sono lontane, ogni intervento sul numero di richieste
// vale dieci volte tanto. Se sono vicine, quegli interventi non si sentono e
// il tempo va speso altrove.
//
// DUE MISURE, NON UNA. Il database e l'autenticazione sono due servizi
// separati, con due indirizzi diversi: una pagina li interroga entrambi, e
// sapere quanto costa ciascuno dice anche quanto vale togliere la doppia
// validazione del token.
// ---------------------------------------------------------------------------

/** Quanti giri: il primo si butta, degli altri si tiene il più veloce. */
const GIRI = 4;

export interface EsitoSonda {
  database: { minimo: number; mediana: number; primo: number; giri: number[] };
  /** Il costo di far validare il token a Supabase, come fa il middleware. */
  autenticazione: { minimo: number; giri: number[] };
  giudizio: Giudizio;
  /** La regione in cui gira questa funzione: `iad1`, `dub1`, `fra1`… */
  regione: string | null;
  /** La regione del database, dalla configurazione. */
  regioneDatabase: string;
}

export type RisultatoSonda =
  | { ok: true; data: EsitoSonda }
  | { ok: false; error: string };

/**
 * Misura un'andata e ritorno verso il database e verso l'autenticazione.
 *
 * La query scelta — una riga da `sectors`, tabella da tre righe — non tocca
 * niente e il database la esegue in microsecondi: tutto quello che il
 * cronometro registra è viaggio.
 */
export async function misuraViaggio(): Promise<RisultatoSonda> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };

  const service = getServiceClient();
  const giriDb: number[] = [];
  for (let i = 0; i < GIRI; i++) {
    const partenza = performance.now();
    const { error } = await service.from('sectors').select('id').limit(1);
    if (error) return { ok: false, error: `Il database non risponde: ${error.message}` };
    giriDb.push(Math.round(performance.now() - partenza));
  }

  // L'autenticazione con un client NUOVO a ogni giro, e non con
  // `getSessionUser`: quello è memoizzato per richiesta, quindi dal secondo
  // giro in poi risponderebbe dalla memoria e misurerebbe zero. Qui serve il
  // costo vero, quello che il middleware paga su ogni navigazione.
  const giriAuth: number[] = [];
  for (let i = 0; i < GIRI; i++) {
    const client = await createSupabaseServerClient();
    const partenza = performance.now();
    await client.auth.getUser();
    giriAuth.push(Math.round(performance.now() - partenza));
  }

  const db = riassumiMisure(giriDb);
  const auth = riassumiMisure(giriAuth);

  return {
    ok: true,
    data: {
      database: { minimo: db.minimo, mediana: db.mediana, primo: db.primo, giri: db.giri },
      autenticazione: { minimo: auth.minimo, giri: auth.giri },
      giudizio: giudicaDistanza(db.minimo),
      regione: process.env.VERCEL_REGION ?? null,
      // Non è misurata: è dichiarata dal progetto Supabase, e serve solo a
      // dire A QUALE regione allineare le funzioni se risultano lontane.
      regioneDatabase: 'eu-west-1 (Irlanda)',
    },
  };
}
