import { type TourStep } from '@/components/onboarding/guided-tour';
import type { StepDef, SourceCard } from '@/components/batch/passi/tipi';

// Gli undici passi, i loro fumetti, e le fonti fra cui si sceglie.
//
// Sono DATI, non interfaccia: qui si legge la mappa del wizard senza dover
// scorrere le schermate che la disegnano.
// ---------------------------------------------------------------------------

export const STEP_DEFS: StepDef[] = [
  { id: 1, title: 'Informazioni' },
  { id: 2, title: 'Preset' },
  { id: 3, title: 'Fonti' },
  { id: 4, title: 'Istruzioni e template' },
  { id: 5, title: 'Caricamento' },
  { id: 6, title: 'Analisi file' },
  { id: 7, title: 'Associazione SKU' },
  { id: 8, title: 'Mapping attributi' },
  { id: 9, title: 'Verifica dati' },
  { id: 10, title: 'Campione' },
  { id: 11, title: 'Conferma e avvio' },
];

// Tour guidato ("fumettini") per passo: i target sono gli attributi data-tour.
// I passi il cui elemento non è in pagina vengono saltati automaticamente.
export const STEP_TOURS: Record<number, TourStep[]> = {
  1: [
    {
      target: 'batch-name',
      title: 'Dai un nome al lavoro',
      body: 'Un batch è un "lotto" di prodotti da generare insieme. Il nome serve solo a te per ritrovarlo (es. «Catalogo vini marzo»).',
    },
    {
      target: 'preset-pick',
      title: 'Scegli il preset',
      body: 'Il preset è il modello della scheda: categorie e dati da compilare. Se non ne vedi nessuno, crealo prima da Configurazione → Preset (anche a chat con il Copilot).',
    },
    {
      target: 'wizard-guide',
      title: 'Se ti blocchi, chiedi qui',
      body: 'Questa chat ti guida in ogni momento: dimmi cosa hai in mano (foto, Excel o entrambi) e ti dico esattamente cosa fare, passo per passo. Gratis e istantanea.',
    },
  ],
  3: [
    {
      target: 'sources',
      title: 'Da dove arrivano i dati?',
      body: 'Solo foto: l’AI legge le etichette. Solo Excel: dati certi dal file. Entrambe: il meglio — si agganciano tramite SKU. Puoi tornare qui e cambiare quando vuoi.',
    },
  ],
  5: [
    {
      target: 'upload-file',
      title: 'Carica il file dati',
      body: 'CSV o Excel con una colonna SKU. Le altre colonne le mappi dopo — comprese quelle extra del fornitore, che puoi importare come dati aggiuntivi.',
    },
    {
      target: 'upload-images',
      title: 'Carica le foto',
      body: 'Trascina anche centinaia di immagini: il caricamento è parallelo. Lo SKU viene letto dal nome del file (es. «1234-fronte.jpg»).',
    },
    {
      target: 'sku-separator',
      title: 'Controlla lo SKU',
      body: 'Se gli SKU rilevati sembrano sbagliati (es. «1234-fronte» invece di «1234»), cambia il separatore qui: il ricalcolo è immediato.',
    },
  ],
  7: [
    {
      target: 'sku-column',
      title: 'Indica la colonna SKU',
      body: 'È il codice che identifica ogni prodotto e aggancia le foto al file. L’abbiamo pre-selezionata se riconosciuta: controlla che sia giusta.',
    },
    {
      target: 'category-column',
      title: 'La categoria: mappata o dedotta',
      body: 'Se il file ha una colonna categoria, sceglila qui: assegnazione certa, zero AI. Se non ce l’hai, lascia vuoto: l’AI la dedurrà dalle foto (o la assegni a mano al passo Verifica).',
    },
  ],
  8: [
    {
      target: 'mapping',
      title: 'Collega le colonne agli attributi',
      body: 'Per ogni attributo del preset scegli la colonna del file che lo contiene. Abbiamo già suggerito gli abbinamenti evidenti: controlla e completa.',
    },
    {
      target: 'extra-columns',
      title: 'Non sprecare le colonne extra',
      body: 'Il file ha colonne che il preset non prevede (es. «descrizione materiale»)? Spuntale: diventano dati in più per l’AI. Più dati = schede migliori.',
    },
  ],
  9: [
    {
      target: 'analyze',
      title: 'Fai leggere le foto all’AI',
      body: 'Estrae i dati stampati sulle etichette (peso, ingredienti, marchio…). Parte comunque in automatico all’avvio della generazione: qui puoi lanciarla in anticipo.',
    },
    {
      target: 'assign-categories',
      title: 'Categorie a mano (se vuoi)',
      body: 'Qui puoi assegnare la categoria per singolo SKU o in blocco. La categoria decide quali dati l’AI cerca per ogni prodotto.',
    },
  ],
  10: [
    {
      target: 'sample',
      title: 'Prova gratis prima di spendere',
      body: 'Il campione genera la scheda di un prodotto di prova e te la mostra qui sotto: controlli tono e qualità senza consumare crediti.',
    },
  ],
  11: [
    {
      target: 'launch',
      title: 'Si parte!',
      body: 'Qui vedi quanti prodotti sono pronti e quanti crediti verranno riservati (1 per prodotto). La generazione gira in background: tieni aperta la pagina di elaborazione e a fine corsa trovi tutto in Risultati.',
    },
  ],
};

/**
 * I passi in cui non si compila, si guarda: lì il guscio si allarga.
 *
 * È il 5 e basta. Il 7 e l'8 parlano anche loro del foglio, ma con dei menu a
 * tendina — un menu largo 1600 px non si sceglie meglio. Il 5 invece mostra il
 * foglio vero, ed è il momento in cui si verifica che il file sia stato letto
 * giusto: in 768 px se ne vedevano tre colonne su dodici.
 */
export const SOURCE_CARDS: SourceCard[] = [
  { mode: 'images', title: 'Solo immagini', description: 'Carichi solo le foto dei prodotti. Lo SKU viene letto dal nome del file (es. TSHIRT001_front.jpg).' },
  { mode: 'spreadsheet', title: 'CSV o Excel', description: 'Carichi un foglio con una riga per SKU e le colonne degli attributi.' },
  { mode: 'both', title: 'Immagini + CSV', description: 'Combini foglio e immagini: gli SKU della colonna SKU vengono associati al prefisso dei nomi immagine.' },
  { mode: 'url', title: 'Da URL', description: 'Incolli i link delle pagine prodotto (le tue o del fornitore): estraiamo i dati e le foto, poi l’AI riscrive la scheda.', note: 'Novità' },
  // «In arrivo» e «Prossimamente» erano due parole per lo stesso stato, una
  // accanto all'altra. Una sola, e la sceglie il codice in base a `disabled`:
  // così non si può più scriverne una terza per sbaglio.
  { mode: null, title: 'Google Drive', description: 'Colleghi una cartella Drive con file e immagini.', disabled: true },
  { mode: 'sku', title: 'Lista SKU', description: 'Incolli i codici articolo: li cerchiamo online, agganciamo la pagina del produttore ed estraiamo dati e foto.', note: 'Novità' },
  { mode: 'pdf', title: 'PDF', description: 'Carichi le schede tecniche in PDF, una per prodotto: leggiamo le coppie «etichetta: valore» dichiarate nel documento.', note: 'Novità' },
];
