# Piano di implementazione — Generatore AI Schede Prodotto Moda

Repository vuoto all'avvio. Costruzione MVP self-serve italiano.

## Decisioni architetturali chiave

- **Monorepo**: pnpm workspaces, TypeScript strict. No Turborepo (non necessario).
- **Web**: Next.js App Router + React + Tailwind + shadcn/ui + Zod + Supabase SSR.
- **Worker**: Node/TS separato, consuma Supabase Queue (PGMQ), Dockerfile.
- **DB/Auth/Storage/Queue**: Supabase (Postgres + RLS + Storage privato + PGMQ).
- **AI**: adapter pattern (interfacce in `packages/ai`), provider OpenAI (Responses API + Structured Outputs) + provider mock deterministico. Modelli via env, mai hardcoded.
- **Pagamenti**: Stripe Checkout one-time (pacchetti crediti), webhook firmati idempotenti. Provider mock in dev/test.
- **Crediti**: ledger append-only, saldo = somma ledger (funzione SQL). Nessuna colonna mutabile.

## Principio fondamentale

I dati possiedono i fatti. L'AI possiede la prosa. Nessun attributo inventato.
Ogni attributo ha valore + origine + stato di verifica. `inferred_visual`/`needs_review`
non usabili come fatti finché non confermati.

## Ordine di costruzione

1. Fondamenta: workspace, config, tsconfig, lint, test framework.
2. `packages/config`: costanti, env schema (Zod), guardie mock-in-prod.
3. `packages/core`: dominio testabile — normalizzazione header, mapping, parsing CSV/XLSX,
   data quality, variant grouping, input hash, prompt builder, fact-claim detector,
   CSV injection, credit ledger, state machine, export. **Test unitari + golden tests.**
4. `packages/ai`: interfacce + OpenAI + mock providers.
5. `supabase/`: migrazioni (tabelle, enum, funzioni, trigger, RLS), seed (preset Moda), test SQL.
6. `packages/database`: tipi generati/versionati + client factory.
7. `apps/web`: landing, auth, dashboard, flusso batch, API routes (stripe), server actions.
8. `apps/worker`: consumer queue, retry, idempotenza, graceful shutdown, health.
9. Docs + CI + Dockerfile.

## Note su credenziali mancanti

Nessuna credenziale reale disponibile. Uso `.env.example`, mock adapter AI/billing,
istruzioni precise. L'app rifiuta di partire in produzione con mock attivi.
