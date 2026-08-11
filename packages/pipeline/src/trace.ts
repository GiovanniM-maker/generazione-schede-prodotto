// ---------------------------------------------------------------------------
// Scritture in background: dove non c'è nessuno a cui dirlo.
//
// `mustWrite` riporta l'esito al chiamante. Va benissimo in una server action:
// il chiamante è una funzione che risponde a una persona in attesa. Nel worker,
// nel cron e nelle analisi in coda quel chiamante non esiste — e infatti in
// quei punti l'esito veniva scartato: `mustWrite` col risultato buttato via è
// `logWrite` che finge di controllare.
//
// `console.error` non è una risposta: nei log di Vercel una riga scritta alle
// tre di notte da un cron non la legge nessuno. Serve una traccia che si possa
// *interrogare*, e la tabella `app_events` esiste già per questo.
//
// Regola di scelta, in breve:
//
//   utente in attesa, azione che ritorna ActionResult → mustWrite + return fail
//   utente in attesa, azione che lancia               → writeOrThrow
//   background, lo stato sbagliato ha conseguenze     → writeOrTrace  ← questo
//   davvero accessoria (telemetria, contatori)        → logWrite
// ---------------------------------------------------------------------------

import { mustWrite, type WriteOutcome } from '@app/core';
import type { TypedClient, Json } from '@app/database';

export interface TraceContext {
  /** Puo' essere null: i casi "organizzazione mancante" vanno tracciati lo stesso. */
  organizationId: string | null;
  /** Il batch a cui si riferisce, quando c'è: rende la traccia filtrabile. */
  batchId?: string | null;
  /** Job, prodotto, sorgente: quel che serve per ritrovare la riga. */
  refId?: string | null;
  /**
   * Nome dell'evento, quando il caso merita di distinguersi nell'elenco.
   * I crediti sì: chi guarda `app_events` deve fermarsi subito su quelli.
   */
  evento?: string;
  /** Dettagli in più da conservare nella traccia (argomenti, contatori). */
  dettagli?: Record<string, unknown>;
}

/** Nome dell'evento sotto cui finiscono tutti i fallimenti di scrittura. */
export const EVENTO_SCRITTURA_FALLITA = 'write_failed';

/**
 * Esegue una scrittura e, se fallisce, lascia una riga interrogabile in
 * `app_events` oltre al log del server.
 *
 * Ritorna `true` se è andata. Chi chiama di solito prosegue comunque — in un
 * worker interrompere significherebbe buttare via lavoro già pagato — ma la
 * discrepanza smette di essere invisibile.
 */
export async function writeOrTrace(
  client: TypedClient,
  what: string,
  op: PromiseLike<WriteOutcome>,
  ctx: TraceContext,
): Promise<boolean> {
  const esito = await mustWrite(what, op);
  if (esito.ok) return true;

  // La segnalazione non deve poter far cadere il flusso che sta proteggendo:
  // se anche questa fallisce resta il console.error di `mustWrite`.
  const evento = ctx.evento ?? EVENTO_SCRITTURA_FALLITA;
  await mustWrite(
    `app_events.insert(${evento})`,
    client.from('app_events').insert({
      organization_id: ctx.organizationId,
      event_name: evento,
      batch_id: ctx.batchId ?? null,
      metadata_json: {
        operazione: what,
        errore: esito.error,
        riferimento: ctx.refId ?? null,
        ...(ctx.dettagli ?? {}),
      } as unknown as Json,
    }),
  );
  return false;
}
