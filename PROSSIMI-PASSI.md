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

### 2.3 ~~I ruoli sono promessi e non mantenuti~~ — **fatto**

La linea: **il membro fa il lavoro, il proprietario decide i soldi e le regole.**

| di tutti | del proprietario |
|---|---|
| creare batch, caricare, importare, generare | comprare crediti |
| rivedere, esportare, rispondere ai dubbi | eliminare un batch |
| *vedere* preset, categorie, attributi | *modificare* preset, categorie, attributi |

Il pezzo che conta non è il controllo, è **dove** sta. Tutte e 32 le azioni del
catalogo passano da un unico guardiano, `requireOrg`, che ora **pretende il
proprietario per difetto**: chi legge e basta lo dichiara con
`{ ancheMembri: true }`. Un'azione nuova nasce quindi protetta, e per aprirla
bisogna scriverlo — il contrario di com'era, dove bisognava ricordarsi di
chiudere.

A reggere la regola c'è un test che **enumera le azioni del modulo** e verifica
che ognuna, se non è fra le sette letture dichiarate, rifiuti un membro. Se
qualcuno ne aggiunge una saltando il guardiano, quel test diventa rosso. È lì
che una regola del genere si perde: non quando la si scrive, sei mesi dopo.

L'interfaccia non offre più quello che il server rifiuterebbe: a un membro il
cestino del batch non compare, e la pagina crediti spiega perché l'acquisto
spetta al proprietario invece di lasciarlo sbattere contro un errore.

**Resta aperto**: `batches` non registra chi ha creato il batch, quindi non c'è
una regola più fine di «solo il proprietario elimina». Con una colonna
`created_by` un membro potrebbe cancellare il proprio lavoro senza toccare
quello degli altri.

### 2.4 ~~Il wizard che perde il lavoro~~ — **fatto**

| cosa | com'è adesso |
|---|---|
| F5 riportava al passo 1 | L'indirizzo porta `?batch=…&passo=…`. Alla ricarica il wizard si ricostruisce **dal server**, file compreso: l'anteprima viene ri-letta da storage, non da `sessionStorage`. |
| Il batch restava irraggiungibile | Dalla dashboard un batch `draft` / `uploaded` / `mapping` torna nel wizard, dove era. |
| «Crea e continua» creava un secondo batch | Se il batch c'è già, prosegue invece di crearne un altro. |
| «Continua» attivo durante il caricamento | I caricamenti dei passi 2, 6 e 8 ora dichiarano quale passo stanno servendo, e il pulsante aspetta. |
| Rete che cade → «Caricamento» per sempre | Le quattro azioni senza `try/finally` sono state chiuse, con un messaggio in italiano che dice che il lavoro è salvo. |

**Il vicolo cieco `/mapping` è stato rimosso**, con la sua pagina, i suoi due
componenti e le tre server action della v1 rimaste senza chiamanti — in Next
un'azione esportata senza interfaccia non è codice morto, è superficie di rete
viva.

Due difetti trovati lavorando, non dall'audit:

- **la guida rubava un clic a ogni passo.** Il velo copriva tutta la pagina e un
  clic fuori dal fumetto la faceva *avanzare*: su undici passi, ognuno col suo
  fumetto, era un clic sprecato ogni volta. Ora un clic la chiude.
- **il banner cookie copriva il comando principale del wizard.** In fondo alla
  pagina convivono barra del wizard, banner e pulsante d'aiuto: alla prima
  visita vinceva il banner. Ora chi sta lavorando ha la precedenza sull'avviso.
  (Il banner ha anche un nome proprio: diceva «Ho capito» esattamente come il
  fumetto della guida, e non c'era modo di distinguerli — né per un test né per
  un lettore di schermo.)

**Resta aperto**: la «Descrizione (facoltativa)» del passo 1 non si può
riprendere perché **non viene salvata da nessuna parte** — finisce solo nel
`metadata_json` di un evento di telemetria. Chi la scrive la perde comunque,
anche senza F5. Serve una colonna, quindi una migrazione: voce a sé.

### 2.5 ~~Poter comprare~~ — **fatto** (i prezzi sono segnaposto)

Il prezzo esisteva solo dentro Stripe: si scopriva dopo essere stati rimbalzati
sul checkout. Adesso `billing_products` ha una colonna `price_cents`, e la cifra
compare sulla landing e su `/app/billing` insieme al **prezzo per scheda**, che è
il numero che si cerca davvero confrontando due pacchetti. Un pacchetto senza
prezzo non si mostra e **non si vende**: la rotta di checkout lo rifiuta, non
solo l'interfaccia.

