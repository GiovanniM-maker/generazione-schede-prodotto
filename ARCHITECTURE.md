# Architettura

## Diagramma dei componenti

```
Browser
  │
  ▼
Next.js (apps/web)
  ├── Supabase Auth (magic link, SSR, cookie)
  ├── PostgreSQL con RLS (lettura dati tenant, publishable key)
  ├── Supabase Storage privato (upload/download firmati)
  ├── Stripe Checkout + webhook firmato
  ├── generazione CAMPIONE (sincrona, @app/pipeline)
  └── creazione job BULK (enqueue → coda)
          │
          ▼
   Supabase Queue (PGMQ "generation_jobs")   ← messaggio = { jobItemId }
          │
          ▼
   Worker (apps/worker, service role)
      ├── rilegge prodotto + fatti dal DB
      ├── costruisce input verificato (solo fatti ammessi)
      ├── chiama OpenAI (o mock)
      ├── esegue fact audit (deterministico + AI)
      ├── salva product_generation + generation_run
      ├── consuma/rimborsa credito (ledger)
      └── aggiorna progresso del batch
```

Le richieste HTTP non restano aperte durante la generazione bulk: la generazione
completa è asincrona. Solo il campione è sincrono. Il messaggio in coda contiene
esclusivamente identificativi; il worker rilegge i dati dal database.

## Confini dei componenti

- **packages/core** — logica pura, nessuna dipendenza da rete/DB/AI. È il cuore
  testabile: parsing, normalizzazione, mapping, qualità, hash, fact-audit, claim
  detector, protezione CSV injection, crediti (logica), state machine, export,
  schemi Structured Output. Non importa `@app/database` né `@app/ai`.
- **packages/ai** — adapter verso i modelli. La business logic dipende dalle
  interfacce (`ProductCopyProvider`, `FactAuditProvider`, ...), mai dall'SDK.
  Provider OpenAI (Responses API, `store:false`, Structured Outputs strict) e
  provider mock deterministico.
- **packages/database** — tipi DB versionati, client service-role, helper coda.
- **packages/pipeline** — orchestrazione che combina core + ai + database. Usata
  sia dal worker (bulk) sia dal web (campione). Unica sede della sequenza
  "carica fatti → genera → audit → salva → credito".
- **packages/config** — schema env (Zod) e costanti; impone che i mock siano
  disattivi in produzione.
- **apps/web** — UI + API. Legge i dati sotto RLS con la publishable key; le
  operazioni sensibili (crediti, coda, Stripe) usano la service-role key
  server-side.
- **apps/worker** — nessuna UI; loop sulla coda con concorrenza, retry, health.

## Flusso dati (import → export)

1. Upload file → Storage privato (`source-files`), hash SHA-256, `source_files`.
2. Parsing server-side (CSV/XLSX) → header rilevati.
3. Mapping deterministico header→campo (sinonimi IT/EN); conferma utente.
4. Costruzione prodotti canonici + varianti + evidenze; `data_quality_score`.
5. Profilo tono (versionato) generato/approvato.
6. Campione sincrono con fact-audit.
7. Enqueue: verifica/riserva crediti (advisory lock) → `job_items` → messaggi.
8. Worker: genera, audit, salva, consuma credito, aggiorna batch.
9. Revisione bulk: edit (salvato separato), accetta/rifiuta, rigenera.
10. Export CSV/XLSX (testo editato preferito, no severità high, anti-injection) →
    bucket `exports` → signed URL.

## State machine

**Batch:** draft → uploaded → mapping → input_review → tone_setup →
sample_pending → sample_ready → approved → queued → processing →
{completed | partial_failed | failed}; `canceled` da molti stati;
`partial_failed`/`failed` → queued (retry).

**Job item:** pending → queued → processing → {completed | needs_review | failed};
failed → queued (retry); needs_review → completed.

Le transizioni valide sono codificate ed esposte da `@app/core/stateMachine`.

## Coda

PGMQ (`generation_jobs`) via wrapper RPC `queue_send/read/delete/archive`
(SECURITY DEFINER, solo `service_role`). Retry tramite *visibility timeout*: un
job ritentabile non viene eliminato e riappare dopo il timeout; il worker
incrementa i tentativi e rispetta `MAX_JOB_ATTEMPTS`. Errori non recuperabili
(validation) non vengono ritentati.

## LLM

Prompt costruiti solo attorno ai fatti ammessi (stati `provided/extracted/
confirmed`). Gli attributi `inferred_visual`/`needs_review` non confermati non
entrano tra i fatti. Output validato con JSON Schema strict + Zod. Un fact-audit
deterministico blocca i claim sensibili non supportati (severità `high` → non
esportabile); l'audit AI può alzare la severità a `medium`.

## Caching / idempotenza

`input_hash = sha256(fatti canonici + preset version + brand profile version +
prompt version + modello + output richiesto)`. Se esiste una generazione con lo
stesso hash, viene riusata: nessuna chiamata al modello, nessun credito
consumato (il credito riservato viene rilasciato), cache hit registrato. La
modifica manuale del testo è salvata separatamente e non altera l'output
originale.

## Multi-tenancy

Ogni tabella tenant ha RLS basata su `is_organization_member()` /
`is_organization_owner()` (SECURITY DEFINER, leggono `organization_members`, mai
metadata client-controllabili). Le tabelle sensibili (ledger, stripe_events,
job/generation) non sono scrivibili dal browser: solo service-role (worker/API).
Storage scoped per primo segmento di path = `organization_id`.
