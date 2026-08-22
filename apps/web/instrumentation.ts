// ---------------------------------------------------------------------------
// Gli errori del server, raccolti dove qualcuno li può leggere.
//
// COSA MANCAVA. `app/error.tsx` registra gli errori che arrivano al browser, e
// `writeOrTrace` quelli delle scritture rifiutate. In mezzo restava scoperta la
// categoria più grossa: un'eccezione dentro una server action, dentro una route
// handler, dentro il render di una pagina. Quelle finivano solo nei log di
// Vercel — che vanno aperti a mano, scadono, e nessuno guarda finché non è un
// cliente a scrivere che «non funziona».
//
// `onRequestError` è il gancio che Next chiama per ognuna di quelle. Da qui
// finiscono in `app_events` come tutti gli altri guasti, e da lì
// `lib/allarmi.ts` le manda per email.
//
// DUE REGOLE, ed è per queste che il file è più lungo di tre righe:
//
//   1. Non deve mai lanciare. Un raccoglitore di errori che fallisce mentre
//      raccoglie un errore trasforma un guasto in due, e il secondo lo vede
//      l'utente.
//   2. Non deve portarsi via i dati di nessuno. Niente corpo della richiesta,
//      niente intestazioni, niente parametri: solo il messaggio, il percorso e
//      il punto del codice. Un raccoglitore che archivia i dati dei clienti è
//      un problema più grande di quello che risolve.
// ---------------------------------------------------------------------------

/** Il nome sotto cui finiscono gli errori raccolti qui. Vedi `EVENTI_DI_GUASTO`. */
const EVENTO = 'errore_server';

interface ContestoErrore {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
}

interface RichiestaErrore {
  path?: string;
  method?: string;
}

export function register(): void {
  // Nessuna inizializzazione: il gancio è `onRequestError`. La funzione deve
  // comunque esistere, altrimenti Next non carica il file.
}

export async function onRequestError(
  err: unknown,
  request: RichiestaErrore,
  context: ContestoErrore,
): Promise<void> {
  // Il gancio gira anche nel runtime edge, dove non c'è il client Supabase.
  // Lì si esce: meglio nessuna riga che un'eccezione dentro l'eccezione.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    // Import dinamico: questo file viene caricato all'avvio di ogni runtime, e
    // tirarsi dietro il client del database in cima lo farebbe pagare a tutti —
    // anche alle richieste che non si rompono, cioè quasi tutte.
    const { getServiceClient } = await import('@/lib/supabase/service');

    const errore = err instanceof Error ? err : new Error(String(err));
    // La prima riga dello stack, non tutto: basta a dire dove, e uno stack
    // intero moltiplicato per un guasto ripetuto riempie la tabella.
    const punto = (errore.stack ?? '').split('\n')[1]?.trim().slice(0, 200) ?? null;

    const { error } = await getServiceClient()
      .from('app_events')
      .insert({
        event_name: EVENTO,
        metadata_json: {
          messaggio: errore.message.slice(0, 500),
          // `routePath` è il modello (`/app/batches/[batchId]`), `path` è
          // l'indirizzo vero. Si tiene il modello: raggruppa da solo, e non
          // porta con sé gli identificativi di nessuno.
          percorso: (context.routePath ?? request.path ?? '').slice(0, 200) || null,
          metodo: request.method ?? null,
          tipo: context.routeType ?? context.routerKind ?? null,
          punto,
        },
      });
    // Non si usa `logWrite`: quello vive in `@app/core` e andrebbe importato
    // dinamicamente anche lui. Qui l'errore si controlla a mano, che è la
    // stessa cosa in due righe.
    if (error) console.error(`[instrumentation] ${EVENTO} non registrato: ${error.message}`);
  } catch {
    // Regola 1. Se anche la registrazione fallisce resta il log di Vercel, che
    // è esattamente dove eravamo prima: si perde la raccolta, non la richiesta.
  }
}
