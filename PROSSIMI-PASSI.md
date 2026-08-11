# Prossimi passi — da «funziona» a «si può vendere»

Sei revisioni indipendenti del prodotto, condotte con un browser vero su ogni
pagina: inventario e percorsi, il primo giorno di un utente nuovo, stile e
coerenza visiva, cosa manca a un SaaS, robustezza vista da fuori, accessibilità
e prestazioni. **69 difetti, 38 mancanze, 303 screenshot.**

I reperti più gravi di ogni revisione sono stati **verificati una seconda volta**
guardando il codice: quelli che non hanno retto sono corretti qui sotto.

---

## 1. Le sei cose che tornano da più parti

Quando tre revisioni indipendenti inciampano nella stessa cosa, quella cosa non
è un dettaglio: è una crepa strutturale. Sono queste.

### 1.1 Il wizard vive solo nella memoria del browser
*Trovato da: inventario, primo giorno, robustezza — tre volte su sei.*

Un solo URL per undici passi. Conseguenze tutte riprodotte:

- **F5 al passo 4 riporta al passo 1** e il batch creato resta `draft` nel
  database, irraggiungibile: `/mapping` dice «anteprima non più in memoria»,
  `/results` è una pagina vuota;
- **Indietro esce dall'applicazione**;
- tornare al passo 1 e ripremere «Crea e continua» crea un **secondo batch**;
- non esiste alcun modo di riprendere un batch interrotto.

Chi carica un catalogo da 2.000 righe e sbaglia un tasto ricomincia da capo.

### 1.2 «Continua» resta attivo mentre il passo carica
*Trovato da: inventario, primo giorno, robustezza — tre volte su sei.*

Ai passi 6-9 il pulsante non si disabilita durante il caricamento. Cliccando al
ritmo normale si **attraversano mappatura e verifica senza vederle**, arrivando
al passo 10 su dati mai controllati. È il difetto che rende inutile tutto il
lavoro di verifica che sta a monte.

### 1.3 Il prodotto non ha un prezzo
*Trovato da: cosa manca a un SaaS, primo giorno.*

Non nella landing (la sezione «Prezzi» elenca solo `50 / 200 / 500 crediti`), non
in `/app/billing`, e nemmeno nella tabella `billing_products`, che **non ha una
colonna prezzo**. La cifra esiste solo dentro Stripe: si scopre dopo essere
stati rimbalzati su `checkout.stripe.com`.

### 1.4 Gli errori parlano inglese, o parlano di database
*Trovato da: primo giorno, robustezza, inventario.*

- login: `email rate limit exceeded`, `Email address "…" is invalid`;
- sessione scaduta: `An unexpected response was received from the server.`;
- offline: `Failed to fetch`;
- un PNG rinominato `.csv`: l'errore della libreria di parsing **coi byte binari
  a schermo**, che porta la pagina a 2327 px di larghezza.

Il prodotto è italiano. Questi messaggi no.

### 1.5 «Non esiste» e «vuoto» sono la stessa cosa
*Trovato da: inventario, robustezza.*

`/app/batches/<id-inventato>/results` risponde **200**, con export e traduzione
attivi. `/app/batches/<id-inventato>/processing` mostra «Elaborazione in corso —
0/0» che si aggiorna all'infinito. In tutto `apps/web/app` **non c'è un solo
`notFound()` né un `not-found.tsx`**: la 404 che si vede è quella di serie di
Next, in inglese.

Il modo giusto in casa c'è già — le pagine di configurazione dicono
correttamente «Preset non trovato» — semplicemente non è applicato ai batch.

### 1.6 Il rosso del marchio non è leggibile
*Trovato da: stile, accessibilità — con la stessa misura.*

`#e5322d` su bianco fa **4,35:1**: mancano 0,15 punti al minimo AA, su *ogni*
pulsante primario e *ogni* link del prodotto. In configurazione esiste già
`accentHover #c22b27`, che fa 5,72:1. Si risolve cambiando un token.

---

## 2. Prima del lancio

### 2.1 ~~Bugie a schermo~~ — **fatto**

