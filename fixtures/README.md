# Fixtures — dati di esempio per test e demo

Questi file esercitano il principio cardine del prodotto: **i dati possiedono i
fatti, l'AI possiede la prosa**. L'AI non deve mai inventare attributi (materiale,
colore, composizione, vestibilita, claim) che non siano presenti nei dati.

Tutti i CSV sono in UTF-8.

## File

| File | Scenario di test |
| --- | --- |
| `fashion-valid.csv` | 8 prodotti moda puliti (giacche, camicie, maglioni, pantaloni, abiti). Ogni riga ha >=4 fatti, quindi qualita "buono". Caso felice per parsing e generazione. |
| `fashion-variants.csv` | Raggruppamento padre/variante tramite `codice_padre`. 3 prodotti padre, ciascuno con 2-3 varianti di colore/taglia. Verifica il raggruppamento delle varianti. |
| `fashion-missing-data.csv` | Righe con dati mancanti: alcune complete, alcune parziali (composizione o vestibilita vuota), una con solo sku+nome (insufficiente, <2 fatti extra, da escludere) e una senza nome. Verifica il gating di qualita e l'esclusione. |
| `fashion-italian-headers.csv` | Header in sinonimi italiani (`codice articolo`, `composizione tessuto`, `vestibilità`, ...). Verifica la mappatura deterministica delle intestazioni. |
| `fashion-english-headers.csv` | Header in inglese (`article code`, `fabric composition`, `care instructions`, ...). Verifica la mappatura deterministica delle intestazioni. |
| `fashion-adversarial.csv` | 10 casi golden/avversariali (vedi sotto). Verifica che l'AI non inventi ne inferisca attributi. |
| `fashion-conflicting-data.csv` | Gemello CSV del file XLSX. Righe con conflitti tra fonti (colore gestionale vs foto, composizione dichiarata vs etichetta). Verifica le regole di precedenza dei dati. |
| `fashion-conflicting-data.xlsx` | Generato da `build-xlsx.mjs` (richiede `exceljs`). Stesso contenuto del CSV gemello, per testare il parsing XLSX. |
| `build-xlsx.mjs` | Script Node che genera l'xlsx. Vedi commento in testa al file: `node fixtures/build-xlsx.mjs` dopo `pnpm add -D exceljs`. |

## Casi avversariali (`fashion-adversarial.csv`)

Colonne: `sku,nome,tipologia,colore,composizione,materiale,vestibilita,note`.

1. **ADV-01** — Giacca senza materiale/composizione (colonne vuote). L'AI NON deve inventare il materiale.
2. **ADV-02** — Nome "effetto seta" ma composizione `100% poliestere`. NON deve diventare seta.
3. **ADV-03** — Nota "resistente all'acqua". NON deve diventare "impermeabile".
4. **ADV-04** — Composizione divisa `Corpo: 80% cotone 20% elastan; Fodera: 100% poliestere`. Corpo e fodera vanno tenuti distinti.
5. **ADV-05** — Colore a gestionale `Blu`, la nota segnala che in foto appare nero. Vince il colore del gestionale (caso discordanza foto).
6. **ADV-06** — Nessun valore di vestibilita. L'AI NON deve inventarla.
7. **ADV-07** — Nessun claim di sostenibilita presente. NON deve aggiungere "sostenibile".
8. **007123** — SKU con zero iniziale. Il parser deve preservarlo come stringa, non convertirlo in `7123`.
9. **ADV-09 / ADV-10** — Due righe stesso `nome`, colore diverso (Bianco/Nero): varianti dello stesso modello.

## Nota sugli SKU

SKU come `007123` sono testo semplice nei file. I **parser** non devono coercerli
a numero (perderebbero lo zero iniziale). Lo script `build-xlsx.mjs` forza il
formato testo sulla colonna sku nell'xlsx.