I prezzi in archivio sono **segnaposto** — 29,00 / 99,00 / 199,00 € — e stanno
nel database, non nel codice: cambiarli non richiede un rilascio. Vanno decisi
prima di vendere; è l'unica cosa rimasta da fare qui, e la decide chi vende.

Staging aveva `billing_products` vuota: popolata, e il seed ora include i prezzi
così un progetto nuovo non nasce con la pagina che dice «Nessun pacchetto
disponibile» senza spiegare perché.

**I dati fiscali italiani** non esistevano da nessuna parte: nessun campo,
nessun controllo, nessuna schermata. Ora `organizations` ha ragione sociale
(separata dal nome dell'organizzazione: «Cascina Verde» è come si chiamano,
«Cascina Verde S.r.l.» è chi emette la fattura), partita IVA, codice fiscale,
codice destinatario SDI, PEC e indirizzo; `/app/billing` ha il form, riservato al
proprietario. La partita IVA è validata col carattere di controllo — undici cifre
qualsiasi tornerebbero indietro dallo SDI giorni dopo il pagamento — ma **solo per
l'Italia**: applicare la regola italiana a una VAT francese valida la boccerebbe.

Il checkout **non fa pagare** se quei dati mancano: incassare senza poter
emettere fattura costa più che fermarsi un attimo prima. L'errore non è un vicolo
cieco — porta al form, sulla stessa pagina. A Stripe arrivano ragione sociale,
indirizzo e partita IVA col prefisso paese (`eu_vat`, e solo dentro l'Unione:
dichiararlo per un paese extra-UE farebbe fallire l'acquisto), e la sessione
chiede la fattura con codice destinatario, PEC e codice fiscale scritti sopra —
lo SDI non è un campo nativo di Stripe.

La cronologia mostra l'**importo pagato allora**, non il prezzo di oggi: è
scritto nel registro nel momento dell'incasso, e viene da Stripe, non dal
listino. Con uno sconto o dopo un cambio di prezzo le due cifre divergono, e una
ricevuta che si riscrive da sola quando si tocca il listino non è una ricevuta.

**Rimasto al proprietario del prodotto:** decidere i prezzi veri (`update
billing_products set price_cents = …`), le chiavi Stripe live e il webhook.

### 2.6 ~~Un modo di chiedere aiuto~~ — **fatto**

`/app` ha un piede con l'indirizzo di assistenza e i link a privacy, termini e
cookie — che prima si raggiungevano **solo uscendo** dall'applicazione.

L'indirizzo viene da `SUPPORT_EMAIL`, o da `LEGAL_EMAIL` se manca. Se mancano
entrambi il piede **non finge**: dice che il contatto non è configurato, invece
di offrire un `mailto:` che non porta da nessuna parte. Il link precompila
l'oggetto, così chi scrive non deve spiegarsi da zero.

### 2.7 ~~L'intestazione che straborda~~ — **fatto**

Le etichette dell'intestazione comparivano da `sm` (640 px) ma con le parole
accanto alle icone la barra vuole 928 px: fra i due valori il documento
scorreva di lato fino a 288 px e «Esci» finiva fuori schermo. Ora compaiono da
`lg`, dove lo spazio c'è davvero.

Sotto i 360 px straboravano anche due righe di pulsanti con `shrink-0` (le
azioni della card batch e i comandi dell'onboarding): adesso vanno a capo.

**Misurato da 320 a 1440 px: nessuno scorrimento.** E ci sono sei test
permanenti su quelle larghezze — il difetto stava esattamente fra le due che
provavamo.

### 2.8 ~~La pagina morta raggiungibile~~ — **fatto**

`/app/batches/[id]/mapping` era un relitto della prima versione: mostrava
*sempre* «Dati di anteprima non disponibili» perché leggeva da `sessionStorage`
scritto solo da `new-batch-flow.tsx`, un componente che nessuno importava più.
È stata tolta col wizard (§2.4), insieme a `mapping-editor`, `new-batch-flow` e
alle tre server action rimaste senza chiamanti — che in Next non sono codice
morto ma superficie di rete viva. Un batch fermo in `mapping` ora torna nel
wizard, al suo passo.

**Ma il difetto non era di quella pagina: era del modo di scriverle.** Cercandolo
altrove è saltato fuori identico in **altre quattro** — `input`, `processing`,
`results`, `sample`. Tutte controllavano che ci fosse una sessione, nessuna che
il batch esistesse o fosse tuo. I dati non uscivano (le query passano dalle
regole di accesso del database, e un batch altrui non restituisce righe) ma la
pagina si disegnava lo stesso: intestazione, tabella vuota e un pulsante
«Configura tono e campione» che portava avanti dentro un batch inesistente. Zero
prodotti di un batch che non c'è e zero prodotti di un batch vuoto sono la
stessa risposta.

Ora c'è una guardia sola (`lib/batch-page.ts`), chiamata **prima** di ogni altra
lettura, e una pagina che dice cosa è successo — «questo lavoro non c'è più»,
con le tre spiegazioni possibili e il collegamento per tornare indietro. Le
pagine mostrano anche il **nome del batch** nel sottotitolo: dicevano
«Risultati» e basta, senza dire di cosa.

Il test che conta non guarda le quattro pagine di oggi: verifica che *ogni*
pagina sotto `batches/[batchId]` chiami la guardia, e che la chiami prima di
leggere altro. È lì che una regola così si perde — non quando la si scrive, ma
sei mesi dopo, con la quinta pagina.

**Una precisazione onesta:** quella pagina arriva con stato HTTP 200, non 404.
Il guscio dell'applicazione è dinamico e la risposta è già partita quando
`notFound()` scatta. Per chi la usa non cambia niente — vede la pagina giusta —
e sono rotte dietro l'accesso, quindi nessun motore di ricerca le guarda.
Sistemarlo vorrebbe dire un giro al database nel middleware a ogni apertura: un
costo vero per un codice che qui non legge nessuno.

### 2.9 ~~Il selettore del foglio Excel~~ — **fatto**

Il ripiego resta — è giusto per il caso per cui era stato scritto, «Sheet1 di
servizio vuoto e dati sul foglio dopo» — ma adesso il file **dichiara quale
foglio è stato letto** e quali altri ci sono. Se ce n'è più d'uno, il
caricamento mostra un avviso con la scelta, e cambiarla rilegge l'anteprima.

Cambiando foglio le colonne scelte si azzerano: quelle del foglio precedente
punterebbero al vuoto.

**Totale «prima del lancio»: circa 9-12 giorni.**

---

## 3. Subito dopo il lancio — **tutto fatto (3.1 → 3.5)**

Era la lista delle cose da fare «con gli utenti veri davanti». Sono state fatte
prima, e due delle sue affermazioni non hanno retto la verifica: stanno scritte
qui sotto, nei rispettivi punti, perché una revisione che non si controlla
diventa folclore.

### 3.1 ~~Un'identità visiva~~ — **fatto**

**Il carattere.** In `globals.css` c'era `font-feature-settings: 'cv11', 'ss01'`
— le varianti stilistiche di Inter — ma Inter non veniva mai caricato: nessun
`@font-face`, nessun `next/font`. Tutto rendeva col carattere di sistema e
quella riga non faceva assolutamente niente. Ora Inter c'è, servito da noi
(`next/font` lo scarica in compilazione): nessuna richiesta a Google dal browser
di chi usa il prodotto, che è ciò che ci permette di scrivere nella cookie
policy che usiamo solo cookie tecnici. Aggiunte anche le cifre a larghezza fissa
nelle tabelle: un totale che cambia non fa più ballare la riga.

**Una posizione sola per il titolo.** Dentro lo stesso guscio convivevano cinque
larghezze scelte una per volta, e camminando nel flusso di un batch il titolo
saltava di lato di quasi 200 px a ogni «Avanti». Ora c'è `PageShell` con due
larghezze **dichiarate e motivate** — `larga` per le pagine con tabelle, dove lo
spazio orizzontale è il contenuto, `stretta` per quelle che si leggono — e tutto
il flusso di un batch usa la stessa. Misurato: `h1` a **x=88 su ogni pagina**,
dalla dashboard ai risultati. (Configurazione sta a 340 perché ha una barra
laterale: è strutturale e non si muove mentre ci si sta dentro.)

**Le tre misure del pulsante hanno una regola**, scritta in `button.tsx`: `lg`
solo per l'unica azione che è il punto dello schermo, `md` come misura normale,
`sm` solo nelle righe che si ripetono. «Nuovo preset» era il comando più piccolo
dello schermo pur essendo il motivo per cui si è su quella pagina: adesso è alla
misura del titolo, come gli altri sette comandi di intestazione.

**Il colore ha di nuovo un significato**, uno per colore: grigio la
classificazione (settore, tipo di attributo, «Sistema»), blu gli stati
intermedi, verde ciò che è riuscito o attivo, ambra ciò che è in corso o da
guardare, rosso ciò che è fallito, viola **quello che hai fatto tu**
(«Personalizzata», «Custom», «Modificato»). Prima il settore era blu come uno
stato, «Custom» verde come un esito, e la stessa idea aveva due viola diversi —
il badge diceva `violet` e disegnava indigo, mentre i risultati usavano il viola
vero.

**Il titolo delle pagine di configurazione** era un `<h1>` da 12 px grigio a
2,40:1 — il testo meno leggibile dello schermo, più piccolo dell'`<h2>` sotto di
lui, e per giunta l'unico titolo semantico della pagina. Adesso è l'etichetta di
navigazione che è sempre stato, e il titolo vero («Preset», «Categorie») è un
`<h1>` da 24 px.

Tre di queste cose non si vedono leggendo il file che le contiene — si vedono
solo mettendo insieme file diversi — e per questo hanno un test: il carattere
caricato davvero, un viola solo, e nessuna pagina del flusso che si stringa per
conto suo.

**Rimasto da decidere a chi vende:** se il prodotto vuole un carattere *da
display* per i titoli, diverso da quello del testo. È una scelta di marchio, non
di codice.

### 3.2 ~~Accessibilità~~ — **fatto**

Non era «poca»: era **niente**. Zero `aria-live`, zero `role="status"`, zero
`role="alert"` su 55 riquadri di riscontro. Si premeva «Salva» e non arrivava
nessuna notizia — né buona né cattiva. Sono difetti che non si vedono
guardando: la pagina, a occhio, funzionava benissimo.

**I riquadri parlano.** C'è un `Avviso` solo, e la distinzione fra i due ruoli
non è una sfumatura: l'errore usa `alert` e **interrompe** (qualcosa non è
successo, e finché non lo si sa si continua a credere il contrario), la
conferma usa `status` e aspetta il suo turno. Per strada sono spariti anche
trenta riquadri rossi scritti a mano con quattro spaziature diverse.

**Le modali sono modali.** Erano riquadri sopra la pagina e nient'altro: nessun
`role="dialog"`, il fuoco restava sul pulsante che le aveva aperte, e
continuando con Tab si finiva a navigare la pagina sottostante — coperta e
inutilizzabile. Ora il fuoco **entra**, **resta dentro** (Tab e Shift+Tab
girano) e **torna dove stava** alla chiusura. La terza è quella che si dimentica
sempre ed è quella che si sente di più.

Provato con la tastiera vera: aperta la modale, **nove Tab e zero fughe**, Esc
chiude e il fuoco torna esattamente su «Nuovo preset».

**«Salta al contenuto».** Servivano dieci tappe di Tab per arrivare al
contenuto, a ogni pagina, e quarantatré per l'ultima azione dei risultati con
tre soli prodotti. Ora il salto è la prima tappa, invisibile finché non riceve
il fuoco, e il bersaglio può riceverlo — senza `tabIndex={-1}` il salto
sposterebbe la vista ma non il punto di lettura.

**Il testo si legge.** 87 righe di testo erano a `gray-400`: 2,4:1 sul nostro
fondo crema, contro un minimo di 4,5:1. Portate a `gray-500`. Le 17 rimaste
sono icone, che sono decorative ed esenti.

*Già a posto e rimasto tale*: fuoco visibile su 111 tappe su 111, nomi
accessibili ovunque tranne una textarea.

### 3.3 ~~Prestazioni~~ — **fatto**, con una precisazione

**Il pavimento di ~800 ms.** Ogni pagina dietro l'accesso pagava tre andate e
ritorno in fila: verifica del token, «di che organizzazione fa parte questo
utente», e infine saldo crediti più dubbi aperti. Le ultime due partivano
insieme, ma solo dopo che la seconda era finita — perché servono l'id
dell'organizzazione. Le ultime due sono una domanda sola, e ora lo sono davvero
(`contesto_app`).

Misurato contro il database vero, ripetuto: **290 ms → 143 ms**. La verifica del
token resta e non si toglie da qui: servirebbe verificare la firma in locale,
che richiede chiavi asimmetriche sul progetto — configurazione, non codice.

Il saldo **non è ricalcolato** dentro la nuova funzione: chiama
`get_credit_balance`, che resta l'unico posto dove è scritto come si somma un
registro di crediti. Due versioni della stessa somma, prima o poi, divergono — e
qui la somma sono soldi.

**Il muro dei risultati.** Cinquanta schede per volta. Misurato con 153
prodotti: **9.428 nodi e 9.261 px → 3.253 nodi e 3.447 px**. Su telefono la
pagina passa da un rotolo infinito a 8.078 px.

Per strada è saltato fuori un difetto che la paginazione avrebbe *creato*:
l'elenco era ordinato per data e un import inserisce tutte le righe nello stesso
istante — a parità di timestamp Postgres non promette nessun ordine, e ricaricando
si sarebbe vista una scheda su due pagine o su nessuna. Aggiunto un secondo
criterio.

**La precisazione, sul chunk del wizard.** L'affermazione «2,5-4× ogni altra
rotta (583 kB contro 229 kB)» **non regge**. Misurato sulla compilazione di
produzione: `/app/batches/new` fa 177 kB di primo caricamento contro i 129 kB dei
risultati — 1,4×, non 2,5-4×. Il pezzo di rotta suo è davvero 64 kB contro 16, e
quello resta grosso.

Ho provato a spostare fuori i due pannelli che servono solo su un passo:
**64,8 → 64,1 kB**, cioè niente. L'ho tolto: una macchina in più e uno sfarfallio
di caricamento per un chilobyte sono peggio del problema. Il peso vero sono i
nove passi dentro un unico file da 2.516 righe, e spezzarli è un lavoro di
ristrutturazione su un flusso appena sistemato (§2.4), per 48 kB. **Non l'ho
fatto**: il rapporto fra rischio e guadagno lo decide chi conosce le priorità,
non io.

*Già a posto e rimasto tale*: **CLS = 0 ovunque**, zero errori JavaScript.

### 3.4 ~~Le cose che confondono~~ — **fatto**, con due smentite

**«Registrati» portava su una pagina intitolata «Accedi».** Non è un
collegamento rotto: è un'etichetta che promette una pagina che non esiste. Il
percorso è uno solo — il primo accesso crea l'account — e adesso lo dicono
entrambi: il pulsante è «Prova gratis», la pagina è «Accedi o registrati».

**Il conto dei passi non cambia più strada facendo.** Con un Excel i passi sono
due in più: finché la fonte non è scelta il totale **non si sa**. Prometterne uno
significava passare da «Passo 1 di 9» a «Passo 3 di 11» senza aver fatto niente
di sbagliato. Ora il totale compare quando si conosce, e da lì non si muove più
se non sei tu a cambiare la fonte.

**«Serve aiuto?» copriva «Crea e continua».** La barra dei comandi è `sticky`:
con poco contenuto si ferma a metà schermo, proprio dove galleggiava il pulsante
di aiuto. Misurato a 390 px: si sovrapponevano di 27 px. Su telefono l'aiuto ora
sta *dentro* la barra, dove non può collidere per costruzione; da tablet in su lo
spazio c'è e il pulsante flottante resta. Rimisurato: nessuna sovrapposizione.

**Gli SKU duplicati e le righe scartate.** Qui sotto c'erano due difetti, uno
peggiore dell'altro.

Il primo: il banner contava «SKU duplicati» quello che in realtà è **lo stesso
file caricato due volte**. Due foto con lo stesso codice sono il caso *normale*
— fronte, retro, etichetta — e il sistema le raggruppa apposta: l'etichetta
allarmava per una cosa che va benissimo.

Il secondo: le righe cadute erano contate come «da rivedere», una parola che
promette una revisione che non esiste da nessuna parte. Sono righe **scartate**,
e prima ne restava solo il numero — per sapere quali, l'unico modo era
confrontare a mano il file con il catalogo importato. Adesso l'import restituisce
l'elenco con il perché (codice non valido, codice ripetuto, dati insufficienti) e
il wizard lo mostra. E dove il confronto delle fonti segnala i codici ripetuti,
c'è scritto cosa succederà: entra la prima riga, le altre no.

**Una parola per una cosa.** «Custom» è diventato «Personalizzato» (era accanto a
«Personalizzata», che dice la stessa cosa); la rotta `/storico` — unica in
italiano fra sette in inglese — è diventata `/app/settings/activity`, e il vecchio
indirizzo reindirizza, perché i segnalibri di chi lo usava non si rompono per una
questione di coerenza nostra. «Lotto» e «modello» restano solo dove *spiegano*
«batch» e «preset» la prima volta: lì non sono incoerenza, sono l'unico punto in
cui qualcuno impara cosa sono.

**Due affermazioni non hanno retto la verifica.**

1. *«Sui risultati a 1440 px la colonna azioni è tagliata: Rifiuta e Rigenera
   sono fuori schermo.»* Misurato a 1440, 1280 e 1024 px: tutti e quattro i
   comandi sono dentro lo schermo, la tabella sta nel suo contenitore e niente
   scorre di lato.
2. *(§3.3)* Il rapporto dichiarato sul chunk del wizard.

Le lascio scritte qui perché una revisione che non si controlla diventa
folclore.

### 3.5 ~~Sapere come va il servizio~~ — **fatto**

Non c'era modo di rispondere a nessuna domanda sulla salute del prodotto: quante
organizzazioni ci sono, quanto generano, quanto costa l'AI, chi è rimasto
bloccato a metà, cosa si è rotto ieri. La materia prima c'era già tutta —
`generation_runs` registra token e costo per ogni chiamata, `credit_ledger` i
soldi, `app_events` i guasti — e nessuno la guardava. **Un servizio che non si
guarda si scopre rotto dai clienti.**

Ora c'è `/app/admin`: organizzazioni e persone, batch e schede generate,
incassato e crediti consumati, costo AI e token, **chi è rimasto fermo** (batch
in uno stato non terminale da più di dieci minuti — la stessa soglia del
riconciliatore, e per lo stesso motivo) e **cosa si è rotto**. Una chiamata sola:
il pannello non deve costare dieci letture per disegnare sei numeri.

Il costo è etichettato «stima»: `estimated_cost` è quello che dichiara il
fornitore, non una fattura, e la pagina non deve far credere il contrario.

**Chi può vederlo sta in `ADMIN_EMAILS`, non in una colonna del database.** È una
scelta: un ruolo si assegna per sbaglio, una variabile d'ambiente no. E se la
variabile è vuota — il caso predefinito — il pannello **non esiste per nessuno**:
404, non «non sei autorizzato», perché una pagina che dice «non sei autorizzato»
conferma di esistere. Provato nel browser in entrambi i versi.

**La raccolta degli errori** non esisteva: un errore arrivava a schermo, l'utente
ricaricava, e non ne restava traccia da nessuna parte. Adesso finisce dove
finiscono già i guasti di scrittura, e si vede nel pannello. È fatta **in casa**:
nessun servizio esterno, nessun dato che esce, niente da pagare. È volutamente
povera — messaggio, punto del codice, indirizzo — perché un raccoglitore di
errori che si porta dietro i dati dei clienti è un problema più grande di quello
che risolve. E serve una sessione: ogni funzione esportata da un file
`'use server'` è un indirizzo di rete, e senza il controllo chiunque potrebbe
riempire di rumore la tabella dei guasti.

**Da fare a chi lancia:** impostare `ADMIN_EMAILS` su Vercel. Senza, il pannello
resta invisibile anche a te.

*Se un giorno servisse di più* — tracce distribuite, avvisi automatici, sessioni
registrate — quello è un servizio esterno a pagamento, con dati che escono
dall'Europa: è una decisione, non un'omissione.

---

## 4. ~~Può aspettare~~ — **cinque voci su sette fatte**

Nessuna di queste rompeva niente, ed è esattamente per questo che erano lì da
mesi.

**~~Un esempio precompilato~~ — fatto.** Fra l'iscriversi e il vedere una scheda
generata c'erano cinque cose da configurare, e nessuna di esse ha senso finché
non hai visto cosa esce: si chiedeva di costruire lo stampo prima di sapere che
forma servisse. Ora ci sono due strade, e si incrociano.

Dalla pagina Preset vuota, **«Parti da un esempio»** monta un preset finito e
pubblicato per il proprio settore — conserve, abbigliamento o integratori, con
le categorie e gli attributi veri di quel mestiere. Non è una scorciatoia
nascosta: usa **le stesse azioni** che userebbe una persona cliccando, una dopo
l'altra, così se domani cambia il modo di creare un preset cambia anche questo
invece di restare indietro in silenzio.

Nel wizard, al passo del caricamento, **si scarica un listino di esempio** — otto
righe vere di conserve, con codice, categoria, ingredienti, peso, origine e
allergeni — da ricaricare lì sopra. Fa il giro completo senza mettere in mezzo il
proprio catalogo, che è il vero motivo per cui non si prova uno strumento nuovo.

E la landing non parla più solo di moda: l'unico esempio era un blazer in lana,
su un prodotto che vende soprattutto al food. Adesso sono due, e sotto il primo
c'è **la riga di listino da cui è uscito** — che è il punto di tutto il prodotto.

**~~`/app/copilot`~~ — fatta.** La pagina non era collegata da nessuna parte: ci
si arrivava solo digitando l'indirizzo. Rimossa lei e il suo client; il
*componente* copilota resta, ed è vivo in tre schermate della configurazione.

**~~`/app/settings/integrations`~~ — fatta.** Era una voce di menu con dentro una
sola card «In arrivo». Ci si arriva con una domanda — «posso collegare il mio
negozio?» — e si trovava una promessa senza data e nient'altro; mentre la
risposta vera esisteva già ma stava altrove. Ora la pagina dice **prima quello
che c'è** (i file già nel tracciato di Shopify, WooCommerce e PrestaShop, dai
risultati) e poi quello che non c'è, **senza dire «a breve»**: una data che
nessuno può promettere fa più danno del silenzio.