| cosa | com'è adesso |
|---|---|
| Il banner «l'acquisto è simulato» | Compare **solo** con `ENABLE_MOCK_BILLING` attivo — che in produzione lo schema di env vieta. |
| Le pagine legali coi segnaposto | I dati vengono da `LEGAL_ENTITY_NAME` / `LEGAL_ADDRESS` / `LEGAL_EMAIL` / `LEGAL_CITY`. Finché mancano, ogni pagina si apre con **«Documento non ancora valido»** e chiede ai motori di non indicizzarla. **Restano da compilare: sono dati che solo il titolare ha.** |
| File vuoti con la spunta verde | Un file senza righe dati viene **respinto al caricamento**, con due messaggi distinti (file vuoto ≠ solo intestazione) e senza finire su storage. |
| La dashboard che si contraddice | La card di benvenuto offre «Inizia: nuovo batch» **solo se il catalogo è configurato**; altrimenti il primo pulsante è «Comincia: configura il preset». |

Come contorno è stato sistemato anche un **test rosso da mesi**: `flow.spec.ts`
cercava la headline «Trasforma il tuo catalogo **moda**…», rimasta da quando il
prodotto era solo moda. Un test rosso da mesi è peggio di un test assente,
perché insegna a ignorare i fallimenti.

<details>
<summary>Com'era</summary>

### Bugie a schermo — mezza giornata, e non è rimandabile

| cosa | dove | perché non si può lanciare così |
|---|---|---|
| «In ambiente demo l'acquisto è simulato: i crediti vengono accreditati senza addebito reale» **scritto fisso, senza condizione su `ENABLE_MOCK_BILLING`** | `app/app/billing/page.tsx:109` | In produzione resta a schermo **nel punto in cui si incassa**. È una dichiarazione falsa sul pagamento. |
| Pagine legali online **con i segnaposto in chiaro**: `[Ragione sociale]`, `[email di contatto]`, `[città]`, e la dicitura «bozza operativa» | privacy, termini, cookie | Sono pubbliche e rispondono 200. Chiunque le legge. |
| File vuoti e file con la sola intestazione ricevono la **spunta verde**, e i passi 6-8 mostrano quattro pastiglie «ok» prima che il passo 9 confessi «Nessun prodotto importato» | wizard | Quattro schermate di rassicurazione su niente. |
| La dashboard dice «Termina la configurazione **per poter creare i tuoi batch**» e dieci centimetri sopra offre «Inizia: nuovo batch», che funziona | `/app` | Due affermazioni opposte nella stessa schermata. |

</details>

### 2.2 ~~Il nome dei prodotti~~ — **fatto**

Il nome ha ora **una colonna dedicata**, come SKU e categoria, suggerita in
automatico dal server (e mai uguale alla colonna SKU: sarebbe tornare al
difetto). Se la colonna manca il ripiego sul codice resta, ma smette di essere
silenzioso — il riepilogo dell'import dice quanti prodotti ne sono rimasti
senza.

Trattarlo come attributo era la causa: il codice cercava un attributo di chiave
`product_name` che **in produzione non esiste** (verificato: nessuna riga in
`attributes` ha quella chiave). Il nome non è un dato del prodotto, è
l'identità della riga — e infilarlo fra i fatti farebbe raccontare all'AI il
titolo che sta scrivendo, quindi ora l'import lo esclude.

**Il finto database mentiva.** Il fixture dei test dichiarava un attributo di
chiave `product_name`: era l'unico posto al mondo dove quel ramo scattava, ed è
il motivo per cui 39 test dell'import erano verdi su un difetto reale. È la
seconda volta in questo progetto che un finto diverge dalla produzione e nasconde
un bug — la prima fu la cancellazione a cascata. La regola resta: **si corregge
il finto, non il test.**

### 2.3 I ruoli sono promessi e non mantenuti — 1-2 giorni

`role` è controllato in due soli file (`team.ts`, `account.ts`). Tutto il resto
passa dal client di servizio, che **scavalca le regole di accesso senza mai
guardare il ruolo**: un semplice membro compra crediti, cancella batch interi,
riscrive i preset.

