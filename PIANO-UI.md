# Cosa sistemare nell'interfaccia

Sei revisioni indipendenti, condotte guardando il prodotto in un browser vero:
flusso batch a desktop, flusso batch su telefono, sezione configurazione,
dodici larghezze da 320 a 1920 più zoom al 200% e telefono in orizzontale, stati
vuoti ed errori, pagine pubbliche. **371 screenshot**, su un'organizzazione con
dati veri — preset pubblicato, cinque batch in stati diversi, dodici schede
generate con descrizioni lunghe, dubbi aperti, dati di fatturazione — e una
seconda organizzazione appena nata.

## Come leggere questo documento

Ogni voce è marcata così:

- **✔ verificato** — l'ho rimisurato personalmente, con i numeri qui sotto.
- **○ riportato** — viene da una revisione, è plausibile e circostanziato, ma non
  l'ho ancora rifatto io.
- **✗ non riprodotto** — ci ho provato e non l'ho visto. Resta scritto, perché
  un'affermazione che non regge va detta, non cancellata.

Il motivo di questa disciplina è dentro questo stesso audit: **due delle mie
misure precedenti erano sbagliate**, e in un caso avevo archiviato come «non
regge» un difetto che invece c'era (§1 qui sotto). Le prove sono in
`scratchpad/audit-ui/`.

---

## Stato: fatto finora

**§1 — la malattia strutturale.** Corretta e bloccata. `min-w-0` sulle righe
delle schede, `grid-cols-1` (cioè `minmax(0,1fr)`) sulle griglie che le
contengono, gruppo dell'intestazione che si comprime invece di spingere.
La colonna «Azioni» dei risultati è agganciata al bordo destro, con una
sfumatura che dice che la tabella scorre. `e2e/larghezze.spec.ts` percorre
320/360/390/768 e fallisce nominando l'elemento colpevole.

Una scoperta durante la correzione: **`scrollWidth` non basta**. Con `min-w-0`
il gruppo si comprime invece di sfondare, quindi il documento resta largo
quanto lo schermo *mentre due comandi finiscono uno sopra l'altro*. È successo
davvero aggiungendo il collegamento «Lavori»: a 320px il gruppo copriva il
logo. Ora c'è anche un test di sovrapposizione.

**§2.1 — i prezzi invisibili.** Corretto alla radice: la regola di lettura su
`billing_products` è `to anon, authenticated` (migrazione
`20250101000028_listino_pubblico.sql`, applicata a produzione e staging). Un
visitatore anonimo vede 29,00 / 99,00 / 199,00 €. Aggiunto lo stato vuoto che
mancava — se il listino non si legge, la sezione lo dice e indica dove il
prezzo c'è comunque, invece di aprirsi sul niente — e un errore di lettura
finisce nei log. Il test sta in `e2e/interfaccia.spec.ts` e gira **senza
sessione**: è l'unico modo di provare quella regola.

> Nota su un'affermazione mia sbagliata: avevo concluso che la vetrina fosse
> renderizzata staticamente e catturasse i prezzi in compilazione. Non è così —
> il build la classifica `ƒ (Dynamic)`, perché legge i cookie. I prezzi si
> cambiano dal database senza un rilascio, come promesso.

**§3 — i vicoli ciechi.** Tutti e sei chiusi:

| | |
|---|---|
| 3.1 | «Lavori» è nell'intestazione, da ogni schermata; sulla dashboard il collegamento all'elenco c'è appena esiste un batch, non solo sopra i dieci |
| 3.2 | `app/not-found.tsx`: un 404 in italiano, con due uscite vere |
| 3.3 | «Torna ai tuoi lavori» porta ai lavori; nell'errore globale, dove la dashboard è la destinazione giusta, a cambiare è l'etichetta |
| 3.4 | la pagina di avanzamento ha una via d'uscita **sempre**, non solo a lavoro finito |
| 3.5 | la guida non parte su un passo bloccato: copriva il collegamento che lo sbloccava |
| 3.6 | un batch fallito non ha più l'aspetto di uno riuscito (`lib/esito-elaborazione.ts`, con i suoi test) |

I quattro vicoli si provano cliccando e guardando dove si arriva —
`e2e/vie-duscita.spec.ts` — non controllando che un `href` esista.

**§2.2–2.4 — le parole e il colore.**

- **2.2** Gli errori dell'accesso passano da `lib/errori-accesso.ts`: i casi noti
  diventano un consiglio in italiano («aspetta un minuto e riprova» invece di
  `email rate limit exceeded`), i casi ignoti diventano una frase nostra, e il
  testo originale finisce nei log — tradurre non vuol dire perdere. Sparisce
  anche il messaggio che chiedeva all'utente di impostare
  `NEXT_PUBLIC_SUPABASE_URL`.
- **2.3** Al checkout, quando il guasto è nostro si dice una cosa sola e giusta:
  non è colpa tua, **non ti è stato addebitato niente**, ecco cosa fare. Il
  motivo tecnico va nei log. Quello che il cliente *può* correggere — i dati per
  la fattura, il ruolo sbagliato — resta specifico com'era.
- **2.4** `accent` passa da `#e5322d` (4,35:1) a `#c22b27` (5,72:1), `accentHover`
  a `#a32320` (7,45:1). Misurato **nel browser**, non solo in configurazione:
  tutte le azioni del percorso di acquisizione stanno a 5,72:1. Il test non
  blocca l'esadecimale, ricalcola il rapporto WCAG dal file — così custodisce la
  regola invece del valore.
