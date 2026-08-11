# Stato del progetto

Documento vivo. Aggiornato con dati verificati su **codice + database di produzione**,
non a memoria.

---

## 1. Dove siamo

**90 commit, 64 pull request. L'applicazione è in produzione e risponde.**

| | |
|---|---|
| Test | **366** unitari + **100** con browser vero, verdi |
| Typecheck / lint | puliti su tutto il repo |
| Build | OK |
| Job falliti in coda | 0 |
| Analisi foto in sospeso | 0 |
| Ledger crediti | in pari (100.009 accreditati, 209 consumati) |

Sul database di produzione: 3 organizzazioni, 11 preset, 51 categorie,
201 attributi, 4 batch, 49 prodotti, 26 schede generate, 372 fatti estratti.

---

## 2. Copertura dei test, per strato

| strato | test | note |
|---|---|---|
| `packages/core` | 210 | logica pura: SKU, qualità, prompt, export, sicurezza URL |
| `apps/web` | 111 | **server action** e rotte API — a inizio agosto erano 0 |
| `packages/ai` | 14 | provider, traduzioni, miglioramento prompt |
| `packages/pipeline` | 26 | accodamento, generazione, crediti, tracce |
| `apps/worker` | 5 | fallimenti e retry |
| interfaccia (Playwright) | 100 | pagine pubbliche, wizard, risultati — su desktop e telefono |

Le tre funzioni più rischiose del prodotto sono coperte end-to-end:

- **import** (`confirmImportV2`) — 39 test
- **export** (`buildBatchExport`) — 21 test
- **generazione** — coperta da `core` + `pipeline`, con la garanzia che una scheda
  non salvata fa fallire il job invece di consumare il credito

I test sono stati verificati **a rovescio**: rompendo apposta il codice di
produzione, devono diventare rossi. Due volte il test è sopravvissuto alla
mutazione — ed era il test a essere debole, non il codice. Entrambi corretti.

---

## 3. Le difese strutturali

Non correzioni sul posto: meccanismi che impediscono a un'intera famiglia di
bug di ripresentarsi.

