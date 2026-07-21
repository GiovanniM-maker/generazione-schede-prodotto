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

## 3. Elaborazione dei job (worker)

La generazione di massa mette i job in coda (PGMQ su Postgres). Qualcuno deve
svuotare la coda. Due modalità, da scegliere in base ai volumi:

### Fase 1 — Vercel Cron (consigliata per iniziare, zero infrastruttura)

`apps/web/vercel.json` registra un cron che ogni minuto chiama
`GET /api/cron/drain`. Vercel aggiunge in automatico l'header
`Authorization: Bearer $CRON_SECRET`: la route accetta solo richieste con quel
segreto. Così i job vengono elaborati **anche a pagina chiusa**, senza processi
separati.

Requisiti:
- Imposta la variabile `CRON_SECRET` (stringa casuale) tra le env del progetto
  Vercel. La stessa route la usa per autenticare il cron.
- Il cron a 1 minuto richiede il piano **Vercel Pro** (l'Hobby limita a 1/giorno).
- Ogni invocazione ha `maxDuration` 300s e processa in blocchi da 5; se resta
  lavoro, il minuto dopo riprende (la *visibility timeout* di PGMQ evita doppie
  elaborazioni). La stessa route è anche chiamata in `POST` dalla pagina
  "Elaborazione in corso" mentre l'utente la tiene aperta, per accelerare.

### Fase 2 — Worker dedicato (per volumi grandi, migliaia di prodotti)

Quando i volumi crescono, affianca (o sostituisci) il cron con un processo
sempre attivo, senza limiti di durata serverless:

```bash
docker build -f apps/worker/Dockerfile -t schede-worker .
docker run --env-file .env.worker.prod schede-worker
```

Le due modalità **convivono** senza conflitti: la coda è la stessa e la
*visibility timeout* garantisce che un job sia preso da uno solo alla volta.

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

## 3-bis. Accesso via codice email (OTP) + SMTP di produzione

L'accesso avviene **senza password**: l'utente riceve un **codice a 6 cifre**
via email e lo inserisce (`/login`). Nessun magic link da cliccare (resta solo
come fallback nel testo dell'email).

Configurazione già applicata sul progetto Supabase (via Management API):
- `mailer_otp_length = 6` (codice a 6 cifre).
- Template email "Magic Link" con `{{ .Token }}` in evidenza + oggetto in
  italiano. Il codice scade dopo 60 minuti (`mailer_otp_exp`).

**SMTP di produzione (obbligatorio prima del lancio).** L'email integrata di
Supabase è solo per lo sviluppo (poche mail/ora): in produzione i codici non
arriverebbero. Collega **Resend**:

1. Crea un account su [resend.com](https://resend.com) e **verifica il dominio**
   di invio (record DNS SPF/DKIM che Resend fornisce).
2. Genera una **API key** Resend.
3. In Supabase → *Authentication → Emails → SMTP Settings* (oppure via
   Management API `config/auth`) imposta:
   ```
   smtp_host   = smtp.resend.com
   smtp_port   = 465
   smtp_user   = resend
   smtp_pass   = <RESEND_API_KEY>
   smtp_admin_email = accessi@<tuo-dominio>   (mittente verificato su Resend)
   smtp_sender_name = Schede AI
   ```
4. Alza i rate limit email in *Authentication → Rate Limits* (l'integrata è
   volutamente bassa).

> Dopo aver collegato Resend, il flusso è identico: `signInWithOtp` invia il
> codice, l'utente lo inserisce, `verifyOtp` crea la sessione. Nessuna modifica
> al codice dell'app è necessaria.

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

1. Apri la landing → CTA → login → inserisci il codice a 6 cifre ricevuto via email.
2. Onboarding: crea profilo tono.
3. Carica `fixtures/fashion-valid.csv` → mapping → import.
4. Genera campione → approva tono.
5. Acquista un pacchetto crediti (Stripe test) → verifica saldo.
6. Genera in massa → il worker elabora → progresso → risultati.
7. Esporta CSV e XLSX → apri il file firmato.
8. Verifica: `GET /health` del worker = 200; nessun segreto nei log.