- **2.5** Il link incollato da qualche parte ora si presenta: `og:`, `twitter:`
  e un `canonical` diverso per ogni pagina. L'immagine dell'anteprima è
  **generata** (`app/opengraph-image.tsx`) e non un file caricato — un PNG in
  `public/` resterebbe identico per anni dopo che il marchio è cambiato, perché
  nessuno ricorda che esiste. La descrizione per i motori non promette più solo
  «catalogo moda»: era scritta quando il prodotto era solo per la moda, e chi
  cercava schede per alimentari leggeva di vestiti.

  > Difetto che mi sono fatto da solo, e che vale la pena ricordare: avevo messo
  > `canonical: '/'` nel guscio. I metadati si ereditano, quindi finiva su
  > **ogni** pagina pubblica e dichiarava ai motori che privacy, termini, cookie
  > e accesso *sono* la vetrina — il modo più rapido di far sparire tre
  > documenti legali dall'indice, senza che a schermo cambi niente. Ogni pagina
  > ora dichiara il proprio, e il test lo verifica una rotta alla volta.

**§4 — le cose che si leggono male.** Cinque voci su sei corrette; la sesta non
c'era più.

| | |
|---|---|
| 4.1 | **✗ non si riproduce più.** Misurato a 1440: le righe sono alte 63 px tutte e tre, «Nome» 209 px e tronca, «Titolo» 256. E il contenuto è diverso davvero — il «duplicato» era un artefatto dei miei dati di prova, dove avevo messo il titolo generato uguale al nome del prodotto. Nessuna modifica. |
| 4.2 | La spunta ce l'ha solo chi ha finito: prima l'icona era la stessa e cambiava solo il colore, e con la configurazione appena iniziata si vedevano **cinque spunte accanto a «0/5»**. Ora la forma dice lo stato, e c'è un'etichetta per chi ascolta. |
| 4.3 | Via i segnaposto che fingono: `placeholder="ELIMINA"` era esattamente la parola da digitare — il campo sembrava già compilato — e `123456` nel campo del codice era indistinguibile da un codice inserito. |
| 4.4 | Una fonte non ancora disponibile non ha più l'aria di una novità: viola per quella usabile, grigio per le altre. E «In arrivo»/«Prossimamente» erano due parole per lo stesso stato, affiancate: ora è una sola, scelta dal codice. |
| 4.5 | «Contatto di assistenza non ancora configurato» non si dice più al cliente. Non è sparito: è passato alla pagina «Servizio», in un riquadro «Da configurare» insieme ai dati del titolare, cioè dove lo legge chi può sistemarlo. |
| 4.6 | I tipi di dato si leggono in italiano ovunque. C'erano **tre** fonti: una lista grezza per la tendina di creazione — dove `multi_enum` era l'unica cosa scritta — e due mappe che dicevano la stessa cosa in modo diverso («testo lungo» contro «Testo lungo»). Ora una sola, e l'elenco della tendina si ricava dalle etichette. |

**§5 — su telefono.** Quattro voci su cinque corrette; la quinta era già a
posto.

| | |
|---|---|
| 5.1 | La barra della configurazione era una colonna di 358×**344** px, `static`, su tutte e nove le pagine: il titolo cominciava al **56%** dell'altezza dello schermo. Ora è una striscia che scorre, alta **40** px, e il titolo è al **18%**. Da `lg` torna colonna. |
| 5.2 | Con una modale aperta la pagina sotto scorreva: `document.body` aveva `overflow: visible` anche con un `[role=dialog]` presente. Ora si blocca, con la compensazione della barra di scorrimento su desktop, e si sblocca alla chiusura. |
| 5.3 | Il banner cookie è `fixed`: arrivati in fondo si appoggiava sopra «Privacy · Termini · Cookie» — **compreso il collegamento alla Cookie Policy che il banner stesso cita**. Per leggerlo bisognava accettare. Ora si riserva lo spazio misurando la propria altezza (che cambia con la larghezza). Verificato: il piede finisce a 675, il banner comincia a 675. |
| 5.4 | «Accetta selezionati (1)» a 360 px misurava 123×**32** con dentro 123×**46**: il testo usciva sopra e sotto la pillola, bianco su fondo crema. La causa è generale — le misure dei pulsanti fissano l'altezza, quindi una seconda riga esce invece di allargare — e la correzione è nel componente: `whitespace-nowrap`. A mandare a capo è il contenitore. |
| 5.5 | **✗ già a posto.** La barra dei comandi del wizard è `rgb(251, 248, 243)` piena, senza sfocatura, sia a 390 sia a 1440: era stata corretta col §1. |

`e2e/telefono.spec.ts` tiene ferme tutte e cinque. Mutando le quattro
correzioni, i quattro controlli tornano rossi ciascuno col proprio numero: «il
titolo comincia al 51% dello schermo», «il banner copre dei collegamenti del
piede», «la pagina sotto la modale scorre ancora», «123x32 contiene 123x46».

Il collegamento «salta al contenuto» è il terzo strumento di misura in cui
inciampa: è `sr-only`, cioè ritagliato a 1×1 finché non riceve il fuoco, e
qualunque controllo sulle dimensioni lo prende per un difetto. Ora lo saltano
tutti, per la stessa ragione scritta nello stesso modo.