**~~Elenco completo dei batch~~ — fatto.** La dashboard si fermava a dieci e non
lo diceva: dal decimo in giù il lavoro spariva. Ora dice «Vedi tutti i N» e c'è
`/app/batches`, venticinque per pagina. `batchHref` è uscito dalla dashboard ed è
diventato un modulo: due copie di quella tabella divergerebbero al primo stato
nuovo, e una delle due porterebbe altrove senza che si veda.

**~~Legenda per gli otto giudizi~~ — fatta.** «Parziale» e «Insufficiente»
sembravano la stessa cosa detta con due parole, e la differenza è quella che
decide se una scheda si pubblica o no. Ogni filtro ora ha la sua riga di
spiegazione, sotto le linguette e nel titolo al passaggio del mouse.

---

**Le due che restano, e perché non le ho fatte.**

**Modalità scura.** Misurato: **851 occorrenze di colori chiari cablati in 54
file**, e zero varianti `dark:` esistenti. Farla bene vuol dire introdurre dei
token semantici e riscrivere tutte e 851 — una modifica enorme, senza test che
guardino i colori, subito dopo una revisione fatta per lanciare. E farla a metà è
peggio che non farla: una pagina scura e la successiva bianca **è** una pagina
rotta, mentre oggi — come diceva questa lista — non se ne rompe nessuna. È un
lavoro da fare quando lo si può fare tutto in una volta.