Nell'interfaccia il badge «Proprietario / Membro» c'è. Una distinzione mostrata e
non applicata è peggio di nessuna distinzione.

### 2.4 Il wizard che perde il lavoro — 2-3 giorni

Il punto 1.1 e il punto 1.2 insieme. La forma della soluzione: **lo stato del
wizard nell'URL** (`/app/batches/new/[step]` o un parametro), il batch
recuperabile dalla dashboard, e il pulsante disabilitato durante i caricamenti.

Nello stesso giro va chiuso il caso della rete che cade: quattro funzioni di
`wizard.tsx` fanno `setBusy(true)` → `await` → `setBusy(false)` **senza
`try/finally`**, quindi se l'`await` lancia l'interfaccia resta su «Caricamento
in corso…» per sempre, anche tornando online. Altre funzioni nello stesso file
il `finally` ce l'hanno: è un'incoerenza, non una scelta.

### 2.5 Poter comprare — 2-3 giorni

- prezzo in euro visibile **prima** del checkout: landing, `/app/billing`, e una
  colonna prezzo in `billing_products`;
- pacchetti popolati anche fuori dal seed (su staging la tabella è vuota e la
  pagina dice «Nessun pacchetto disponibile» senza spiegare perché);
- ricevuta dopo l'acquisto e storico dei pagamenti;
- **dati fiscali italiani**: P.IVA, codice destinatario/SDI. Oggi non c'è
  traccia di nessuno dei due in tutto il repository — nessun cliente B2B
  italiano può comprare.

### 2.6 Un modo di chiedere aiuto — mezza giornata

Quattro link in tutta l'applicazione, la parola «supporto» non compare mai.
Serve almeno un indirizzo email raggiungibile da dentro il prodotto.

### 2.7 L'intestazione che straborda — 2 ore

Fra **640 e 928 px** l'intestazione di `/app/*` fa scorrere il documento in
orizzontale fino a 288 px e spinge «Esci» fuori schermo. Misurato di persona:
a 320 px straborda di 28 px, a 700 px di **228 px**.

È la fascia del tablet in verticale **e dello zoom 200 % su 1440**. I nostri
test provano 390 e 1440: il buco è esattamente in mezzo. Da correggere insieme
alla larghezza testata.

### 2.8 La pagina morta raggiungibile — 2 ore

`/app/batches/[id]/mapping` è un relitto della prima versione: mostra *sempre*
«Dati di anteprima non disponibili» perché legge da `sessionStorage` scritto solo
da `new-batch-flow.tsx`, **un componente che nessuno importa più**. E dice,
cablato nel codice, «i campi del preset **Moda**» su un prodotto multi-settore.

Non sarebbe grave se fosse irraggiungibile — ma il passo 6 del wizard mette il
batch in stato `mapping`, quindi un batch abbandonato lì **compare in dashboard
con «Apri» che porta nel vicolo cieco**.

### 2.9 Il selettore del foglio Excel — mezza giornata

Con un file «Istruzioni» + «Listino 2024» + «Listino 2025» viene importato
*Istruzioni*. Non è un errore casuale: `parseXlsx` prende **il primo foglio con
almeno due righe**, ripiego scritto apposta per il caso «Sheet1 vuoto, dati sul
secondo foglio». Funziona per quello e sbaglia qui — e in nessun caso dice quale
foglio ha letto.

Era già una voce aperta dell'audit. Adesso è stata vista in natura.

**Totale «prima del lancio»: circa 9-12 giorni.**

---

## 3. Subito dopo il lancio

### 3.1 Un'identità visiva — 2-3 giorni

**Il prodotto non ha un carattere.** In `globals.css` c'è
`font-feature-settings: 'cv11', 'ss01'` — le varianti stilistiche di Inter — ma
Inter non viene mai caricato: nessun `@font-face`, nessun `next/font`. Tutto
rende in `ui-sans-serif, system-ui`. Quella riga non fa niente. È la singola
modifica che cambia di più l'aspetto del prodotto, e costa un'ora.