**§6 — i minori.** Sette voci su dodici corrette, una non riprodotta, quattro
lasciate con la loro misura.

Corrette: le barre di comandi vanno a capo (6.1/6.2 — vedi sotto); i bersagli
tattili sotto i 24 px non ci sono più, «Cosa significa?» e «Chiudi la guida»
erano 20×20, il chiudi delle modali era 24 esatti — sul filo, che non è un
margine — e «Modifica preset» alto 17 (6.7); la colonna «Azioni» di Team
compare solo se c'è qualcuno da rimuovere, prima era larga 134 px e vuota per
un proprietario da solo (6.8); «Provincia» e «Paese» misurano entrambi 128 px,
prima 254 e 128 per due campi da due caratteri (6.10); i termini non
descrivono più un accesso «tramite link via email», che il prodotto ha smesso
di usare — un documento legale che descrive un prodotto diverso da quello in
uso è sbagliato in un modo che nessun test di interfaccia vede (6.12).

**Non riprodotta:** il piede non ancorato (6.6). Su `/input` a 390 px la pagina
è più alta dello schermo, quindi non c'è nessun vuoto sotto il piede.

**Lasciate, con la misura:** 6.3 (il pulsante d'aiuto sui link legali), 6.4 (la
barra di avanzamento che cambia larghezza fra i passi), 6.9 (i segnaposto
tagliati nelle textarea) e 6.5 — il wizard largo 768 dentro un guscio da 1152.
Il 6.5 in particolare **non lo correggo apposta**: allargarlo peggiora la
leggibilità di un modulo, e centrarlo o stringere il guscio rimetterebbe il
titolo a saltare di lato fra un passo e l'altro, che è esattamente il difetto
chiuso col §3.1.

### Correggendo il §6 ho trovato una regressione mia

`categories` e `attributes` sforavano di **147 px** a 320. Il difetto di base
era del piano (6.2, «escono dallo schermo sotto 343 px»), ma senza il
`whitespace-nowrap` che avevo aggiunto col §5.4 lo sforo era di 23 px: la mia
correzione l'ha reso **sei volte peggiore**. La causa vera è che quelle barre
hanno tre pulsanti e non andavano a capo; ora vanno a capo, e lo sforo è zero.

Era passata inosservata perché il test delle larghezze guardava **una sola**
pagina di configurazione, `presets`, che di pulsanti ne ha due. Ora ne guarda
tre. Una pagina campione non copre una sezione.

---

## 7. Non ha retto la verifica — riverificato

La prima affermazione resta non riprodotta. **La seconda invece si riproduce**,
e l'avevo archiviata io: premendo «Crea» senza nome, la modale resta aperta,
l'avviso «Il nome è obbligatorio» esiste con `role="alert"` — e nel suo punto
centrale l'elemento davanti è il velo della modale. Chi guarda non vede
succedere niente e ripreme.

Il messaggio veniva reso nel corpo della pagina mentre la modale è
`fixed inset-0`. Chi usa un lettore di schermo lo sentiva comunque: uno dei
rari casi in cui era informato meglio di chi lo schermo lo guarda.

Corretto nel componente condiviso — `Modal` ha ora un posto per l'errore
dell'azione che ha lanciato lei — e applicato agli undici punti che ne avevano
bisogno. Il riquadro di pagina si spegne mentre una modale è aperta: altrimenti
lo stesso messaggio finiva nel DOM due volte e veniva annunciato due volte.

Lezione: «non sono riuscito a riprodurlo» non è «non c'è». La prima volta avevo
provato con meno pazienza.

---

Un difetto l'ho introdotto io mentre correggevo il 4.2 — un `text-gray-400`, che
sul nostro fondo fa 2,4:1 — e l'ha preso un test che c'era già. È il motivo per
cui quel test esiste.

E quattro dei miei test nuovi sono nati rossi leggendo **i miei stessi
commenti**: spiegavo sopra il codice com'era prima («diceva
`placeholder="ELIMINA"`») e il test trovava la frase lì dentro. C'era già un
`senzaCommenti()`, scritto la volta scorsa per lo stesso motivo, chiuso dentro
un solo file: ora sta in un posto solo. Un test che legge la spiegazione invece
del prodotto si dà ragione da solo — e se scritto al contrario, tiene in piedi
il verde con il commento.

---

## Trovato correggendo: un test con un punto cieco — **✔ verificato, poi chiuso**

Il riquadro d'errore della pagina di accesso **non aveva `role="alert"`**: la
frase compariva e restava muta per chi usa un lettore di schermo, sull'unica
pagina dove non si può fare altro che aspettare un errore o un codice. Corretto
passando ad `Avviso`.

Il punto è come era sopravvissuto. Il test del §3.2 cerca i riquadri rossi
scritti a mano così:

```
/<div className="rounded-lg border border-red-200 bg-red-50[^"]*">/
```

cioè pretende che le classi comincino in quel modo. Il riquadro dell'accesso
scriveva `flex items-start gap-2 rounded-lg border border-red-200 …`: stesse
classi, ordine diverso, invisibile al test. **Un test che cerca una stringa e
non una proprietà dà una sicurezza che non ha.**

