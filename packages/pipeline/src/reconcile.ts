// ---------------------------------------------------------------------------
// Batch bloccati: il presidio che guarda tutti gli altri.
//
// Le difese scritte finora coprono *una causa alla volta*: la scrittura che
// fallisce, il credito che non torna, l'errore che non risale. Ma un batch si
// pianta anche per ragioni che nessun controllo puntuale intercetta:
//
//   - il processo muore fra `reserve_credits` e la creazione dei job;
//   - il messaggio in coda si perde, o viene cancellato per sbaglio;
//   - l'invocazione serverless viene interrotta a metà generazione;
//   - l'aggiornamento di stato non passa (ora lascia una traccia, ma la
//     traccia non ripara niente).
//
// Il sintomo però è sempre lo stesso: **un batch fermo in uno stato di lavoro
// senza niente che stia lavorando**. Questa funzione cerca quel sintomo e
// rimette le cose a posto, qualunque sia stata la causa.
//
// Gira dentro il cron del drain, quando la coda è vuota. Deve poter girare
// ogni minuto senza fare danni: ogni riparazione è idempotente, e nessuna
// tocca qualcosa che si è mosso di recente.
//
// Non copre l'analisi foto: quella ha già il suo recupero delle esecuzioni
// bloccate in `resumeVisualAnalysis` (claim scaduto → si riprende).
// ---------------------------------------------------------------------------

import { queueSend, type TypedClient } from '@app/database';
import { writeOrTrace } from './trace.js';
import { creditOp } from './credits.js';

/** Stati in cui un batch sta aspettando che qualcuno lavori per lui. */
const STATI_DI_LAVORO = ['queued', 'processing'] as const;

/** Stati in cui un job non si muoverà più da solo. */
const STATI_TERMINALI = ['completed', 'needs_review', 'failed', 'canceled'] as const;

/**
 * Quanto deve stare fermo qualcosa prima di considerarlo bloccato.
 *
 * Il drain gira ogni minuto e ha 5 minuti di tempo massimo: dieci minuti di
 * immobilità non sono spiegabili con del lavoro in corso. Sotto questa soglia
 * si rischia di "riparare" qualcosa che sta semplicemente lavorando.
 */
export const FERMO_DA_MS = 10 * 60 * 1000;

/** Quanti batch guardare per giro: il cron ha un tempo, non deve esaurirlo qui. */
const MAX_BATCH_PER_GIRO = 20;

export interface EsitoRiconciliazione {
  /** Batch in lavorazione senza un solo job: l'accodamento non è mai finito. */
  fantasma: number;
  /** Batch con tutti i job finiti ma lo stato rimasto indietro. */
  chiusi: number;
  /** Job fermi in 'processing': l'esecuzione è morta a metà. */
  jobRipresi: number;
  /** Crediti riservati e mai sciolti, restituiti all'organizzazione. */
  creditiRestituiti: number;
}

interface Opzioni {
  /** Iniettabile per i test: nessuna dipendenza nascosta dall'orologio. */
  adesso?: number;
  fermoDaMs?: number;
  /** Quando scade il tempo del cron. */
  deadline?: number;
}

/**
 * Cerca i batch fermi e li rimette in carreggiata.
 *
 * Non lancia mai: è un presidio, e un presidio che fa cadere il cron avrebbe
 * l'effetto opposto a quello per cui esiste.
 */
