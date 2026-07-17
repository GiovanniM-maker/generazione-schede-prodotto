# Stato di implementazione

Legenda stato: ✅ completo · 🟡 parziale/da verificare live · ⬜ non iniziato.
Legenda test: **U** unit · **G** golden · **I** integrazione · **E2E** end-to-end ·
**SQL** test RLS · **—** nessun test automatico.

> Verifiche eseguite in questa sessione: `pnpm typecheck` (pulito), `pnpm lint`
> (pulito), `pnpm test` (52/52 verdi), `pnpm build` (5 package + Next web con 18
> route + bundle worker — tutti riusciti).
>
> Nota ambiente: in questo ambiente non erano disponibili il daemon Docker né la
> Supabase CLI, quindi la verifica *live* (avvio DB, worker end-to-end, build
> immagine Docker) non è stata eseguita qui. La logica di dominio è coperta da
> test unitari/golden eseguiti e verdi; lo schema SQL è stato applicato e testato
> contro un Postgres reale (con schemi Supabase stubbati) durante lo sviluppo.

| Funzione | Stato | Test | Note |
|---|---|---|---|
| Monorepo pnpm + TS strict | ✅ | — | workspace, tsconfig base, vitest, eslint |
| Env schema + guardie mock-in-prod | ✅ | — | `@app/config`, fail-fast |
| Parsing CSV (delimitatore, BOM, dup header, zeri SKU) | ✅ | U | `fixtures/*.csv` |
| Parsing XLSX (no formule) | ✅ | U | exceljs, solo risultati/testo |
| Mapping header IT/EN deterministico | ✅ | U | sinonimi preset |
| Costruzione prodotti canonici + evidenze | ✅ | U | provenienza per fatto |
| Raggruppamento varianti | ✅ | U | parent/child |
| Data quality score + eleggibilità | ✅ | U | 0–100, soglie |
| Hash idempotente | ✅ | U | serializzazione stabile |
| Fact-audit deterministico + claim detector | ✅ | G | claim sensibili bloccati |
| Protezione CSV injection | ✅ | U | `= + - @` |
| Crediti (logica ledger) | ✅ | U | saldo = somma, invarianti |
| State machine batch/job | ✅ | U | transizioni valide |
| Retry classification + backoff | ✅ | U | recuperabili vs no |
| Export builder (edit>generato, no high) | ✅ | U | colonne + extra fatti |
| Schemi Structured Output (JSON Schema + Zod) | ✅ | U | strict |
| Provider AI mock deterministico | ✅ | U | offline, warning/fail |
| Provider OpenAI (Responses API, store:false) | ✅ | — | struct outputs strict |
| Migrazioni DB (tabelle, enum, funzioni, trigger) | ✅ | SQL | 23 tabelle, 14 enum |
| RLS su tabelle tenant | ✅ | SQL | helper SECURITY DEFINER |
| Funzioni crediti transazionali (advisory lock) | ✅ | SQL | reserve/consume/release/purchase |
| Creazione organizzazione transazionale | ✅ | — | `create_organization_for_user` |
| Storage privato + policy per org | ✅ | — | 3 bucket, path scoping |
| Seed preset Moda (campi, sinonimi, regole) | ✅ | — | + pacchetti + coda |
| Coda PGMQ + wrapper RPC (service-role) | ✅ | — | `generation_jobs` |
| Pipeline generazione (facts→copy→audit→credito) | ✅ | — | cache/idempotenza |
| Enqueue batch (prenotazione crediti) | ✅ | — | atomico |
| Gestione fallimenti/retry + rimborso credito | ✅ | U | codici normalizzati |
| Worker (loop, concorrenza, shutdown, health) | ✅ | U | tsup bundle, Dockerfile |
| Supabase SSR auth (magic link, middleware) | ✅ | — | protezione /app |
| API Stripe checkout (+ mock billing) | ✅ | — | prezzo risolto server-side |
| Webhook Stripe firmato + idempotente | ✅ | — | `checkout.session.completed` |
| API sample / enqueue / export | ✅ | — | ownership sotto RLS |
| Server actions (batch, upload, import, tono, results) | ✅ | — | persistenza + eventi |
| Landing pubblica | ✅ | — | headline/CTA/FAQ, nessun claim non provato |
| Login / dashboard / onboarding | ✅ | — | magic link, stepper tono |
| Flusso batch (new→mapping→input→sample→processing→results) | ✅ | — | build Next OK, 18 route |
| Billing UI | ✅ | — | pacchetti, cronologia ledger, checkout |
| Fixtures CSV/XLSX (validi/varianti/avversariali) | ✅ | G | usati dai test |
| CI GitHub Actions (lint/typecheck/test/build/docker/db) | ✅ | — | mock adapter |
| Documentazione (README/ARCH/DEPLOY/SECURITY) | ✅ | — | completa |
| Test E2E (Playwright) | 🟡 | E2E | scaffold; richiede servizi attivi |
| Inferenza visuale immagini | 🟡 | — | provider + whitelist; UI upload immagini minima |

## Limiti reali rimasti

- Verifica *live* end-to-end (DB reale + worker + build Docker) non eseguibile in
  questo ambiente (no Docker/Supabase CLI). Comandi e smoke test documentati.
- Upload/associazione immagini: adapter e whitelist presenti; l'estrazione visuale
  mock non produce attributi (sicuro). L'UI immagini è minima nell'MVP.
- E2E Playwright: scaffold presente, non eseguito (richiede stack attivo).
- Rate limiting applicativo fine sugli endpoint: non incluso (mitigato da coda).