Cercando la proprietà erano **tredici** in rosso — e cercandola sul serio, cioè
su tutta la tavolozza dei riscontri e non solo sugli errori, **ventidue** in
tredici file. Erano più di quelli che avevo contato: il primo conteggio cercava
`border-*-200` e si era perso un `border-amber-300` dentro il wizard. Lo stesso
errore del test che stavo criticando, fatto mentre lo criticavo.

**Chiuso.** Tutti convertiti ad `Avviso`, che porta il ruolo giusto: `alert` per
gli errori, che interrompe; `status` con `aria-live="polite"` per conferme e
avvisi, che aspettano il loro turno.

Il test ora estrae le classi da `className` e cerca la **proprietà** — un fondo
della tavolozza dei riscontri insieme al bordo intonato, in qualunque ordine,
compresi i rami di un ternario. Le eccezioni sono sei file dove quella tavolozza
vuol dire altro: il componente `Badge` che la definisce, il bordo di una scheda
pericolosa, l'evidenziazione di un confronto, il pannello di registrazione coi
suoi comandi, la tinta di una riga, un riquadro che contiene un campo da
scegliere. Sono elencate una per una col loro perché, e un secondo test impedisce
che l'elenco si allunghi: un elenco corto e motivato è una scelta, uno lungo
sarebbe il difetto travestito da test verde.

### E cinque prove erano rosse da prima, su `main`

Verificate su un albero pulito, quindi non sono di questo lavoro — ma **due le
avevo causate io col §3.2**, e nessuno se n'era accorto perché la suite del
browser non veniva eseguita per intero.

- **Due** misuravano il collegamento «salta al contenuto» come bersaglio da
  toccare. È `sr-only`: invisibile finché non riceve il fuoco, e da invisibile
  misura 1×1. Nessun dito lo cercherà mai lì, e chi ci arriva ci arriva col Tab
  — quando è grande. Ora il misuratore salta gli elementi ritagliati.
- **Tre** cercavano «Passo 1 di N». Il wizard scrive il totale solo dopo che si
  è scelta la fonte, perché prima **quanti passi ci sono non si sa**: dipende da
  file, foto o URL. Tacere è la scelta giusta; era la prova a pretendere un
  numero che il prodotto ha smesso di promettere.

Restano alcune prove che passano da sole e cadono quando la suite gira tutta
insieme: creano batch veri e aspettano elenchi che arrivano dal database. Sono
**lente, non rotte** — con un tentativo di riserva la suite è verde. Renderle
indipendenti dal carico è un lavoro a sé, e va fatto: una prova che cade a caso
insegna a ignorare i fallimenti, che è il modo in cui questi cinque erano
sopravvissuti.

---

## 1. La malattia strutturale: contenuto più largo del suo contenitore

Tre revisioni indipendenti l'hanno incontrata in tre punti diversi. È **una sola
regola CSS sbagliata**, ripetuta.

Quando un elemento con `truncate` (cioè `white-space: nowrap`) sta dentro un
`flex` o un `grid` senza `min-w-0`, la troncatura **si vede** ma la larghezza
intrinseca **continua a propagarsi verso l'alto**: la traccia della griglia si
dimensiona sul testo intero. L'ellissi c'è, e intanto la pagina si allarga.

### 1.1 Su telefono, un nome di batch lungo sfonda l'intera applicazione — **✔ verificato**

| viewport | larghezza pretesa dal documento |
|---|---|
| 390 | **768 px** |
| 360 | **769 px** |
| 320 | **768 px** |

Non è un titolo che esce di qualche pixel. Il *layout viewport* si allarga a 768,
cioè supera sia la soglia `sm` (640) sia la `md` (768): **il telefono riceve il
layout del desktop e ne vede la metà sinistra.** «Esporta», «Apri» e il cestino
finiscono fuori schermo: non si può aprire un batch senza scorrere di lato.

Controprova: nascondendo quel solo titolo si torna a 390. Mettere `min-width: 0`
sull'`h3` **non basta** (resta 768): la costrizione va messa sul contenitore
della riga e sulla traccia della griglia.

Punti da correggere: `apps/web/components/recent-batch-card.tsx:90` (la riga
`flex flex-wrap` attorno al titolo), `apps/web/app/app/page.tsx:293` e
`apps/web/app/app/batches/page.tsx:97` (`grid gap-4` senza `grid-cols-1` o
`minmax(0,1fr)`).

Fasce misurate: rotto **da 320 a 867 px**, pulito da 868. Sotto 640 il documento
pretende 768; da 640 a 867 ne pretende 868 — cioè peggiora attraversando la
soglia. A 720 (zoom 200% su 1440) sfora di 148 px, a 844 (telefono in
orizzontale) di 24.

**Dipende dai dati**, ma non è un caso limite: a 360 px basta un nome da 41
caratteri. E la pagina `/app/batches` resta rotta sempre, perché mostra 25 batch
e prima o poi uno lungo c'è.

### 1.2 Nei risultati, due azioni su quattro sono invisibili — **✔ verificato**

La tabella è larga **1225 px** dentro un contenitore da **1102**: sfora di 123.
Sulla prima riga:

| comando | visibile |
|---|---|
| Dettaglio e modifica | 40/40 px |
| Accetta | **21/40 px** |
| Rifiuta | **0/40 px** |
| Rigenera | **0/40 px** |

