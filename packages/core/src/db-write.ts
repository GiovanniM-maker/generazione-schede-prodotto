// ---------------------------------------------------------------------------
// Scritture al database: l'errore non si butta via.
//
// Cinque volte lo stesso guaio, con sintomi diversi ogni volta:
//   - source_items.status = 'ready'        → Excel caricato ma mai collegato al batch
//   - batches.status = 'sources_selected'  → source_type NULL su tutti i batch
//   - batches.status = 'analysis'          → stato del batch mai aggiornato
//   - source_type = 'image_upload'         → "Registrazione sorgente fallita"
//   - id Stripe al posto di un UUID        → crediti non accreditati dopo il pagamento
//
// Causa identica: valore non valido per lo schema, Postgres rifiuta, l'errore
// non viene letto, l'app dice "fatto". La libreria Supabase *restituisce*
// l'errore invece di sollevarlo, quindi ignorarlo è la cosa più facile da
// scrivere. Queste due funzioni rendono esplicita la scelta:
//
//   mustWrite  → la scrittura conta. L'esito risale al chiamante.
//   logWrite   → la scrittura è accessoria (log, telemetria). L'errore finisce
//                comunque nei log del server, non sparisce.
//
// La regola di lint `no-restricted-syntax` impedisce di tornare alla forma
// `await client.from(...).insert(...)` con il risultato scartato.
// ---------------------------------------------------------------------------

/** Quel che serve di una risposta Supabase: solo l'errore. */
export interface WriteOutcome {
  error: { message: string } | null;
}

export interface WriteResult {
  ok: boolean;
  error: string | null;
}

/**
 * Scrittura che conta: esegue, e se fallisce logga e riporta l'errore.
 *
 * `what` descrive l'operazione in modo riconoscibile nei log del server
 * (es. `'preset_categories.insert'`). Non metterci dati personali.
 *
 * Un'eccezione (rete che cade, client che esplode) viene trattata come errore,
 * non propagata: il chiamante ha un solo modo di gestire il fallimento.
 */
export async function mustWrite(
  what: string,
  op: PromiseLike<WriteOutcome>,
): Promise<WriteResult> {
  try {
    const { error } = await op;
    if (error) {
      console.error(`[db] ${what} fallita: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[db] ${what} eccezione: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * Come `mustWrite`, ma il fallimento interrompe il flusso.
 *
 * Da usare dentro le azioni già avvolte in try/catch che traducono l'eccezione
 * in `{ ok: false, error }`: l'utente vede un errore vero invece di un "fatto"
 * che non è successo. Fuori da un try/catch NON usarla: preferisci `mustWrite`
 * e un return esplicito.
 */
export async function writeOrThrow(what: string, op: PromiseLike<WriteOutcome>): Promise<void> {
  const res = await mustWrite(what, op);
  if (!res.ok) throw new Error(`${what}: ${res.error}`);
}

/**
 * Scrittura accessoria: un log applicativo, un evento di telemetria. Se fallisce
 * il flusso principale deve continuare — ma l'errore resta visibile nei log.
 *
 * Usala SOLO quando la perdita del dato è davvero accettabile. Nel dubbio usa
 * `mustWrite`: costa una riga in più e ti risparmia un bug muto.
 */
export async function logWrite(what: string, op: PromiseLike<WriteOutcome>): Promise<void> {
  await mustWrite(what, op);
}
