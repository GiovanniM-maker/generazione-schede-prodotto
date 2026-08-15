# Rilasciare

Due comandi e tre controlli. Il resto di questo file spiega perché sono in
quest'ordine.

## Prima: cosa manca a quel database

```bash
SUPABASE_PAT=sbp_… node scripts/registro-migrazioni.mjs stato <ref-del-progetto>
```

Stampa le migrazioni del repository che su quel database non sono ancora
passate. Se dice «Allineato», lo schema è già a posto e si va direttamente al
codice.

Fino al 15 agosto 2026 questa domanda non aveva risposta: né la produzione né
lo staging avevano `supabase_migrations.schema_migrations`, perché nessun
rilascio era mai passato da `supabase db push`. Le migrazioni si applicavano a
mano e da nessuna parte era scritto quali. Si è visto quanto costa: la
produzione era ferma alla 29, lo staging alla 36, e nessuno dei due lo sapeva.

## Poi: lo schema, prima del codice

```bash
supabase db push --project-ref <ref>
```

**Le migrazioni vanno prima.** Sono additive per costruzione: aggiungono
tabelle, colonne e funzioni senza togliere niente a quelle vecchie, quindi il
codice ancora in produzione continua a funzionare mentre lo schema è già
avanti. Al contrario — codice nuovo su schema vecchio — la prima pagina che
chiama una funzione che non esiste va in errore per tutti.

Se `db push` si ferma, si ferma **prima** che il codice nuovo sia online: è il
momento giusto per accorgersene.

## Infine: il codice

Il rilascio su Vercel. Da qui in poi il prodotto usa quello che le migrazioni
hanno appena messo.

## I tre controlli, dopo

1. **Una registrazione vera.** Crea un utente, entra, cancellalo. È l'unico
   modo di sapere che il percorso d'ingresso funziona, ed è quello che si rompe
   più facilmente perché tocca `auth`, il database e la posta insieme.

2. **La pagina della fatturazione.** Apre? Mostra il saldo con i lotti e le
   scadenze? Se `entitlements()` non fosse passata, è qui che si vede.

3. **Il registro.** Rilancia `stato`: deve dire «Allineato».

## Cose che si dimenticano

**Le variabili d'ambiente su Vercel** non sono nel repository e non le vede
nessun test: `SUPPORT_EMAIL`, `LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS`,
`LEGAL_EMAIL`, `LEGAL_CITY`, `NEXT_PUBLIC_APP_URL`. Senza le `LEGAL_*` le
pagine legali si dichiarano bozze — correttamente, ma non è ciò che si vuole
mostrare a un cliente.

**L'abbonamento** non si vende finché non c'è sia il prezzo ricorrente in
`STRIPE_PRICE_SUBSCRIPTION` sia la riga accesa a listino:

```sql
update billing_products set active = true where key = 'subscription';
```

**Gli eventi del webhook Stripe.** Oltre a `checkout.session.completed`
servono `invoice.paid`, `customer.subscription.updated` e
`customer.subscription.deleted`, altrimenti gli abbonamenti si creano e non si
rinnovano mai.

## Se una migrazione è già stata applicata a mano

Succede — è così che siamo arrivati fin qui. Si mette per iscritto invece di
lasciarlo alla memoria:

```bash
SUPABASE_PAT=sbp_… node scripts/registro-migrazioni.mjs segna <ref> 20250101000030-20250101000036
```

`segna` non esegue niente: dichiara che quelle migrazioni sono già passate, e
`db push` da lì in avanti le salta.