Identico a **1920, 1440 e 1280 px**: non dipende dallo schermo, perché il
contenitore è limitato dal guscio dell'applicazione. Non c'è né barra di
scorrimento visibile né sfumatura che suggerisca che a destra c'è dell'altro.

**Questa è la voce che avevo archiviato per errore nel §3.4.** L'avevo misurata
su 153 prodotti *senza schede generate*: la colonna «Titolo» era vuota e la
tabella ci stava. Con contenuti veri non ci sta.

### 1.3 In configurazione, la colonna «Azioni» è fuori vista — **○ riportato**

- `/app/settings/presets` a 1440: tabella 868 px in un contenitore da 850 →
  «AZIONI» si legge «AZION».
- Su telefono, dentro contenitori da 356 px: **512 px nascosti** su Preset, 409
  su Categorie, 463 su Attributi. Tutte le azioni fuori schermo, su 34 e 55
  righe, senza alcun segnale che si possa scorrere.
- Su Preset la colonna resta fuori vista **fino a 1024 px**.

### Cosa fare

Una regola sola, applicata ovunque: **ogni contenitore di testo troncabile
riceve `min-w-0`, ogni griglia di card usa `minmax(0,1fr)`**. Poi, dove una
tabella deve davvero scorrere, si dice che scorre — una sfumatura sul bordo
destro basta.

E poiché questa famiglia è già ricomparsa tre volte, va bloccata con un test che
percorre le rotte a 320/360/390/768 e fallisce se `scrollWidth > clientWidth`.

---

## 2. Le cose che costano clienti

### 2.1 Sulla vetrina, per chi non è ancora cliente, **i prezzi non ci sono** — **✔ verificato**

Scaricando `/` da sconosciuto: dopo il titolo «Pacchetti di crediti» e il
sottotitolo si passa direttamente alle domande frequenti. Zero cartellini, zero
cifre, nemmeno un messaggio.

Causa, a due passi che non si vedono insieme:

- la politica di accesso su `billing_products` è `to authenticated` (verificata
  nel database: ruoli `{authenticated}`, condizione `active = true`);
- la landing legge quella tabella con il client che rispetta le regole di
  accesso, e un visitatore anonimo non è autenticato → zero righe.

**Tutto il §2.5 — «il prezzo visibile *prima* del checkout» — funziona solo per
chi è già cliente.** Cioè per chi il prezzo l'ha già pagato.

Aggravante: non c'è nemmeno uno stato vuoto. Se la lettura non dà righe, la
sezione sparisce in silenzio.

Correzione: una politica di lettura pubblica su `billing_products` (è un
listino: è fatto per essere letto da tutti), più uno stato esplicito se davvero
non c'è niente da mostrare.

### 2.2 Gli errori dell'accesso escono in inglese, grezzi dal fornitore — **✔ verificato**

`apps/web/lib/actions/auth.ts` fa `return { error: error.message }`. Testi
realmente mostrati sull'unica porta d'ingresso del prodotto:

- `Email address "..." is invalid`
- `email rate limit exceeded`

Il resto della pagina è curato in italiano.

### 2.3 Un errore di configurazione finisce davanti a chi voleva pagare — **✔ verificato**