**Cinque larghezze di contenuto** dentro lo stesso guscio: camminando nel wizard
il titolo salta lateralmente di 168 px a ogni «Avanti» (`new` 336 → `mapping`
272 → `input` 168 → `sample` 336 → `results` 168). Serve un `PageShell` con una
larghezza sola.

**Il pulsante primario ha tre altezze** (32/40/44) senza logica: «Nuovo preset»
è il comando più piccolo dello schermo, su `/input` due primari rossi convivono
a 44 e 40, su `/results` cinque trattamenti nella stessa barra.

**Il colore ha perso il significato**: il blu vuol dire settore *e* stato; il
verde esito *e* tipo; il rosso è insieme marchio, errore, azione distruttiva e
«dubbio dell'AI». Due viola diversi per la stessa idea.

Sulle pagine `/app/settings/*` il **titolo di pagina è 12 px grigio a 2,40:1** —
più piccolo dell'`<h2>` sotto di lui.

*Da tenere*: zero colori arbitrari, zero spaziature fuori griglia, `Card` in 28
file e `Button` in 31. La disciplina di base c'è già, va solo estesa.

### 3.2 Accessibilità — 2-3 giorni

- **Zero `aria-live`, `role="status"`, `role="alert"`** in tutto il prodotto, su
  55 riquadri di feedback: chi usa un lettore di schermo non sa mai se
  un'operazione è riuscita. Verificato a runtime su filtro, accettazione scheda
  ed errore di login.
- **Le modali non sono modali**: nessun `role="dialog"` (le due che ce l'hanno
  sono del tour di onboarding), il fuoco non entra all'apertura, 20 Tab su 25
  finiscono fuori, non torna al punto di partenza alla chiusura. Esc funziona.
- **14 combinazioni di contrasto sotto soglia** su 23 viste, le peggiori a
  2,40:1.
- **Nessun «salta al contenuto»**: 10 tappe di Tab prima del contenuto, 43 per
  arrivare all'ultima azione dei risultati con soli 3 prodotti.

*Già a posto*: fuoco visibile su 111 tappe su 111, un solo `<h1>` su 22 rotte su
23, nomi accessibili ovunque tranne una textarea.

### 3.3 Prestazioni — 2-3 giorni

- **Pavimento di ~800 ms su ogni pagina autenticata** (pubbliche 111-246 ms,
  autenticate 870-1358 ms), da tre andate-e-ritorno sequenziali nel layout con
  `force-dynamic`. Un giro singolo verso Supabase misura 165-300 ms: sono
  parallelizzabili.
- **Risultati senza paginazione**: con 153 prodotti → 9.252 nodi, 33.519 px di
  pagina su telefono, 974 ms di blocco. Metà del DOM è la vista dell'altro
  dispositivo, presente e nascosta via CSS.
- **Il chunk del wizard è 2,5-4× ogni altra rotta** (583 kB contro 229 kB):
  `wizard.tsx` è un unico componente client da 2.516 righe con tutti i passi, il
  controllo qualità immagini e il tour.

*Già a posto*: **CLS = 0 ovunque**, anche con 153 prodotti. Zero errori
JavaScript su 23 rotte.

### 3.4 Le cose che confondono — 1-2 giorni