export async function riconciliaBatchBloccati(
  client: TypedClient,
  opts: Opzioni = {},
): Promise<EsitoRiconciliazione> {
  const esito: EsitoRiconciliazione = { fantasma: 0, chiusi: 0, jobRipresi: 0, creditiRestituiti: 0 };
  const adesso = opts.adesso ?? Date.now();
  const fermoDa = opts.fermoDaMs ?? FERMO_DA_MS;
  const sogliaIso = new Date(adesso - fermoDa).toISOString();

  const { data: batches } = await client
    .from('batches')
    .select('id, organization_id, status, credits_reserved, updated_at')
    .in('status', [...STATI_DI_LAVORO])
    .lt('updated_at', sogliaIso)
    .order('updated_at', { ascending: true })
    .limit(MAX_BATCH_PER_GIRO);

  for (const batch of batches ?? []) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    if (!batch.organization_id) continue;

    const { data: jobs } = await client
      .from('job_items')
      .select('id, status, updated_at')
      .eq('batch_id', batch.id);
    const elenco = jobs ?? [];

    // --- 1. Batch fantasma: riservato, mai accodato --------------------------
    if (elenco.length === 0) {
      // I crediti erano già stati messi da parte per questo batch: senza
      // restituirli restano bloccati e il saldo scende senza motivo.
      const daRestituire = batch.credits_reserved ?? 0;
      if (daRestituire > 0) {
        const restituiti = await creditOp(
          client,
          'release_credits',
          { org: batch.organization_id, amt: daRestituire, ref_type: 'batch_bloccato', ref_id: batch.id },
          { organizationId: batch.organization_id, batchId: batch.id, refId: batch.id },
        );
        if (restituiti) esito.creditiRestituiti += daRestituire;
      }
      // `credits_reserved` a zero nello stesso passaggio dello stato: è quello
      // che rende sicuro rieseguire questa funzione ogni minuto.
      await writeOrTrace(
        client,
        'batches.update(fantasma)',
        client
          .from('batches')
          .update({ status: 'sample_ready', credits_reserved: 0 })
          .eq('id', batch.id)
          .in('status', [...STATI_DI_LAVORO]),
        { organizationId: batch.organization_id, batchId: batch.id, refId: batch.id },
      );
      esito.fantasma++;
      continue;
    }

    // --- 2. Job fermi a metà -------------------------------------------------
    const appesi = elenco.filter((j) => j.status === 'processing' && (j.updated_at ?? '') < sogliaIso);
    for (const job of appesi) {
      // Torna in coda con un update CONDIZIONATO: se nel frattempo è ripartito
      // davvero, la condizione non è più vera e non lo si disturba.
      const { data: ripreso } = await client
        .from('job_items')
        .update({ status: 'queued' })
        .eq('id', job.id)
        .eq('status', 'processing')
        .select('id');
      if (!ripreso || ripreso.length === 0) continue;
      try {
        // Rimandarlo in coda può produrre un doppione se il messaggio originale
        // esiste ancora. Costa zero: la generazione riconosce l'`input_hash` e
        // il secondo giro è una cache hit, non una chiamata al modello.
        await queueSend(client, { jobItemId: job.id });
        esito.jobRipresi++;
      } catch {
        /* il giro dopo riprova: lo stato è già tornato 'queued' */
      }
    }

    // --- 3. Lavoro finito, stato rimasto indietro ----------------------------
    // `elenco` e' l'istantanea letta prima delle riprese qui sopra: un job
    // appena rimesso in coda risulta ancora 'processing', quindi non terminale,
    // e il batch non viene chiuso in questo giro. E' voluto.
    const tuttiFiniti = elenco.every((j) => (STATI_TERMINALI as readonly string[]).includes(j.status));
    if (tuttiFiniti) {
      const falliti = elenco.filter((j) => j.status === 'failed').length;
      const conclusi = elenco.filter((j) => j.status === 'completed' || j.status === 'needs_review').length;
      const stato = falliti === 0 ? 'completed' : conclusi === 0 ? 'failed' : 'partial_failed';
      const chiuso = await writeOrTrace(
        client,
        'batches.update(chiusura_tardiva)',
        client
          .from('batches')
          .update({
            status: stato,
            processed_products: conclusi,
            failed_products: falliti,
            completed_at: new Date(adesso).toISOString(),
          })
          .eq('id', batch.id)
          .in('status', [...STATI_DI_LAVORO]),
        { organizationId: batch.organization_id, batchId: batch.id, refId: batch.id },
      );
      if (chiuso) esito.chiusi++;
    }
  }

  return esito;
}
