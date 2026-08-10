# Stato del progetto

Documento vivo. Aggiornato con dati verificati su **codice + database di produzione**,
non a memoria.

---

## 1. Dove siamo

**90 commit, 64 pull request. L'applicazione è in produzione e risponde.**

| | |
|---|---|
| Test | **338**, verdi |
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
| `apps/web` | 98 | **server action** — a inizio agosto erano 0 |
| `packages/ai` | 14 | provider, traduzioni, miglioramento prompt |
| `packages/pipeline` | 11 | accodamento e crediti |
| `apps/worker` | 5 | fallimenti e retry |

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

### I vincoli dello schema in un posto solo
Enum, unicità e cancellazioni a cascata sono definiti una volta e condivisi dai
test. Ripeterli file per file è il modo in cui in questo progetto sono già nati
dei bug: la stessa regola scritta due volte, e le due copie che divergono.

---

## 4. Cosa resta

### P1 — Robustezza

1. **Scritture ancora solo loggate** (~40). Sono telemetria e stati intermedi del
   cron, dove il log è la scelta giusta — ma vanno riviste una per una per
   confermarlo.
2. **Selettore del foglio Excel.** Il ripiego automatico c'è; manca la scelta
   esplicita quando i fogli sono più d'uno.
3. **Test end-to-end con AI reale** su ogni sorgente (Excel, foto, URL, misto).
   Oggi la generazione è provata con un modello finto.
4. **`apps/worker` e `packages/ai`** restano a 5 e 14 test. La logica vera sta in
   `core` e `pipeline`, ora coperti — ma la copertura qui è sottile.

### P2 — Prodotto

5. **Seconda vista dei risultati**, più comoda di una tabella per chi non è
   pratico di Excel. ← *concordata come prossimo passo*
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

---

## 6. Limite dichiarato

In questo ambiente **non posso pilotare un browser** (il proxy blocca Chromium):
niente prove dei flussi come li farebbe una persona davanti allo schermo. Posso
invece testare la logica reale con dati veri, interrogare il database di
produzione e fare chiamate API autenticate. I bug di interfaccia continuano a
emergere dall'uso, non dalle mie verifiche: è il buco più grande che resta.