Premendo «Acquista» con Stripe non configurato, il messaggio mostrato al cliente
è **«Prezzo Stripe non configurato»**. Il pulsante si comporta bene (torna
attivo, l'errore ha `role="alert"`), ma il testo è nostro gergo interno.

### 2.4 Il rosso dei richiami all'azione non raggiunge il contrasto minimo — **○ riportato**

Bianco su `#e5322d` = **4,35:1**, sotto il minimo di 4,5:1. Riguarda ogni azione
del percorso di acquisizione: «Prova gratis», «Prova con 3 prodotti», «Invia
codice di accesso», «Verifica e accedi». Esiste già `accentHover #c22b27` che fa
5,72:1. È la §1.6 del piano precedente, mai fatta.

### 2.5 Nessuna anteprima quando si condivide il link — **✔ verificato**

Zero tag `og:`, zero `twitter:`, zero `canonical` su tutte le pagine pubbliche.
Il link incollato su WhatsApp o LinkedIn esce come indirizzo nudo. E la
descrizione per i motori di ricerca promette ancora solo «catalogo moda», mentre
il prodotto vende soprattutto al food.

---

## 3. Vicoli ciechi e vie d'uscita mancanti

### 3.1 Dalla dashboard non si può creare un batch — **✔ verificato**

Elencando tutti i link del contenuto della dashboard: nessuno verso
`/app/batches`, nessuno verso `/app/batches/new`. I sei link che sembrano tali
sono gli «Apri» delle bozze. Il pulsante «Nuovo batch» esiste solo su
`/app/batches`, raggiungibile solo scrivendo l'indirizzo — perché il link «Vedi
tutti» compare **solo sopra i 10 batch**. Con cinque batch si è in un vicolo
cieco.

### 3.2 Fuori dalle rotte dei batch, il 404 è quello nudo di Next — **✔ verificato**

`/app/una-pagina-che-non-esiste` risponde «404 · This page could not be found»:
in inglese, senza intestazione, **zero link**. Ho costruito un 404 curato per i
batch inesistenti e ho lasciato scoperto tutto il resto.

### 3.3 «Torna ai tuoi lavori» non porta ai lavori — **✔ verificato**

Il pulsante punta a `/app` (la dashboard), mentre «i tuoi lavori» è ora
`/app/batches`, che si intitola proprio «Tutti i lavori». Incoerenza introdotta
creando quella pagina.

### 3.4 `/processing` ha due azioni, ed è la stessa — **✔ verificato**

Due comandi dentro il contenuto, entrambi «Vai ai risultati». Nessun modo di
fermare, di tornare al batch, di vedere il campione.

### 3.5 Su un'organizzazione nuova, la guida copre l'unica via d'uscita — **○ riportato**

Aprendo `/app/batches/new` parte da sola una guida a fumetti che scurisce la
pagina. Il riquadro che spiega il vero blocco — «Nessun preset pubblicato», con
il link per andarlo a creare — resta sotto la velatura: `click()` sul link va in
**timeout**, e `elementFromPoint` restituisce il velo della guida.

### 3.6 Un batch fallito sembra riuscito — **○ riportato**

Titolo «Generazione in corso», spunta **verde** accanto a «Elaborazione
conclusa», e i contatori dicono «0 Falliti» — su un batch fallito. L'unico
indizio è una pastiglia rossa piccola in alto a destra. Nessuna spiegazione,
nessun «riprova».

---

## 4. Cose che si leggono male

### 4.1 «Nome» e «Titolo» sono la stessa colonna — **✔ verificato**

Contenuto identico in 4 righe su 4 campionate. «Nome» è larga 120 px e va a capo
su 2–4 righe, «Titolo» 256 px e sta su una riga: le altezze di riga oscillano fra
**73 e 105 px**, +44%, e il ritmo verticale della tabella salta.

### 4.2 Cinque spunte accanto a «0/5» — **○ riportato**

Nella lista «Completezza configurazione», lo stato «da fare» usa **la stessa
icona di spunta** del «fatto», cambiando solo colore. Cinque spunte grigie
accanto al conteggio «0/5» si contraddicono a vista.

### 4.3 Il segnaposto è identico alla parola da digitare — **○ riportato**

Il campo di conferma dell'eliminazione account ha `placeholder="ELIMINA"`, cioè
esattamente la stringa richiesta: il campo sembra già compilato e il pulsante
sembra disattivato senza motivo. Lo stesso vale sul login: dopo un codice
sbagliato il campo si svuota, ma il segnaposto «1 2 3 4 5 6» è indistinguibile da
un codice digitato.

### 4.4 «Disponibile» e «non disponibile» hanno lo stesso aspetto — **○ riportato**

Al passo 3 del wizard i badge «Novità» (fonte attiva), «In arrivo» e
«Prossimamente» (fonti disabilitate) hanno **stili computati identici**. E sono
due parole diverse per lo stesso stato, affiancate.

### 4.5 «Contatto di assistenza non ancora configurato» — **✔ verificato**, ma da riformulare

Compare in fondo a ogni schermata. È voluto: l'ho scritto perché `SUPPORT_EMAIL`
non è impostata, e dire il vero è meglio che offrire un indirizzo morto. Ma
**tre revisioni su sei l'hanno classificato come guasto**. Se tre revisori
indipendenti lo scambiano per un difetto, la formulazione è sbagliata: va detto
al proprietario del prodotto, non al cliente.

### 4.6 Valori grezzi in inglese nell'interfaccia — **○ riportato**

`text`, `long_text`, `integer`, `measurement`, `percentage` compaiono nella
colonna «Dato» degli attributi e nel menu della modale.

---

## 5. Su telefono

### 5.1 La barra laterale della configurazione occupa il 41% della prima schermata — **○ riportato**

358×344 px in cima a tutte e nove le pagine, `position: static`, senza modo di
chiuderla. Il titolo della pagina comincia al 56% dell'altezza dello schermo.

### 5.2 Le modali non bloccano lo scorrimento della pagina sotto — **○ riportato**

Con una modale aperta, una rotellata fa scorrere il contenuto dietro la velatura
di 1200 px. `document.body` ha `overflow: visible` anche con `[role=dialog]`
presente. (Il fuoco invece è gestito bene: entra, resta, torna — verificato in
questa stessa revisione.)

### 5.3 Il banner cookie copre i link legali — **○ riportato**

A fondo pagina il banner (169 px) sta sopra «Privacy · Termini · Cookie», cioè
copre proprio il link alla Cookie Policy che il banner stesso cita.

### 5.4 «Accetta selezionati (N)» perde il testo fuori dal pulsante — **○ riportato**

A 360 px l'etichetta esce sopra e sotto la pillola rossa, in bianco su fondo
crema: illeggibile.

### 5.5 La barra dei comandi del wizard è traslucida — **○ riportato**

Il 5% di trasparenza più la sfocatura non nascondono il testo sottostante: lo
rendono illeggibile ma visibile. E a desktop la barra è **completamente
trasparente**, con sovrapposizioni misurate di 115×26 px sulle schede.

---

## 6. Difetti minori, raggruppati

- Barra di navigazione: sfora di 8 px sotto i 328 px di larghezza.
- «Nuova categoria» e «Nuovo attributo» escono dallo schermo sotto 343 e 336 px.
- Il pulsante flottante «Serve aiuto?» riduce di 6 px l'area cliccabile dei link
  legali, fra 640 e 1415 px.
- La barra di avanzamento del wizard cambia larghezza di 99 px fra un passo e
  l'altro, perché il pulsante «Guida» c'è solo su alcuni passi.
- Il wizard è largo 768 px dentro un guscio da 1104: una fascia vuota di un terzo
  di schermo a 1440.
- Il piè di pagina non è ancorato al fondo: 232 px di vuoto su `/input` a 390 px.
- Bersagli tattili a 20×20 px («Cosa significa?», «Chiudi la guida»); il pulsante
  di chiusura delle modali è 24×24.
- La colonna «Azioni» di Team è larga 145 px ed è **vuota**.
- Nel dettaglio preset, il testo dei segnaposto è tagliato a metà riga nelle
  textarea (20 px nascosti).
- I campi «Provincia» (254 px) e «Paese» (128 px) della fattura hanno larghezze
  diverse pur contenendo entrambi due caratteri.
- Zero elementi `<img>` sulle pagine pubbliche: il primo esempio visivo di cosa
  produce il prodotto sta a 1,7 schermate di scorrimento.
- I termini di servizio descrivono un accesso «tramite link via email», mentre il
  login manda un codice a sei cifre.

---

## 7. Non ha retto la verifica

**«Premendo Acquista senza dati di fatturazione la rotella gira all'infinito e
non compare nessun messaggio.»** — **✗ non riprodotto.** Ho cliccato e
campionato a 1,5 s, 4 s e 8 s: il pulsante torna attivo, riprende la sua
etichetta, e il messaggio d'errore c'è con `role="alert"`. Resta valido il
problema del *testo* del messaggio (§2.3).

**«L'errore "Il nome è obbligatorio" viene disegnato dietro la modale.»** —
**✗ non riprodotto da me.** Il mio tentativo non ha trovato alcun avviso. La
dinamica è plausibile leggendo il codice (l'avviso è reso nel corpo della pagina,
la modale è una sovrapposizione fissa), ma **va riverificata prima di correggere
qualcosa**.

---

## 8. Verificato e sano

Vale la pena scriverlo, perché è il metro di quanto sopra.

- **Le cinque pagine pubbliche sono pulite a tutte e quattordici le condizioni**
  provate: mai uno scorrimento laterale, mai un elemento fuori dal viewport, mai
  testo tagliato.
- **Nessuna rotta ha problemi a 1024, 1180, 1280, 1440, 1920.**
- Le **modali gestiscono il fuoco correttamente**: entra all'apertura, resta
  dentro con Tab e Shift+Tab, torna al punto di partenza alla chiusura, Esc
  chiude. (Il lavoro del §3.2 regge.)
- La **tabella dei risultati su telefono** si trasforma correttamente in schede
  impilate, senza tagli.
- Le **pagine legali non sono un muro di testo**: 44–50 caratteri per riga su
  telefono, titoli numerati, spaziature costanti. E l'avviso «Documento non
  ancora valido» unito a `noindex` è una bozza dichiarata invece di una bozza
  travestita.
- Il **contrasto del testo di contenuto** sta fra 4,63:1 e 16,98:1 — l'unica
  eccezione è il bianco sul rosso di marca (§2.4).
- Gli **stati vuoti della dashboard e dei preset** sono il modello: spiegano cosa
  manca e come uscirne, invece di constatare un vuoto.
- I **testi degli errori della fattura** dicono cosa correggere e come («Se non
  hai un codice, scrivi 0000000 e indica la PEC»).
- Le **spaziature verticali della vetrina** sono coerenti: `py-16` su tutte le
  sezioni interne, `py-28` solo sull'apertura. Nessuna sezione fuori scala.
- **Un solo `h1` per pagina**, gerarchia dei titoli senza salti.
- Il **banner cookie** non ricompare dopo il consenso, e a desktop non copre
  niente di decisivo.

---

## Ordine consigliato

1. ~~**§1 — la malattia strutturale.**~~ **fatto**
2. ~~**§2.1 — i prezzi invisibili sulla vetrina.**~~ **fatto**
3. ~~**§3 — i vicoli ciechi.**~~ **fatto**
4. ~~**§2.2–2.4** — testi e messaggi.~~ **fatto**
5. ~~**La coda del §3.2** — i riquadri che non parlano.~~ **fatto**
6. ~~**§2.5** — l'anteprima quando si condivide il link.~~ **fatto**
7. ~~**§4** — le cose che si leggono male.~~ **fatto**
8. ~~**§5** — telefono.~~ **fatto**
9. ~~**§6** — la coda dei minori.~~ **fatto per sette voci su dodici**; le
   quattro rimaste sono elencate sopra con la loro misura, e il §7 è
   riverificato.

Il §7 va riverificato prima di toccare qualsiasi cosa.

---

## 9. La revisione estetica

Cinque revisioni indipendenti, chieste dopo che tutto il resto era chiuso, con
una domanda diversa da quelle di sopra: non «cosa è rotto» ma «cosa non stupisce
nessuno». Quattro convergenze e due difetti veri.

### Le due cose rotte che ha trovato una revisione estetica — **✔ fatte**

Vale la pena notare da dove sono uscite: nessuna delle sei revisioni funzionali
le aveva viste.

**9.1 Il banner cookie stava sopra tutto.** Era a `z-50`, cioè la quota delle
modali — e reso *dopo* nel documento, quindi a parità vinceva lui. Copriva anche
i cassetti dei risultati e del preset, che stanno più in basso. Alla prima
visita, su telefono, non si riusciva a creare una categoria senza prima
accettare i cookie: il banner è arredamento di pagina e stava sopra il lavoro.
Sceso a `z-20`, e la scala delle quote è ora scritta nel file, una volta sola:

```
10 contenuto appiccicato · 20 intestazione e banner · 30-40 cassetti ·
50 modali · 60 barra dei comandi del wizard · 70 guide a fumetti ·
100 «salta al contenuto»
```

Guardia: `il banner cookie non copre le modali` in `e2e/telefono.spec.ts`, più un
test unitario che il banner resti sotto la quota 30.

**E la guardia me l'ero scritta sbagliata.** La prima versione confrontava il
banner col riquadro bianco della modale: su un telefono quello sta in alto e il
banner in fondo, quindi non si toccano — la sonda stampava «nessuna
sovrapposizione» e il test passava **per assenza di bersaglio**. L'ho scoperto
solo perché, invece di fidarmi del verde, ho rimesso il difetto (`z-50`) e il
test è rimasto verde lo stesso. Il bersaglio giusto è la **velatura**, che è
`fixed inset-0` e quindi copre sempre anche il banner: col difetto rimesso, il
dito sul banner tocca il banner invece della velatura, ed è esattamente quello
che si vedeva — il rettangolo bianco che buca lo schermo scurito. Rimessa la
correzione, verde di nuovo.

**9.2 Il passo 9 del wizard non diceva di stare lavorando.** `setPassoInCaricamento`
c'era per i passi 2, 6 e 8 e **mancava proprio al 9** — l'unico che scrive i
prodotti a database. Su un catalogo grosso si preme «Conferma», non succede
niente per parecchi secondi, e la tentazione di premere di nuovo è tutta lì.
Aggiunto su entrambi i rami (foglio di calcolo e URL), con `finally` e pulizia.
Guardia: `il wizard non lascia saltare la verifica` in `parole.test.ts`, che
pretende la chiamata per tutti e quattro i passi lenti.

### 9.3 L'inchiostro caldo — **✔ fatto**

Il fondo del prodotto è crema `#fbf8f3` e l'inchiostro del marchio è `#17130f`:
caldi tutti e due. Ma ogni singolo grigio a schermo era quello di serie di
Tailwind, che tende al blu — **641 usi di grigi freddi contro 54 dell'inchiostro
di marca**, e `brand.muted`, il grigio caldo già scritto in configurazione, usato
**zero volte** in tutto il prodotto. Un fondo caldo con sopra un'interfaccia
fredda: non si nota guardando una schermata, si vede benissimo affiancandone due.

Non è solo gusto. I grigi freddi su fondo caldo contrastano *meno*, e
`gray-500` — il colore di tutto il testo secondario — stava a **4,56:1**, cioè
sei centesimi sopra il minimo.

Ora c'è una scala `ink` derivata dall'inchiostro, dieci gradini, e ogni gradino
contrasta più del grigio che sostituisce. Il caso che conta è il 500: da 4,56 a
**5,40:1**, in quasi trecento punti del prodotto. Sostituzione meccanica, 65
file, **zero grigi freddi rimasti** — verificato anche a schermo, censendo i
colori davvero disegnati sulla vetrina: sette tinte, tutte della scala calda più
il rosso di marca e il bianco.

Due cose che la sostituzione meccanica avrebbe sbagliato, e che ho corretto a
mano:

- **Sul fondo scuro la scala va letta al contrario.** L'etichetta «crediti»
  nell'intestazione dell'app è finita a `ink-500` su `bg-brand`, dove il caldo
  contrasta *meno* del freddo che sostituiva. Portata a `ink-300` (8,24:1).
- **Il tono `gray` del badge** l'avevo escluso pensandolo semantico. Non lo è:
  è il «nessuno stato», cioè il neutro della pagina, ed era l'ultimo posto in
  cui il grigio freddo era rimasto. Il nome della proprietà resta — si scrive
  nei punti d'uso — la tinta no.

Cinque guardie in `identita-visiva.test.ts`, tutte che **ricalcolano** i numeri
dalla configurazione invece di bloccare esadecimali: che la scala sia ordinata,
che i gradini da testo passino il 4,5:1 sul crema, che il 500 batta `gray-500`,
che i fondi restino chiari, che sull'intestazione scura si usi il capo chiaro. E
una sesta che nel prodotto non rientri un grigio freddo — perché la sostituzione
è stata meccanica, quindi il ritorno lo sarebbe altrettanto: basta un
`text-gray-500` copiato da un esempio trovato online.

La guardia esistente su `gray-400` andava aggiornata: dopo la sostituzione quel
nome non esisteva più in nessun file, quindi il test passava **per assenza di
bersaglio**, non per assenza di difetto. Ora copre entrambi i quarti gradini —
`ink-400` sta a 3,48:1, meglio del 2,4 di prima, sempre sotto il minimo.

### Quello che resta, nell'ordine

4. **Far respirare i dati** — larghezza piena sui passi e sulle schermate che
   mostrano dati veri, intestazioni di tabella fisse, colonne ricalcolate.
5. **Portare la prova in superficie** — il confronto riga-di-listino/prosa
   nell'apertura della vetrina, la fascia della consegna sopra i risultati, il
   campione composto invece che ingabbiato.
6. **Le nove pagine che ignorano `PageShell`.**
