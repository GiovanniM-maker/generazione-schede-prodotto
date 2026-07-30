# Audit approfondito del progetto

Analisi su **codice + database di produzione + configurazione**.
Metodo: scansione sistematica del codice, query sul DB reale, verifica degli enum,
controllo di sicurezza su ogni azione server e route API.

---

## 1. Correzioni già fatte e in produzione

### Fallimenti silenziosi (la classe di bug più pericolosa)
Il codice scriveva valori **non validi** per gli enum del database. Postgres rifiuta
la scrittura, ma l'errore non veniva controllato → **l'operazione falliva senza che
nessuno se ne accorgesse**.

| Dove | Valore scritto | Effetto reale (verificato sul DB) |
|---|---|---|
| `source_items.status` | `'ready'` | Excel caricato ma **mai collegato al batch** → "solo immagini" |
| `batches.status` | `'sources_selected'` | `source_type` **NULL su tutti i batch** |
| `batches.status` | `'analysis'` | stato del batch mai aggiornato |

Ora i valori sono corretti e **gli errori vengono controllati**: un problema del
genere non può più passare inosservato.

### Timeout delle API (default Vercel: 10 secondi)
Tre route facevano lavoro lungo **senza dichiarare `maxDuration`** → venivano
troncate a metà, con errori generici per l'utente:

- `/sample` → analisi foto + generazione (30s+) — **causa di fallimenti del campione**
- `/export` → costruzione CSV/XLSX su cataloghi grandi
- `/copilot/transcribe` → trascrizione audio

### Performance
- **Export N+1**: una query per prodotto → **una sola query** per l'intero batch.

### Robustezza import
- **Excel multi-foglio**: veniva letto solo il primo foglio. Con un `Sheet1` di
  servizio e i dati sul secondo, l'import risultava vuoto **senza spiegazione**.
  Ora viene scelto il primo foglio che contiene davvero righe.

### Conteggi e messaggi
- "**0 idonei alla generazione**": il contatore usava una regola tarata sui campi
  moda; su cataloghi food dava 0 pur essendo i prodotti generabili.
- **Schede bloccate**: ora spiegano **perché** (manca SKU / nessun dato / conflitto /
  affermazione non supportata dai dati).

---

## 2. Verifiche superate (nessuna azione richiesta)

- **149 test** verdi, typecheck e lint puliti su tutti i pacchetti, build OK.
- **Sicurezza**
  - RLS attivo su **tutte** le tabelle.
  - **Nessuna azione server priva di controllo di proprietà** (verificate una per una).
  - Webhook Stripe: firma verificata. `/reanalyze`: protetto (auth + proprietà + rate limit).
  - Fetch da URL protetto da SSRF (blocco IP interni, redirect manuali, timeout, cap byte).
- **Dati**: ledger crediti bilanciato (232 riservati → 232 rilasciati, 208 consumati);
  nessun job bloccato o fallito; indici sulle foreign key presenti.
- **Configurazione**: validazione delle variabili d'ambiente con messaggi chiari all'avvio.

---

## 3. Piano — cosa resta, in ordine di priorità

### P0 — Impatto diretto sull'uso quotidiano

1. ~~**Analisi foto in background**~~ ✅ **FATTO** (PR #57)
   Lo stato vive sul batch, il cron riprende ciò che manca, la pagina si può
   chiudere senza perdere nulla. La revisione delle categorie resta possibile
   per chi vuole aspettare.

2. **Import a lotti (batch insert)** ← *prossimo*
   Oggi l'import fa una scrittura per prodotto: con 500+ righe rischia di superare
   il tempo massimo. → inserimenti raggruppati.

### P1 — Robustezza e fiducia

3. **Helper obbligatorio per le scritture DB**
   Restano ~40 scritture senza controllo dell'errore (per lo più log best-effort).
   → helper `mustInsert/mustUpdate` che logga sempre + regola di lint che lo impone.
   È la difesa strutturale contro la classe di bug trovata tre volte.

4. **Selettore del foglio Excel**
   Il fallback automatico c'è; manca la scelta esplicita quando i fogli sono più d'uno.

5. **Test end-to-end con AI reale** su ogni sorgente (Excel, foto, URL, misto).

### P2 — Prodotto (le "rifiniture" che fanno la differenza)

6. **Dashboard admin**: consumi, costo per prodotto, spesa AI, utenti.
7. **Azioni in blocco** nei risultati: accetta tutte le complete, rigenera le fallite.
8. **Ricerca e filtri** più forti sui risultati (per categoria, per campo mancante).
9. **Storico versioni** della scheda + ripristino di una versione precedente.
10. **Anteprima dell'export** prima del download.
11. **Duplica batch** / rigenera solo un sottoinsieme.

### P3 — Dipende da te (accessi esterni)

- Dominio → verifica su Resend → `RESEND_FROM` (oggi le email arrivano solo a te).
- `NEXT_PUBLIC_APP_URL` su Vercel (link corretti nelle email).
- Stripe: chiavi vere + webhook, quando inizi a vendere.
- SMTP di produzione per il login.

---

## 4. Limite dichiarato

In questo ambiente **non posso pilotare un browser** (il proxy blocca Chromium):
niente screenshot dei flussi come farebbe un umano. Posso invece: testare la logica
reale con dati veri, interrogare il DB di produzione, e fare chiamate API autenticate.
L'estrazione da URL è stata verificata su **pagine reali Eataly** (nome, brand,
descrizione, prezzo, immagine scaricata).
