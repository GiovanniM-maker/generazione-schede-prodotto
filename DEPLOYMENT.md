# Deployment

## Panoramica

| Componente | Piattaforma consigliata |
|-----------|--------------------------|
| Web (Next.js) | Vercel |
| Database/Auth/Storage/Queue | Supabase hosted |
| Worker | Docker su Railway / Render / Fly.io |

## 1. Supabase hosted

1. Crea un progetto su https://supabase.com.
2. Collega il repo o usa la CLI:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push          # applica le migrazioni di supabase/migrations
   ```
3. Esegui il seed una tantum (preset Moda, pacchetti, coda):
   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/seed.sql
   ```
4. Verifica che l'estensione **pgmq** sia abilitata (Database → Extensions).
5. Prendi dalle impostazioni API: `Project URL`, `anon/publishable key`,
   `service_role key`.

## 2. Vercel (web)

- Importa il repo, root del progetto = repository (monorepo pnpm).
- Build command: `pnpm build` — Output: gestito da Next.
- Variabili d'ambiente (Production):
  ```
  NEXT_PUBLIC_APP_URL=https://<dominio>
  NEXT_PUBLIC_SUPABASE_URL=...
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
  SUPABASE_SERVICE_ROLE_KEY=...          (Encrypted)
  SUPABASE_DB_URL=...                     (Encrypted)
  OPENAI_API_KEY=...                      (Encrypted)
  OPENAI_MODEL_COPY=gpt-4o-mini
  STRIPE_SECRET_KEY=...                   (Encrypted)
  STRIPE_WEBHOOK_SECRET=...               (Encrypted)
  STRIPE_PRICE_PACK_50=price_...
  STRIPE_PRICE_PACK_200=price_...
  STRIPE_PRICE_PACK_500=price_...
  ENABLE_MOCK_AI=false
  ENABLE_MOCK_BILLING=false
  ```
- L'app **rifiuta l'avvio** se un mock è attivo in produzione.

## 3. Worker (Docker)

```bash
docker build -f apps/worker/Dockerfile -t schede-worker .
docker run --env-file .env.worker.prod schede-worker
```

Variabili minime del worker:
```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
OPENAI_MODEL_COPY=gpt-4o-mini
WORKER_CONCURRENCY=3
WORKER_VISIBILITY_TIMEOUT_SECONDS=300
MAX_JOB_ATTEMPTS=3
ENABLE_MOCK_AI=false
WORKER_HEALTH_PORT=8080
```

Health check: `GET :8080/health` (usato anche dallo `HEALTHCHECK` del Dockerfile).
Su Railway/Render imposta lo start command a `node dist/index.js` (già `CMD`).

## 4. Migrazioni in produzione

- Applica sempre con `supabase db push` (mai modificare a mano le versioni
  pubblicate del preset: sono immutabili).
- Dopo modifiche allo schema, rigenera i tipi:
  `supabase gen types typescript --linked > packages/database/src/generated/database.types.ts`.

## 5. Webhook Stripe

1. Crea l'endpoint `https://<dominio>/api/stripe/webhook` nel dashboard Stripe.
2. Evento minimo: `checkout.session.completed`.
3. Copia il *Signing secret* in `STRIPE_WEBHOOK_SECRET`.
4. Crea i tre Price one-time (pacchetti 50/200/500) e mappa gli id nei
   `STRIPE_PRICE_PACK_*`.

## 6. Smoke test post-deploy

1. Apri la landing → CTA → registrazione (magic link) → login.
2. Onboarding: crea profilo tono.
3. Carica `fixtures/fashion-valid.csv` → mapping → import.
4. Genera campione → approva tono.
5. Acquista un pacchetto crediti (Stripe test) → verifica saldo.
6. Genera in massa → il worker elabora → progresso → risultati.
7. Esporta CSV e XLSX → apri il file firmato.
8. Verifica: `GET /health` del worker = 200; nessun segreto nei log.
