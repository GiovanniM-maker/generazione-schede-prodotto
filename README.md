# Generatore AI di Schede Prodotto Moda

MVP SaaS self-serve italiano che trasforma cataloghi prodotto moda grezzi (CSV/XLSX)
in schede prodotto professionali e coerenti con il brand, generate in massa.

> **Principio fondamentale:** i dati possiedono i fatti, l'AI possiede la prosa.
> Il sistema non inventa mai materiali, composizioni, misure, certificazioni,
> impermeabilità, sostenibilità, origine o altri attributi non presenti nell'input.

## 1. Descrizione

L'utente crea un account, configura il tono del brand, carica un file, mappa le
colonne, controlla i dati, genera una scheda di prova, approva il tono, genera in
massa, revisiona ed esporta. Il valore non è "ChatGPT dentro un'app" ma:
elaborazione in massa, normalizzazione dei dati, distinzione fatti/prosa, blocco
delle invenzioni, coerenza di stile, revisione bulk ed export pronto all'uso.

## 2. Architettura (sintesi)

Monorepo **pnpm** + **TypeScript strict**.

```
apps/
  web/      Next.js App Router (landing, auth, flusso batch, API, Stripe)
  worker/   Worker Node/TS che consuma la coda PGMQ (generazione async)
packages/
  config/   env schema (Zod) + costanti + guardie mock-in-prod
  core/     dominio puro e testato (parsing, mapping, qualità, hash, fact-audit,
            claim detector, CSV injection, crediti, state machine, export, schemi)
  ai/       interfacce provider + OpenAI (Responses API) + mock deterministico
  database/ tipi DB versionati + service client + helper coda PGMQ
  pipeline/ orchestrazione generazione (facts→copy→audit→credito) + enqueue
supabase/   migrazioni SQL, funzioni, RLS, storage, seed, test RLS
fixtures/   CSV/XLSX di esempio (validi, varianti, mancanti, avversariali)
```

Dettagli in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 3. Prerequisiti

- Node.js ≥ 20 (consigliato 22)
- pnpm ≥ 10
- Docker + [Supabase CLI](https://supabase.com/docs/guides/cli) (per il DB locale)
- (Opzionale) Stripe CLI, chiave OpenAI

## 4. Installazione

```bash
pnpm install
cp .env.example .env            # root (worker + script)
cp .env.example apps/web/.env.local
cp .env.example apps/worker/.env
```

Compila almeno `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` con i valori mostrati da `supabase start`.
Per sviluppare senza servizi esterni lascia `ENABLE_MOCK_AI=true` e
`ENABLE_MOCK_BILLING=true`.

## 5. Supabase locale

```bash
supabase start            # avvia Postgres, Auth, Storage, Studio in Docker
```

`supabase start` stampa le chiavi locali: copia `anon key` in
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `service_role key` in
`SUPABASE_SERVICE_ROLE_KEY`.

## 6. Migrazioni

Le migrazioni sono in `supabase/migrations/` (enum → tabelle → funzioni → RLS →
storage → coda). Applicale con:

```bash
supabase db reset         # applica migrazioni + seed.sql (ricrea il DB locale)
```

## 7. Seed

`supabase/seed.sql` crea il preset di sistema **Moda** (campi, sinonimi IT/EN,
regole di validazione, policy di inferenza), i pacchetti crediti e la coda PGMQ
`generation_jobs`. Viene eseguito automaticamente da `supabase db reset`.

## 8. Avvio web

```bash
pnpm dev:web              # http://localhost:3000
```

## 9. Avvio worker

```bash
pnpm dev:worker           # consuma la coda, elabora i job in mock mode
```

## 10. Mock mode

Con `ENABLE_MOCK_AI=true` il provider AI è deterministico e offline (usa solo i
fatti, simula warning/fallimenti). Con `ENABLE_MOCK_BILLING=true` l'acquisto
crediti è simulato (accredito diretto). **Entrambi sono vietati in produzione**:
l'app rifiuta di partire se attivi con `NODE_ENV=production`.

## 11. Stripe CLI

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copia lo "whsec_..." in STRIPE_WEBHOOK_SECRET
```
Configura `STRIPE_SECRET_KEY` e i tre `STRIPE_PRICE_PACK_*` (Price one-time creati
nel dashboard Stripe) e imposta `ENABLE_MOCK_BILLING=false`.

## 12. OpenAI

Imposta `OPENAI_API_KEY` e `ENABLE_MOCK_AI=false`. I modelli sono configurabili via
`OPENAI_MODEL_COPY`, `OPENAI_MODEL_BRAND_PROFILE`, `OPENAI_MODEL_VISUAL`,
`OPENAI_MODEL_AUDIT` (default `gpt-4o-mini`, compatibile con Structured Outputs).

## 13. Test

```bash
pnpm test                 # unit + golden (Vitest) — usano adapter mock, nessun segreto
pnpm typecheck            # TypeScript strict su tutti i package
pnpm lint                 # ESLint
pnpm build                # build web + worker + package
```

Test end-to-end (Playwright) in `apps/web/e2e` — richiedono web + worker + Supabase
attivi: `pnpm --filter web test:e2e`.

## 14. Deploy

Web su **Vercel**, database/auth/storage su **Supabase hosted**, worker in
**Docker** (Railway/Render/Fly.io). Guida completa in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

```bash
docker build -f apps/worker/Dockerfile -t schede-worker .
```

## 15. Troubleshooting

- **"Configurazione ambiente non valida"**: manca una variabile richiesta; vedi
  l'elenco stampato e `.env.example`.
- **L'app non parte in produzione**: un mock è attivo (`ENABLE_MOCK_AI/BILLING`) —
  disattivali.
- **Il worker non elabora**: verifica che `supabase start` sia attivo, che la coda
  `generation_jobs` esista (seed) e che `SUPABASE_SERVICE_ROLE_KEY` sia corretta.
- **Webhook Stripe 400**: `STRIPE_WEBHOOK_SECRET` errato o body non raw.
- **SKU con zero iniziale alterato**: non usare Excel per riaprire il CSV; il
  sistema preserva gli zeri, i fogli di calcolo no.

Vedi anche [`SECURITY.md`](./SECURITY.md) e [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md).