**Integrazioni dirette, API pubblica, esportazione programmata.** Non sono tre
voci: sono tre progetti. Ognuno vuole cose che il prodotto oggi non ha —
un'applicazione OAuth approvata da ciascuna piattaforma, un client per ciascuna
API con i suoi limiti e i suoi rinnovi di token, custodia delle credenziali di
negozi altrui, chiavi pubbliche da emettere e revocare, un'esecuzione periodica
per organizzazione. Sono settimane, e vanno decisi in ordine: quale piattaforma
per prima, e se prima dell'API pubblica non convenga sentire cosa chiedono i
primi clienti.

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

**Il §2 è chiuso: 2.1 → 2.9, tutte fatte.** Era la lista di ciò che rendeva il
prodotto non lanciabile; adesso non c'è più niente lì dentro che lo impedisca.

Restano tre cose, e non sono codice — le decide chi vende:

1. **I prezzi veri.** Quelli in archivio sono segnaposto (29,00 / 99,00 /
   199,00 €). Stanno nel database, quindi si cambiano senza un rilascio:
   `update billing_products set price_cents = … where key = …`.
2. **Stripe in produzione:** chiavi live e webhook.
3. **Le variabili sul deploy:** `LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS`,
   `LEGAL_EMAIL`, `LEGAL_CITY`, `SUPPORT_EMAIL`, e l'SMTP per le email di
   accesso. Finché mancano, le pagine legali si dichiarano non valide e il piede
   dice che l'assistenza non è configurata: è voluto, meglio del silenzio.

Poi si lancia, e §3 si fa con gli utenti veri davanti.
