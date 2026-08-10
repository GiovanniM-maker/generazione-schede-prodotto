# Test con un browser vero

I test unitari non vedono l'interfaccia. Una pagina che scorre di lato sul
telefono, un pulsante troppo piccolo per il pollice, un elemento che ne copre un
altro, un errore JavaScript: restano invisibili finché qualcuno non apre la
pagina. Questi test aprono la pagina.

---

## Le tre suite

| comando | cosa copre | serve una sessione? |
|---|---|---|
| `pnpm --filter web test:ui` | pagine pubbliche: landing, login, pagine legali | no |
| `pnpm --filter web test:auth` | onboarding, wizard, risultati | sì |
| `pnpm test` | i 338 test unitari (logica, non interfaccia) | no |

Ogni suite gira su **due profili**: `desktop` (1280×900) e `mobile` (390×844,
con il tocco). Il profilo telefono è definito a mano perché i device "iPhone" di
Playwright sono WebKit, e negli ambienti di sviluppo qui c'è solo Chromium.

---

## Il progetto di staging

I test autenticati creano utenti, organizzazioni, batch e prodotti **veri**. Non
devono farlo sul database di produzione.

Progetto dedicato: **`vixptjwtthxyhqpumwyc`** — "Verificato — staging QA",
regione `eu-west-1`. Ha lo stesso schema della produzione (tutte le migrazioni)
e lo stesso catalogo di base (settori, categorie e attributi di sistema, con gli
stessi identificativi).

Per puntarci si usa `apps/web/.env.staging` — **non versionato**, contiene le
chiavi. Si crea copiando `.env.local` e sostituendo tre valori:

```
NEXT_PUBLIC_SUPABASE_URL=https://vixptjwtthxyhqpumwyc.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<chiave publishable dello staging>
SUPABASE_SERVICE_ROLE_KEY=<chiave secret dello staging>
```

Rigenerare lo schema su un progetto nuovo: applicare in ordine i file di
`supabase/migrations/`, poi `supabase/seed_config.sql` e
`supabase/seed_config_food_pharma.sql`.

---

## Come si lancia

```bash
# server con la configurazione di staging
cd apps/web && set -a && . ./.env.staging && set +a && npx next dev

# in un altro terminale
cd apps/web
set -a && . ./.env.staging && set +a
QA_ALLOW_WRITES=1 npx playwright test e2e/autenticato.spec.ts e2e/wizard-risultati.spec.ts
```

### Due lucchetti prima di scrivere

I test autenticati si **saltano da soli** se manca una delle due condizioni:

1. `SUPABASE_SERVICE_ROLE_KEY` presente;
2. `QA_ALLOW_WRITES=1`.

Servono a impedire che partano per sbaglio contro produzione. Se un giorno
`.env.local` finisse caricato per errore, senza `QA_ALLOW_WRITES` non succede
niente.

---

## Come si ottiene la sessione

**Senza scorciatoie nel prodotto.** La via facile sarebbe una rotta
`/api/test-login`: una porta di servizio che resta lì per sempre e prima o poi
diventa un buco. Invece (`e2e/sessione.ts`):

1. si crea un utente di prova con l'API di amministrazione;
2. si ottiene una sessione vera con email e password;
3. si chiede a `@supabase/ssr` — **la stessa libreria che usa l'app** — quali
   cookie scriverebbe, e si mettono nel browser.

Il formato dei cookie non è indovinato: lo produce la libreria.

Ogni worker parallelo ha **il suo utente** (`qa+claude-w0@…`, `qa+claude-w1@…`):
con un indirizzo solo, i due profili si contendevano lo stesso utente e uno lo
cancellava mentre l'altro lo stava usando.

### Pulizia

`eliminaUtenteDiProva` cancella **prima le organizzazioni, poi l'utente** — nello
stesso ordine dell'azione "elimina account" dell'app. Cancellare solo l'utente
lascia l'organizzazione in piedi, senza membri e senza nessuno che possa
toccarla.

---

## I dati seminati

`e2e/semina.ts` scrive direttamente lo stato finale: preset Food con tre
categorie, un batch con tre prodotti e le loro schede già generate, di cui una
con confidenza bassa apposta (la revisione deve segnalarla).

Percorrere sette passi di onboarding, caricare un file e aspettare la
generazione a ogni test costerebbe minuti e chiamate all'AI. La semina usa la
chiave di servizio, cioè scavalca le regole di accesso: è legittimo perché sta
**costruendo** lo stato, non simulando un utente. Il controllo degli accessi
resta verificato dai test che passano dall'app.

Due dettagli che sembrano cavilli e non lo sono:

- il preset ha bisogno di `active_version_id` **e** `published_at`, altrimenti il
  wizard non lo propone — e fa bene: una bozza non è scegliibile;
- gli identificativi dei settori sono deterministici nel seed, quindi lo stesso
  `SETTORE_FOOD` vale su staging e in produzione.

---

## Cosa misurano i test dell'interfaccia

- **risposta 200** e **nessun errore JavaScript**;
- **nessuno scorrimento orizzontale** — il difetto più fastidioso su un telefono
  e il più facile da introdurre: basta una tabella o un titolo lungo;
- **nessun testo sotto i 12px**;
- **ogni comando almeno 24×24px** (WCAG 2.2 AA).

Sulla misura delle aree di tocco due accortezze, imparate sbagliando:

- l'**overlay di sviluppo di Next** non fa parte dell'app e va escluso;
- un elemento che ne **contiene** un altro interattivo è solo un involucro: l'area
  che il dito tocca è quella del figlio. Un `<a>` inline attorno a un bottone
  risulta alto quanto una riga di testo, ma il bottone dentro è grande.

Entrambi avrebbero prodotto falsi allarmi.

---

## Nota sull'ambiente

Chromium è già presente. Se il pacchetto Playwright del progetto ne cerca una
build diversa dalla sua, fallisce con `Executable doesn't exist`: sembra un muro,
è un flag. `playwright.config.ts` punta a `/opt/pw-browsers/chromium`
(sovrascrivibile con `CHROMIUM_PATH`) e aggiunge `--no-sandbox`, che nei
container serve perché si gira come root.