### Scritture al database che non possono più fallire in silenzio
Cinque volte lo stesso guaio (valore non valido → Postgres rifiuta → errore mai
letto → l'app dice "fatto"). Ora:

- una **regola di lint** segnala ogni scrittura il cui esito viene scartato —
  cerca la write in qualsiasi punto dell'espressione, non solo in coda;
- tre helper rendono esplicita la scelta: `mustWrite` (conta, riporta l'esito),
  `writeOrThrow` (interrompe, per le action in try/catch), `logWrite` (telemetria);
- la generazione **fallisce e ritenta** se la scheda non viene salvata, con il
  controllo prima del consumo del credito.

### Guardia sugli endpoint
In Next ogni funzione esportata da un file `'use server'` è raggiungibile dalla
rete. Un nucleo interno era esposto così: riceveva l'organizzazione come
parametro e usava il client di servizio, che scavalca le regole di accesso al
database. **Chiusa.** Sette test verificano ora che nessuna azione riceva il
client o l'organizzazione da fuori, e che ognuna faccia un controllo di identità.

### Il preset è il vocabolario
Le categorie di un batch sono quelle del preset scelto, non quelle del settore.
Prima un preset con 17 categorie ne offriva 31, e i prodotti finivano in
categorie senza attributi — quindi senza niente da estrarre.

### Il registro dei crediti non sbaglia in silenzio
Le funzioni che spostano crediti si chiamano con `rpc`, e `rpc` restituisce
l'errore invece di sollevarlo — esattamente come `insert`. La regola di lint
guardava solo `insert/update/upsert/delete`, quindi **sette chiamate** al
registro buttavano via l'esito. Erano i punti dove passano i soldi: accredito
dopo il pagamento, rimborso di un job fallito, consumo del credito riservato.

Ora la regola copre anche `rpc`; l'accredito dopo il pagamento **interrompe e
risponde 500**, così Stripe riprova (la funzione è idempotente sull'evento,
non accredita due volte); i rimborsi nel worker, dove non c'è nessuno a cui
dirlo, lasciano una riga `credit_ledger_failed` in `app_events` — perché nel
worker i log del server non li legge nessuno.

### Quattro casi, non due
`mustWrite` con il risultato buttato via è `logWrite` che finge di controllare:
sembra un presidio e non lo è. Erano 58 punti. Rivisti uno per uno, la regola
non è "quanto conta la scrittura" ma **chi può farci qualcosa**:

| situazione | cosa si fa | quanti |
|---|---|---|
| utente in attesa, la scrittura *è* il lavoro chiesto | errore vero (`mustWrite` + `fail`, o `writeOrThrow`) | 22 |
| utente in attesa, il lavoro è riuscito e resta uno strascico | `writeOrTrace` | 6 |
| background: worker, cron, code | `writeOrTrace` | 27 |
| davvero accessoria, e niente da fare | resta, **con scritto perché** | 3 |

`writeOrTrace` lascia una riga `write_failed` in `app_events`, interrogabile.
Un `console.error` alle tre di notte nei log di Vercel non lo legge nessuno —
ed era l'unica traccia in tutta la parte in background.

Un effetto collaterale che si vede: l'import ora **dice** quanti prodotti sono
entrati senza i loro dati. Prima il conteggio finiva solo nella telemetria e
chi importava lo scopriva a generazione fatta.

### I vincoli dello schema in un posto solo
Enum, unicità e cancellazioni a cascata sono definiti una volta e condivisi dai
test. Ripeterli file per file è il modo in cui in questo progetto sono già nati
dei bug: la stessa regola scritta due volte, e le due copie che divergono.

---

## 4. Cosa resta

### P1 — Robustezza

1. ~~Scritture il cui esito nessuno legge~~ — **chiuse**. I 20 `logWrite` sono
   tutti `app_events.insert`, telemetria pura: il log è la scelta giusta. I 58
   `mustWrite` con l'esito scartato sono stati rivisti uno per uno e ne restano
   **3**, ognuno con scritto accanto perché. Vedi §3.
2. **Selettore del foglio Excel.** Il ripiego automatico c'è; manca la scelta
   esplicita quando i fogli sono più d'uno.
3. **Test end-to-end con AI reale** su ogni sorgente (Excel, foto, URL, misto).
   Oggi la generazione è provata con un modello finto.
4. **`apps/worker` e `packages/ai`** restano a 5 e 14 test. La logica vera sta in
   `core` e `pipeline`, ora coperti — ma la copertura qui è sottile.

### P2 — Prodotto

5. ~~Seconda vista dei risultati~~ — **fatta**: vista "Lettura" con la foto del
   prodotto accanto al testo, e su telefono la barra strumenti si apre solo se
   serve.
6. **Dashboard admin**: consumi, costo per prodotto, spesa AI, utenti.
7. **Azioni in blocco** nei risultati: accetta tutte le complete, rigenera le fallite.
8. **Ricerca e filtri** sui risultati (per categoria, per campo mancante).
9. **Storico versioni** della scheda + ripristino.
10. **Anteprima dell'export** prima del download.
11. **Duplica batch** / rigenera solo un sottoinsieme.

### P3 — Dipende da te (accessi esterni)

- Dominio → verifica su Resend → `RESEND_FROM` (oggi le email arrivano solo a te).
- `NEXT_PUBLIC_APP_URL` su Vercel (link corretti nelle email).
- Stripe: chiavi vere + webhook, quando inizi a vendere.
- SMTP di produzione per il login.

---

## 5. Osservazioni sui dati reali

- **23 prodotti su 49 non hanno categoria.** Vengono dal batch di luglio, creato
  prima della correzione sulle categorie: non è un problema attivo, ma quel batch
  andrebbe re-importato per allinearlo.
- **17 dubbi dell'AI aperti** in attesa di risposta nell'inbox.
- **0 schede accettate.** Le schede vengono generate ma non ancora confermate:
  atteso, finché il flusso di revisione non viene usato davvero.
- `batches.source_type` è NULL su tutti i batch. Il percorso di scrittura è
  corretto e ora controllato; nessun punto del codice legge quel campo. È un
  residuo storico su una colonna di fatto inutilizzata.
- **Il registro crediti è in pari, riga per riga.** Riservati 233, rilasciati
  233 (209 per consumo, 23 per job falliti, 1 per una cache hit), consumati 209.
  Saldo 99.800, uguale alla somma dei tre saldi per organizzazione. Nessuna
  riserva rimasta bloccata: i sette `rpc` senza controllo erano
  un'**esposizione**, non un danno già avvenuto. Il pagamento vero non è mai
  passato — `stripe_events` è vuota — quindi il buco peggiore non ha mai avuto
  occasione di aprirsi.

---

## 6. Limiti dichiarati

**Il browser adesso c'è.** La versione precedente di questo documento diceva che
non potevo pilotarne uno: era sbagliato. Chromium era già installato, il
pacchetto Playwright ne cercava una build diversa e l'errore sembrava un muro.
Oggi 100 test aprono le pagine vere — comprese quelle dietro il login, con dati
seminati su un progetto Supabase di staging dedicato. Dettagli in
`docs/qa-browser.md`.

Restano tre limiti veri:

- **La rete del container non arriva agli host esterni dal browser.** Un `<img>`
  verso Storage resta vuoto; `curl` allo stesso indirizzo risponde. Non tocca i
  test (guardano markup e testo alternativo), tocca solo gli screenshot.
- **La generazione è provata con un modello finto.** Nessun test end-to-end
  paga davvero l'AI.
- **Il pagamento vero non è mai stato eseguito.** Il webhook Stripe ora ha 10
  test, ma `stripe_events` in produzione è vuota: il primo pagamento reale sarà
  il primo collaudo reale.
