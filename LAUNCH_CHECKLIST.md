# Checklist per il lancio — Schede AI

Documento vivo: aggiornato man mano. `[x]` = fatto · `[ ]` = da fare.

## A. Servizi & configurazione (azioni tue)

- [x] Upgrade **Vercel Pro** (necessario per il cron ogni minuto)
- [x] Upgrade **Supabase Pro** (niente pausa, storage/DB adeguati)
- [x] **`CRON_SECRET`** nelle env di Vercel (accende il worker in background)
- [x] **`RESEND_API_KEY`** nelle env di Vercel (invio email)
- [x] **Credito OpenRouter** caricato *(da tenere sempre rifornito: se va a zero la generazione fallisce)*
- [ ] **Comprare un dominio** (~10€/anno) — serve per l'email a tutti gli utenti
- [ ] **Verificare il dominio su Resend** (record DNS SPF/DKIM) → poi impostare **`RESEND_FROM`** su Vercel (es. `Schede AI <noreply@tuodominio>`). Finché non fatto, le email arrivano **solo al tuo indirizzo**.
- [ ] **`NEXT_PUBLIC_APP_URL`** su Vercel = URL di produzione (per link email/redirect corretti)
- [ ] **Stripe** (quando inizi a vendere): chiavi vere `sk_...` / `pk_...`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PACK_50/200/500`, endpoint webhook `…/api/stripe/webhook`
- [ ] **SMTP di produzione per il login** (dopo il dominio): collegare Resend come SMTP su Supabase Auth (host/porta/utente in `DEPLOYMENT.md`)

## B. Roadmap prodotto (le faccio io)

- [x] **#1 — Pipeline in background** (generazione via cron, home con batch live, barra analisi foto, email a fine generazione)
- [x] **#2 — Feedback per campo + "Migliora la pipeline"**
- [x] **#3 — Inbox dei "dubbi" dell'AI** (badge notifica, l'utente risponde, il dato si corregge)
- [ ] **#4 — Dashboard admin per te** (consumi, utenti, spesa) + **stima costo/prodotto** + **fee di generazione** *(dopo aver confermato che l'app funziona bene)*
- [ ] Varianti colore/taglia
- [ ] Controllo qualità immagini + suggerimento foto mancanti
- [ ] *(opzionale)* Spostare l'analisi foto completamente in background (zero attese, ma niente revisione categorie prima di generare)

## C. Verifiche prima del lancio pubblico

- [ ] Test end-to-end con **AI reale** su ogni sorgente (Excel, foto, URL) e qualità schede ok
- [ ] Provata l'email di fine generazione (arriva, link corretto)
- [ ] Provato l'acquisto crediti (Stripe test) → saldo aggiornato
- [ ] Pagine legali/privacy ok, cookie banner ok
- [ ] Un dominio "vero" collegato a Vercel (facoltativo ma consigliato per l'immagine)
