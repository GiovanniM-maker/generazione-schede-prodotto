# Sicurezza

## Threat model minimo

| Minaccia | Mitigazione |
|---------|-------------|
| Accesso cross-tenant ai dati | RLS su tutte le tabelle tenant via `is_organization_member()` |
| Escalation crediti dal client | Ledger e funzioni crediti non scrivibili dal browser; solo service-role/SQL |
| Falsificazione pagamenti | Webhook Stripe con firma verificata + idempotenza; crediti applicati server-side |
| Manomissione file / path traversal | Nomi sanificati, path `org/batch/uuid`, bucket privati, validazione MIME+estensione |
| CSV/formula injection nell'export | Neutralizzazione celle che iniziano con `= + - @` (apostrofo) |
| Prompt injection / invenzione attributi | Solo fatti ammessi nei prompt; fact-audit deterministico blocca claim sensibili |
| Fuga di segreti | service-role mai nel browser/bundle/log; env validato; niente contenuti completi nei log |
| Furto sessione | Cookie SSR Supabase, magic link, redirect verificati |

## Row Level Security

- Funzioni stabili `is_organization_member(org)` e `is_organization_owner(org)`
  (SECURITY DEFINER) leggono `organization_members` — **mai** metadata del JWT
  controllabili dal client.
- Un utente vede/modifica solo i dati delle proprie organizzazioni.
- Tabelle **non** scrivibili dal browser: `credit_ledger`, `stripe_events`,
  `job_items`, `generation_runs`, `product_generations` (solo service-role).
- Preset di sistema: leggibili dagli autenticati, non modificabili.
- Test RLS in `supabase/tests/rls.test.sql` (cross-tenant, ledger, stripe, ecc.).
- La service-role key bypassa la RLS: usata solo da worker e route server-side.

## File e storage

- Bucket privati: `source-files`, `product-assets`, `exports`. Nessun bucket
  pubblico.
- Upload: validazione estensione **e** MIME (mai fidarsi del solo MIME del
  browser), limiti dimensione, hash SHA-256, nomi sanificati.
- `.xlsm`/macro rifiutati; nessuna formula Excel valutata (si legge solo il
  risultato/testo delle celle).
- Download tramite signed URL temporanei.

## Webhook

- Body **raw**, firma verificata con `STRIPE_WEBHOOK_SECRET`.
- Idempotenza a due livelli: unique su `stripe_events.stripe_event_id` e guardia
  in `apply_credit_purchase` (nessun doppio accredito sullo stesso evento).
- I crediti si assegnano solo se `payment_status = paid`.

## Dati AI

- Nel prompt entrano solo i fatti ammessi del singolo prodotto: nessun dato di
  altri tenant, nessun segreto, nessun prodotto non necessario.
- `store:false` nelle chiamate OpenAI.
- Output validato (JSON Schema strict + Zod). Il testo generato è archiviato come
  testo semplice e **mai** reso con `dangerouslySetInnerHTML`.
- Mock AI offline per sviluppo/test: nessuna chiamata di rete.

## Gestione segreti

- Nessun segreto hardcoded nel repo; tutto via env validato da `@app/config`.
- `NEXT_PUBLIC_*` = uniche variabili esposte al browser (publishable key).
- I mock (`ENABLE_MOCK_AI`, `ENABLE_MOCK_BILLING`) sono vietati in produzione:
  l'app rifiuta di avviarsi.

## Rate limiting

Le generazioni bulk passano dalla coda con concorrenza controllata dal worker;
il campione è limitato a un numero ragionevole di rigenerazioni per batch. Un
rate limit applicativo più fine sugli endpoint è un miglioramento previsto.
