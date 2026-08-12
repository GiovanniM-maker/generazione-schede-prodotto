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
4. **§2.2–2.4** — testi e messaggi: molto valore per poco lavoro.
5. **§4** — le cose che si leggono male.
6. **§5** — telefono, il resto.
7. **§6** — la coda dei minori.

Il §7 va riverificato prima di toccare qualsiasi cosa.