- Il pulsante **«Registrati» porta a una pagina intitolata «Accedi»**. (`/signup`
  risponde 404 ma nessun link ci punta: non è un collegamento rotto, è
  un'etichetta che promette una pagina che non esiste.)
- La barra passa da «Passo 1 **di 9**» a «Passo 3 **di 11**» appena si sceglie la
  fonte.
- Sui risultati a 1440 px la **colonna azioni è tagliata**: Rifiuta e Rigenera
  sono fuori schermo. Sul telefono si vedono tutte — il layout mobile è più
  completo del desktop.
- Su telefono **«Serve aiuto?» si sovrappone a «Crea e continua»**: il comando
  accessorio copre quello principale.
- Gli SKU duplicati sono segnalati «da risolvere» senza offrire nulla, e le righe
  scartate sono contate come «2 da rivedere» — parola sbagliata, e nessun elenco
  di quali righe sono cadute.
- Vocabolario incoerente: batch/lotto, preset/modello, scheda/descrizione/
  contenuto, «Custom» vs «Personalizzata», la rotta `/storico` in mezzo a sette
  rotte inglesi.

### 3.5 Sapere come va il servizio — 2-3 giorni

Nessuna dashboard di amministrazione: non c'è modo di vedere quanti utenti ci
sono, quanto consumano, quanto costa l'AI, chi si è bloccato. **La materia prima
esiste già**: `generation_runs` registra token e costo stimato per ogni
chiamata.

Manca anche qualunque raccolta degli errori in produzione.

---

## 4. Può aspettare

- Un **esempio precompilato** per provare il prodotto senza rischiare. (L'unico
  esempio della landing è un blazer in lana, su un prodotto che vende soprattutto
  al food.)
- `/app/copilot`: pagina raggiungibile solo digitando l'URL. Il **componente**
  però è vivo e usato in tre schermate delle impostazioni — quindi si cancella la
  pagina, non il copilota.
- `/app/settings/integrations`: una voce di menu con una sola card «In arrivo».
- Elenco completo dei batch (la dashboard si ferma a 10).
- Legenda per gli otto giudizi dei risultati.
- Modalità scura: non esiste, e nessuna pagina si rompe per la sua assenza.
- Integrazioni dirette con Shopify/WooCommerce al posto del file da caricare a
  mano; API pubblica; esportazione programmata.

---

## 5. Cosa è risultato solido

Un elenco di soli difetti mente per omissione. Queste cose hanno retto a una
prova fatta apposta per romperle.

- **Permessi e API**: 17 chiamate a mano con sessione valida — id inventati, id
  di un'altra organizzazione, metodo sbagliato, corpo vuoto, JSON rotto —
  rispondono sempre 401/403/400/405 con messaggi italiani. **Nessun 500, nessun
  dettaglio di Postgres, nessuna struttura di tabelle esposta.**
- **Il telefono**: nessuna delle 28 pagine fa scorrere il corpo in orizzontale a
  390 px. Le tabelle larghe stanno tutte in contenitori che scorrono da soli.
- **Il parser**: punto e virgola, accenti, emoji, virgolette tipografiche, pesi
  disomogenei, celle vuote, 5.000 righe in ~2 secondi, nessuna esecuzione di
  formule, testi da 510 caratteri senza sfondare il layout.
- **Doppio click**: un solo batch creato.
- **Limiti sui file**: 20 MB, 50.000 righe, 200 immagini, con messaggi chiari.
- **Rate limit AI** applicato per organizzazione.
- **Cancellazione account** che protegge i dati del team.
- **`friendlyError`** spiega davvero perché una generazione è fallita.
- **CLS = 0** su tutte le pagine misurate.

---

## 6. Limiti di questa revisione

- Il **codice OTP del login non è stato verificato**: lo staging era in limite di
  frequenza. È l'unico passo del percorso di accesso rimasto non provato.
- **Nessuna generazione AI vera** è stata lanciata (costa crediti): il
  comportamento del prodotto sotto una generazione di massa reale resta non
  osservato.
- Le misure di prestazione vengono da `next dev`, molto più lento della
  produzione: **valgono i confronti fra pagine, non i valori assoluti**.
- Il browser di questo ambiente non raggiunge host esterni. Dove una risorsa
  esterna non caricava è stato verificato con `curl` prima di annotarlo.

---

## 7. Ordine consigliato

1. **Le bugie a schermo** (§2.1) — mezza giornata. Sono le uniche voci che
   rendono il prodotto non lanciabile *oggi*, indipendentemente da tutto il resto.
2. **Il nome dei prodotti** (§2.2) — mezza giornata. Un catalogo di codici a
   barre non è un catalogo.
3. **Il wizard** (§2.4) — 2-3 giorni. Il difetto trovato da tre revisioni su sei.
4. **Poter comprare** (§2.5) — 2-3 giorni.
5. **I ruoli** (§2.3) — 1-2 giorni.
6. **Il resto del §2** — circa 2 giorni in totale.

Poi si lancia, e §3 si fa con gli utenti veri davanti.
