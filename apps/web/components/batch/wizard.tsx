'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  Sparkles,
  UploadCloud,
  FileSpreadsheet,
  HelpCircle,
  Image as ImageIcon,
  Download,
  ArrowLeft,
  ArrowRight,
  LifeBuoy,
} from 'lucide-react';
import {
  listPublishedPresets,
  createBatchV2,
  rileggiFoglio,
  riprendiBatch,
  getPresetExplorer,
  setBatchSources,
  uploadBatchFiles,
  createImageUploadTargets,
  registerUploadedImages,
  reparseImageSkus,
  analyzeBatch,
  getBatchPresetAttributes,
  confirmImportV2,
  getBatchProductsV2,
  getBatchCategoryOptions,
  importFromUrls,
  type PublishedPresetSummary,
  type PresetExplorer,
  type UploadSpreadsheetResult,
  type UploadImagesResult,
  type UploadedFileSummary,
  type PresetAttributeOption,
  type BatchProductRow,
  type ImportResultV2,
  type WizardSourceType,
} from '@/lib/actions/batch-wizard';
import { runVisualExtractionForBatch } from '@/lib/actions/visual';
import {
  startVisualAnalysisAction,
  getVisualAnalysisProgressAction,
} from '@/lib/actions/visual-background';
import { CategoryAssigner } from '@/components/batch/category-assigner';
import { ImageQcPanel } from '@/components/batch/image-qc-panel';
import { GuidedTour, tourSeen, markTourSeen, type TourStep } from '@/components/onboarding/guided-tour';
import { HelpBubble } from '@/components/onboarding/help-bubble';
import { WizardGuide } from '@/components/onboarding/wizard-guide';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { etichettaTipoDato } from '@/lib/tipi-dato';
import {
  COMPLETENESS_LABELS,
  COMPLETENESS_TONES,
  normalizeCompleteness,
  type Completeness,
} from '@/lib/completeness';

// ---------------------------------------------------------------------------
// Wizard "Nuovo batch" v2 — multi-step, centrato sullo SKU. Ogni passo chiama
// le server action e mostra gli errori restituiti inline.
// ---------------------------------------------------------------------------

// SHA-256 esadecimale nel browser (stesso formato di createHash('sha256').digest('hex')
// lato server). Serve a registrare i file: la colonna sha256 è NOT NULL.
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Il browser a volte non riconosce il MIME (File.type = ''): lo deriviamo
// dall'estensione, così la colonna mime_type (NOT NULL) è sempre valorizzata.
function mimeFromName(name: string, fallbackType: string): string {
  if (fallbackType && fallbackType.trim()) return fallbackType;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? 'application/octet-stream';
}

type AnalyzeData = Extract<Awaited<ReturnType<typeof analyzeBatch>>, { ok: true }>['data'];

/** Copy generata per il campione (mostrata inline nello step Campione). */
interface SampleCopy {
  title?: string;
  shortDescription?: string;
  longDescription?: string;
  bullets?: string[];
  metaDescription?: string;
}

type SourceMode = 'images' | 'spreadsheet' | 'both' | 'url';

interface StepDef {
  id: number;
  title: string;
}

const STEP_DEFS: StepDef[] = [
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
const STEP_TOURS: Record<number, TourStep[]> = {
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

const SPREADSHEET_STEPS = new Set([7, 8]);

/**
 * Messaggio per un guaio di rete durante una server action.
 *
 * Senza questo l'errore restava un `Failed to fetch` inglese, o peggio: la
 * pagina restava su «Caricamento in corso…» per sempre, anche tornando
 * online, perché il `setBusy(false)` stava dopo un `await` che aveva lanciato.
 */
function messaggioDiRete(e: unknown): string {
  const grezzo = e instanceof Error ? e.message : String(e);
  if (/fetch|network|load failed|connessione/i.test(grezzo)) {
    return 'Connessione persa. Controlla la rete e riprova: il lavoro fatto finora è salvo.';
  }
  return grezzo || 'Errore imprevisto. Riprova.';
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Suggerisce l'header più simile a un attributo (match esatto poi contenuto). */
function fuzzyHeader(attr: PresetAttributeOption, headers: string[]): string {
  const targets = [normalize(attr.name), attr.key ? normalize(attr.key) : ''].filter(Boolean);
  for (const h of headers) {
    if (targets.includes(normalize(h))) return h;
  }
  for (const h of headers) {
    const nh = normalize(h);
    if (targets.some((t) => t.length >= 4 && (nh.includes(t) || t.includes(nh)))) return h;
  }
  return '';
}

export function BatchWizard({ imageNamingGuide }: { imageNamingGuide: string }) {
  const router = useRouter();
  const parametri = useSearchParams();

  const [stepId, setStepId] = useState(1);
  /** Ripresa in corso: finché non finisce non si mostra il passo 1 a vuoto. */
  const [ripresaInCorso, setRipresaInCorso] = useState(false);

  // Tour guidato del passo corrente: si apre da solo la prima volta, poi solo
  // dal pulsante "Guida".
  const [tourOpen, setTourOpen] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [presetVersionId, setPresetVersionId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode | null>(null);
  // Ogni scatto è una richiesta d'aiuto dalla barra dei comandi (su telefono).
  const [chiediAiuto, setChiediAiuto] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Il passo che sta ancora caricando i suoi dati.
   *
   * `busy` copriva solo le azioni esplicite (crea, importa, genera): i
   * caricamenti dei passi 2, 6, 8 e 9 giravano in un effetto e non lo
   * toccavano. Risultato: «Continua» restava premibile e cliccando al ritmo
   * normale si attraversavano mappatura e verifica SENZA VEDERLE, arrivando
   * alla generazione su dati mai controllati. Tre revisioni indipendenti
   * dell'audit ci sono inciampate.
   */
  const [passoInCaricamento, setPassoInCaricamento] = useState<number | null>(null);

  // Step 1
  const [name, setName] = useState(() => {
    // Precompilato: l'utente pigro può cliccare "Crea e continua" e basta.
    const d = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    return `Batch ${d}`;
  });
  const [description, setDescription] = useState('');
  const [presets, setPresets] = useState<PublishedPresetSummary[] | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // La guida parte da sola solo su un passo che si può davvero fare.
  //
  // Su un'organizzazione nuova il passo 1 mostra «Nessun preset pubblicato»
  // con l'unico collegamento utile della pagina — quello che porta a crearne
  // uno — e il velo della guida ci finiva sopra: il clic non arrivava, e chi
  // era appena entrato restava chiuso dentro l'aiuto invece che dal problema.
  //
  // Aspetta anche che i preset siano CARICATI (`null` = ancora in arrivo):
  // aprire e richiudere il fumetto mezzo secondo dopo è peggio che aspettare.
  const passoAvviabile = stepId !== 1 || (presets !== null && presets.length > 0);
  useEffect(() => {
    setTourOpen(
      passoAvviabile && Boolean(STEP_TOURS[stepId]) && !tourSeen(`wizard.${stepId}.v1`),
    );
  }, [stepId, passoAvviabile]);

  // Step 2
  const [explorer, setExplorer] = useState<PresetExplorer | null>(null);
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());
  const [expandedAttr, setExpandedAttr] = useState<Set<string>>(new Set());

  // Step 5
  const [spreadsheetResult, setSpreadsheetResult] = useState<UploadSpreadsheetResult | null>(null);
  const [imagesResult, setImagesResult] = useState<UploadImagesResult | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [skuDelimiter, setSkuDelimiter] = useState<'_' | '-' | '.' | ' ' | 'none'>('_');
  const [reparsing, setReparsing] = useState(false);

  // Step 6
  const [analysis, setAnalysis] = useState<AnalyzeData | null>(null);

  // Step 7
  const [skuHeader, setSkuHeader] = useState('');
  const [categoryHeader, setCategoryHeader] = useState('');
  // Il nome del prodotto: colonna dedicata come SKU e categoria. Prima non
  // c'era e ogni prodotto importato si chiamava come il suo codice.
  const [nameHeader, setNameHeader] = useState('');
  // Rimappatura manuale dei valori categoria non riconosciuti: valore file → categoryId.
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});
  const [parentHeader, setParentHeader] = useState('');
  const [importOption, setImportOption] = useState<'complete' | 'includeImageOnly' | 'excludeIncomplete'>('complete');

  // Step 8
  const [attributes, setAttributes] = useState<PresetAttributeOption[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // Colonne libere del file da importare come fatti: header -> nome attributo.
  const [extraCols, setExtraCols] = useState<Record<string, string>>({});

  // Step 9
  const [products, setProducts] = useState<BatchProductRow[] | null>(null);
  const [importSummary, setImportSummary] = useState<ImportResultV2 | null>(null);

  // Step 3 — import da URL (uno per riga).
  const [urlText, setUrlText] = useState('');

  // Step 9 — analisi immagini automatica (OCR etichette + categoria dedotta).
  const [analyzingImages, setAnalyzingImages] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);

  // Step 11 — avviso email a fine generazione (opt-in, attivo di default).
  const [notifyByEmail, setNotifyByEmail] = useState(true);

  // Step 10
  const [sampleDone, setSampleDone] = useState(false);
  const [sampleCompleteness, setSampleCompleteness] = useState<Completeness | null>(null);
  const [sampleContent, setSampleContent] = useState<SampleCopy | null>(null);

  const hasSpreadsheet = sourceMode === 'spreadsheet' || sourceMode === 'both';
  const hasImages = sourceMode === 'images' || sourceMode === 'both';

  const activeSteps = STEP_DEFS.filter((s) => !SPREADSHEET_STEPS.has(s.id) || hasSpreadsheet);
  const activeIndex = activeSteps.findIndex((s) => s.id === stepId);

  const goTo = useCallback((id: number) => {
    setError(null);
    setStepId(id);
  }, []);

  const nextStep = useCallback(() => {
    const idx = activeSteps.findIndex((s) => s.id === stepId);
    const next = activeSteps[idx + 1];
    if (next) goTo(next.id);
  }, [activeSteps, stepId, goTo]);

  const prevStep = useCallback(() => {
    const idx = activeSteps.findIndex((s) => s.id === stepId);
    const prev = activeSteps[idx - 1];
    if (prev) goTo(prev.id);
  }, [activeSteps, stepId, goTo]);

  // --- Loaders per-step ---

  // Step 1: preset pubblicati.
  useEffect(() => {
    if (presets !== null) return;
    void listPublishedPresets().then((res) => {
      if (res.ok) {
        setPresets(res.data);
        // Utente pigro: con UN solo preset pubblicato lo selezioniamo noi.
        if (res.data.length === 1 && res.data[0]) {
          setSelectedPresetId((cur) => cur ?? res.data[0]!.id);
        }
      } else setError(res.error);
    });
  }, [presets]);

  // Step 2: esploratore preset.
  useEffect(() => {
    if (stepId !== 2 || !presetVersionId) return;
    setExplorer(null);
    setPassoInCaricamento(2);
    void getPresetExplorer({ presetVersionId })
      .then((res) => {
        if (res.ok) setExplorer(res.data);
        else setError(res.error);
      })
      .catch((e: unknown) => setError(messaggioDiRete(e)))
      .finally(() => setPassoInCaricamento((p) => (p === 2 ? null : p)));
  }, [stepId, presetVersionId]);

  // Step 6: analisi.
  useEffect(() => {
    if (stepId !== 6 || !batchId) return;
    setAnalysis(null);
    setPassoInCaricamento(6);
    void analyzeBatch({ batchId })
      .then((res) => {
        if (res.ok) {
          setAnalysis(res.data);
          if (!skuHeader && res.data.suggestedSkuHeader) setSkuHeader(res.data.suggestedSkuHeader);
        } else setError(res.error);
      })
      .catch((e: unknown) => setError(messaggioDiRete(e)))
      .finally(() => setPassoInCaricamento((p) => (p === 6 ? null : p)));
  }, [stepId, batchId, skuHeader]);

  // Step 8: attributi + header per mapping.
  useEffect(() => {
    if (stepId !== 8 || !batchId) return;
    setAttributes(null);
    setPassoInCaricamento(8);
    void getBatchPresetAttributes({ batchId })
      .then((res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAttributes(res.data.attributes);
      setHeaders(res.data.headers);
      if (!skuHeader && res.data.suggestedSkuHeader) setSkuHeader(res.data.suggestedSkuHeader);
      setMapping((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const next: Record<string, string> = {};
        for (const attr of res.data.attributes) {
          const guess = fuzzyHeader(attr, res.data.headers);
          if (guess) next[attr.id] = guess;
        }
        return next;
      });
      })
      .catch((e: unknown) => setError(messaggioDiRete(e)))
      .finally(() => setPassoInCaricamento((p) => (p === 8 ? null : p)));
  }, [stepId, batchId, skuHeader]);

  // Step 7: prova a indovinare la colonna Categoria dalle intestazioni.
  useEffect(() => {
    if (stepId !== 7 || categoryHeader) return;
    const hs = spreadsheetResult?.headers ?? [];
    const guess = hs.find((h) =>
      ['categoria', 'category', 'reparto', 'famiglia', 'tipologia', 'macrocategoria'].includes(
        normalize(h),
      ),
    );
    if (guess) setCategoryHeader(guess);
  }, [stepId, spreadsheetResult, categoryHeader]);

  // Step 7: e la colonna Nome. Il suggerimento arriva dal server insieme al
  // file (come quello dello SKU): la logica sta in @app/core, che qui non si
  // può importare — è un componente client e il pacchetto porta con sé
  // `node:crypto`.
  useEffect(() => {
    if (stepId !== 7 || nameHeader) return;
    const guess = spreadsheetResult?.suggestedNameHeader;
    if (guess && guess !== skuHeader) setNameHeader(guess);
  }, [stepId, spreadsheetResult, nameHeader, skuHeader]);

  // DEFAULT: appena il file è pronto, TUTTE le colonne vengono importate come
  // dati (fatti per SKU). L'utente può poi ESCLUDERE quelle che non servono.
  // Così non serve mappare nulla e la generazione ha sempre abbastanza dati.
  useEffect(() => {
    if (!spreadsheetResult) return;
    setExtraCols((prev) => {
      if (Object.keys(prev).length > 0) return prev; // non sovrascrivere le scelte
      const next: Record<string, string> = {};
      for (const h of spreadsheetResult.headers) next[h] = h;
      return next;
    });
  }, [spreadsheetResult]);

  // SKU, Nome e Categoria non sono "dati" da importare: sono l'identità della
  // riga. Lasciarli fra i fatti farebbe raccontare all'AI il codice a barre.
  useEffect(() => {
    setExtraCols((prev) => {
      if (!prev[skuHeader] && !prev[categoryHeader] && !prev[nameHeader]) return prev;
      const next = { ...prev };
      if (skuHeader) delete next[skuHeader];
      if (categoryHeader) delete next[categoryHeader];
      if (nameHeader) delete next[nameHeader];
      return next;
    });
  }, [skuHeader, categoryHeader, nameHeader]);

  // Step 9: import + prodotti (+ analisi immagini automatica).
  useEffect(() => {
    if (stepId !== 9 || !batchId) return;
    const bid = batchId;
    let cancelled = false;

    // Se il batch ha immagini, l'analisi (OCR etichette + categoria dedotta) va
    // SEMPRE fatta: è indispensabile perché i prodotti abbiano fatti e categoria.
    // La facciamo da soli, senza chiederlo, e poi ricarichiamo i prodotti.
    const withImages = hasImages || sourceMode === 'url';
    // L'analisi gira ORA IN BACKGROUND (server + cron): qui la avviamo e ne
    // seguiamo il progresso. Se l'utente chiude la pagina il lavoro continua e
    // riprende da dove era rimasto — prima invece si fermava.
    const autoAnalyze = async () => {
      if (!withImages) return;
      setAnalyzingImages(true);
      await startVisualAnalysisAction({
        batchId: bid,
        // Categoria mappata dal file → non dedurla dalle foto (solo fatti).
        skipCategory: hasSpreadsheet && Boolean(categoryHeader),
      });
      // Dà una spinta subito (senza aspettare il giro di cron), best-effort.
      void runVisualExtractionForBatch({
        batchId: bid,
        skipCategory: hasSpreadsheet && Boolean(categoryHeader),
      }).catch(() => {});

      while (!cancelled) {
        const p = await getVisualAnalysisProgressAction({ batchId: bid });
        if (cancelled) return;
        if (p.ok) {
          setAnalyzeProgress({ done: p.data.done, total: p.data.total });
          if (p.data.status === 'done' || p.data.status === 'error') break;
          // Tutti i prodotti hanno dati: non c'è altro da attendere.
          if (p.data.total > 0 && p.data.done >= p.data.total) break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (cancelled) return;
      const relist = await getBatchProductsV2({ batchId: bid });
      if (!cancelled && relist.ok) setProducts(relist.data.products);
      if (!cancelled) {
        setAnalyzingImages(false);
        setAnalyzeProgress(null);
      }
    };

    // «Continua» si spegne anche QUI.
    //
    // Era protetto ai passi 2, 6 e 8, e non al 9 — cioè l'unico passo che
    // SCRIVE i prodotti. Durante l'importazione la pagina è vuota, e l'unico
    // oggetto colorato dello schermo era «Continua»: un clic e si saltava la
    // verifica dei dati appena importati, arrivando al campione senza averli
    // mai guardati. È lo stesso difetto già corretto per gli altri tre passi,
    // fermatosi un passo prima.
    setPassoInCaricamento(9);
    const finito = () => setPassoInCaricamento((p) => (p === 9 ? null : p));

    // Import da URL: i prodotti sono già stati creati da importFromUrls.
    // NON rieseguire confirmImportV2 (cancellerebbe i prodotti importati).
    if (sourceMode === 'url') {
      setProducts(null);
      void (async () => {
        try {
          const list = await getBatchProductsV2({ batchId: bid });
          if (cancelled) return;
          if (list.ok) setProducts(list.data.products);
          else setError(list.error);
          await autoAnalyze();
        } finally {
          finito();
        }
      })();
      return () => {
        cancelled = true;
        finito();
      };
    }
    setProducts(null);
    setImportSummary(null);
    const options = {
      includeImageOnly: hasImages && (importOption === 'includeImageOnly' || sourceMode === 'images'),
      excludeIncomplete: importOption === 'excludeIncomplete',
    };
    void (async () => {
      try {
      const imp = await confirmImportV2({
        batchId: bid,
        skuHeader: hasSpreadsheet ? skuHeader : '',
        attributeMapping: hasSpreadsheet ? mapping : {},
        nameHeader: hasSpreadsheet && nameHeader ? nameHeader : undefined,
        categoryHeader: hasSpreadsheet ? categoryHeader : undefined,
        categoryOverrides: hasSpreadsheet && Object.keys(categoryOverrides).length > 0 ? categoryOverrides : undefined,
        parentHeader: hasSpreadsheet && parentHeader ? parentHeader : undefined,
        extraColumns: hasSpreadsheet
          ? Object.entries(extraCols).map(([header, name]) => ({ header, name: name || header }))
          : undefined,
        options,
      });
      if (cancelled) return;
      if (!imp.ok) {
        setError(imp.error);
        return;
      }
      setImportSummary(imp.data);
      const list = await getBatchProductsV2({ batchId: bid });
      if (cancelled) return;
      if (list.ok) setProducts(list.data.products);
      else setError(list.error);
      await autoAnalyze();
      } finally {
        finito();
      }
    })();
    return () => {
      cancelled = true;
      finito();
    };
  }, [stepId, batchId]);

  // -------------------------------------------------------------------------
  // Lo stato nell'URL.
  //
  // Prima il wizard viveva in un solo indirizzo e teneva tutto in memoria: F5
  // riportava al passo 1, Indietro usciva dall'applicazione, e il batch creato
  // restava `draft` senza alcun modo di riprenderlo. Ora `?batch=…&passo=…`
  // dice dove siamo, e alla ricarica si ricostruisce dal server.
  //
  // `replace` e non `push`: ogni passo che aggiunge una voce alla cronologia
  // renderebbe il tasto Indietro del browser un secondo pulsante «indietro»,
  // in conflitto con quello della pagina.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!batchId || ripresaInCorso) return;
    const atteso = `?batch=${batchId}&passo=${stepId}`;
    if (window.location.search !== atteso) {
      router.replace(`/app/batches/new${atteso}`, { scroll: false });
    }
  }, [batchId, stepId, ripresaInCorso, router]);

  // Ripresa: `?batch=…` all'apertura significa che stiamo tornando su un
  // lavoro lasciato a metà.
  const batchDaRiprendere = parametri.get('batch');
  const passoDaRiprendere = Number(parametri.get('passo') ?? '');
  useEffect(() => {
    if (!batchDaRiprendere || batchId) return;
    let annullato = false;
    setRipresaInCorso(true);
    void riprendiBatch({ batchId: batchDaRiprendere })
      .then((res) => {
        if (annullato) return;
        if (!res.ok) {
          setError(`Non riesco a riprendere questo batch: ${res.error}`);
          return;
        }
        const d = res.data;
        setBatchId(d.batchId);
        setName(d.name);
        if (d.presetId) setSelectedPresetId(d.presetId);
        setPresetVersionId(d.presetVersionId);
        if (d.sourceType === 'mixed') setSourceMode('both');
        else if (d.sourceType === 'spreadsheet' || d.sourceType === 'images') setSourceMode(d.sourceType);
        if (d.spreadsheet) {
          setSpreadsheetResult({
            kind: 'spreadsheet',
            headers: d.spreadsheet.headers,
            previewRows: d.spreadsheet.previewRows,
            suggestedSkuHeader: d.spreadsheet.suggestedSkuHeader,
            suggestedNameHeader: d.spreadsheet.suggestedNameHeader,
            sheets: d.spreadsheet.sheets,
            sheet: d.spreadsheet.sheet,
            totalRows: d.spreadsheet.totalRows,
            file: { filename: d.spreadsheet.filename, sku: null, status: 'ready', problem: null },
          });
          if (d.spreadsheet.suggestedSkuHeader) setSkuHeader(d.spreadsheet.suggestedSkuHeader);
        }
        // Non si riprende oltre il punto che i dati reggono: senza file
        // caricato il massimo è il passo delle fonti.
        const massimo = d.spreadsheet || d.immagini > 0 ? 9 : d.sourceType ? 4 : 3;
        const voluto = Number.isFinite(passoDaRiprendere) && passoDaRiprendere >= 1 ? passoDaRiprendere : 1;
        setStepId(Math.max(1, Math.min(voluto, massimo)));
      })
      .catch((e: unknown) => setError(messaggioDiRete(e)))
      .finally(() => {
        if (!annullato) setRipresaInCorso(false);
      });
    return () => {
      annullato = true;
    };
  }, [batchDaRiprendere, batchId, passoDaRiprendere]);

  /** Rilegge il file scegliendo un altro foglio dell'Excel. */
  async function cambiaFoglio(foglio: string) {
    if (!batchId || !foglio) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rileggiFoglio({ batchId, foglio });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSpreadsheetResult(res.data);
      // Le colonne del foglio precedente non valgono più: si riparte dai
      // suggerimenti del nuovo, altrimenti la mappatura punta al vuoto.
      setSkuHeader(res.data.suggestedSkuHeader ?? '');
      setNameHeader('');
      setCategoryHeader('');
      setMapping(() => ({}));
      setExtraCols(() => ({}));
    } catch (e) {
      setError(messaggioDiRete(e));
    } finally {
      setBusy(false);
    }
  }

  // --- Azioni di transizione ---

  async function submitStep1() {
    if (name.trim() === '') {
      setError('Inserisci un nome per il batch');
      return;
    }
    if (!selectedPresetId) {
      setError('Seleziona un preset');
      return;
    }
    // Il batch è già stato creato: tornare al passo 1 e ripremere «Crea e
    // continua» ne creava un SECONDO, che restava a ingombrare la dashboard.
    if (batchId) {
      nextStep();
      return;
    }
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await createBatchV2({ name, description: description || undefined, presetId: selectedPresetId });
    } catch (e) {
      setError(messaggioDiRete(e));
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const preset = presets?.find((p) => p.id === selectedPresetId);
    setBatchId(res.data.batchId);
    setPresetVersionId(preset?.versionId ?? null);
    nextStep();
  }

  async function submitSources() {
    if (!batchId || !sourceMode) {
      setError('Seleziona una fonte');
      return;
    }
    // Import da URL: flusso dedicato (crea i prodotti subito, salta la mappatura).
    if (sourceMode === 'url') {
      await importUrls();
      return;
    }
    const sourceTypes: WizardSourceType[] =
      sourceMode === 'both' ? ['spreadsheet', 'images'] : sourceMode === 'spreadsheet' ? ['spreadsheet'] : ['images'];
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await setBatchSources({ batchId, sourceTypes });
    } catch (e) {
      setError(messaggioDiRete(e));
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok) {
      setError(res.error);
      return;
    }
    nextStep();
  }

  async function importUrls() {
    if (!batchId) return;
    const urls = urlText
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setError('Incolla almeno un URL (uno per riga).');
      return;
    }
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await importFromUrls({ batchId, urls });
    } catch (e) {
      setError(messaggioDiRete(e));
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.data.imported === 0) {
      setError(
        `Nessun prodotto importato. ${res.data.failures[0]?.reason ?? 'Controlla che gli URL siano pagine prodotto pubbliche.'}`,
      );
      return;
    }
    setImportSummary({
      imported: res.data.imported,
      valid: res.data.imported - res.data.failed,
      invalid: res.data.failed,
      imageOnly: 0,
      // L'import da URL fallisce per pagina, non per riga: i motivi li mostra
      // già il suo elenco di `failures`.
      scartate: [],
      factsInsertErrors: 0,
      senzaNome: 0,
      categoriesMatched: 0,
      unmatchedCategories: [],
    });
    goTo(9);
  }

  async function doUploadSpreadsheet(file: File) {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set('batchId', batchId);
    fd.set('sourceType', 'spreadsheet');
    fd.set('files', file);
    let res;
    try {
      res = await uploadBatchFiles(fd);
    } catch (e) {
      setError(messaggioDiRete(e));
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.data.kind === 'spreadsheet') {
      setSpreadsheetResult(res.data);
      if (res.data.suggestedSkuHeader) setSkuHeader(res.data.suggestedSkuHeader);
    }
  }

  async function doUploadImages(files: FileList | File[]) {
    if (!batchId) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setBusy(true);
    setError(null);
    setUploadProgress(null);
    try {
      // 1) Chiedi gli URL firmati (validazione nome/SKU lato server).
      const targetsRes = await createImageUploadTargets({
        batchId,
        files: arr.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      });
      if (!targetsRes.ok) {
        setError(targetsRes.error);
        return;
      }
      const byName = new Map(arr.map((f) => [f.name, f] as const));
      const targets = targetsRes.data.targets;
      const uploaded: {
        name: string;
        path: string;
        size: number;
        type: string;
        sha256: string;
        sku: string | null;
      }[] = [];
      const failedSummaries: UploadedFileSummary[] = [];

      // 2) Upload DIRETTO client→storage, in parallelo (concorrenza limitata).
      const supabase = createSupabaseBrowserClient();
      const valid = targets.filter((t) => t.valid && t.path && t.token);
      // Segnala subito i file scartati (nome/formato/SKU non validi in fase 1).
      for (const t of targets) {
        if (!t.valid) {
          failedSummaries.push({ filename: t.name, sku: t.sku, status: 'errore', problem: t.problem });
        }
      }
      let done = 0;
      setUploadProgress({ done: 0, total: valid.length });
      const CONCURRENCY = 6;
      let idx = 0;
      async function worker() {
        while (idx < valid.length) {
          const t = valid[idx++];
          if (!t) break;
          const file = byName.get(t.name);
          if (!file || !t.path || !t.token) continue;
          try {
            const buffer = await file.arrayBuffer();
            const sha256 = await sha256Hex(buffer);
            const contentType = mimeFromName(t.name, file.type);
            // Un tentativo + un retry su errori transitori di rete/storage.
            let uploadError = null;
            for (let attempt = 0; attempt < 2; attempt++) {
              const { error } = await supabase.storage
                .from(t.bucket)
                .uploadToSignedUrl(t.path, t.token, file, { upsert: true, contentType });
              uploadError = error;
              if (!error) break;
            }
            if (uploadError) {
              failedSummaries.push({ filename: t.name, sku: t.sku, status: 'errore', problem: 'Upload fallito' });
            } else {
              uploaded.push({
                name: t.name,
                path: t.path,
                size: file.size,
                type: mimeFromName(t.name, file.type),
                sha256,
                sku: t.sku,
              });
            }
          } catch {
            failedSummaries.push({ filename: t.name, sku: t.sku, status: 'errore', problem: 'Upload fallito' });
          }
          done++;
          setUploadProgress({ done, total: valid.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, valid.length) }, worker));

      // 3) Registra i metadati dei file caricati (2 query lato server).
      const reg = await registerUploadedImages({ batchId, items: uploaded });
      if (!reg.ok) {
        setError(reg.error);
        return;
      }
      const data = reg.data;
      const mergedFiles = [...data.files, ...failedSummaries];
      setImagesResult((prev) =>
        prev
          ? {
              kind: 'images',
              files: [...prev.files, ...mergedFiles],
              validCount: prev.validCount + data.validCount,
              invalidCount: prev.invalidCount + data.invalidCount + failedSummaries.length,
            }
          : {
              kind: 'images',
              files: mergedFiles,
              validCount: data.validCount,
              invalidCount: data.invalidCount + failedSummaries.length,
            },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito');
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  function changeSkuDelimiter(d: '_' | '-' | '.' | ' ' | 'none') {
    setSkuDelimiter(d);
    if (!batchId) return;
    setError(null);
    setReparsing(true);
    reparseImageSkus({ batchId, delimiter: d })
      .then((res) => {
        setReparsing(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setImagesResult(res.data);
      })
      .catch(() => {
        setReparsing(false);
        setError('Ricalcolo SKU non riuscito. Riprova.');
      });
  }

  async function runSample() {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/batches/${batchId}/sample`, { method: 'POST' });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Errore nella generazione del campione');
      }
      const body = (await r.json().catch(() => ({}))) as {
        completeness?: unknown;
        content?: SampleCopy;
      };
      setSampleCompleteness(normalizeCompleteness(body.completeness ?? null));
      setSampleContent(body.content ?? null);
      setSampleDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  async function startGeneration() {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/batches/${batchId}/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notify: notifyByEmail }),
      });
      if (r.status === 402) {
        setError('Crediti insufficienti per generare l’intero batch. Acquista crediti dalla pagina Abbonamento.');
        return;
      }
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Errore nell’avvio della generazione');
      }
      // La generazione prosegue in background (cron): riporta l'utente in home,
      // dove il batch si aggiorna da solo con la barra di avanzamento.
      router.push('/app');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  // --- Render ---

  // Il wizard vive in un guscio largo come tutto il flusso di un batch, così il
  // titolo non salta di lato fra un passo e l'altro. Il modulo però resta
  // stretto: una riga di modulo lunga 1150 px si compila peggio, non meglio.
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <ProgressBar steps={activeSteps} activeIndex={activeIndex} totaleNoto={sourceMode !== null} />
        </div>
        {STEP_TOURS[stepId] && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTourOpen(true)}
            aria-label="Rivedi la guida di questo passo"
            className="shrink-0 text-ink-500"
          >
            <HelpCircle className="h-4 w-4" />
            Guida
          </Button>
        )}
      </div>

      {error && (
        <Avviso tono="errore">{error}</Avviso>
      )}

      {stepId === 1 && (
        <Step1
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          presets={presets}
          selectedPresetId={selectedPresetId}
          setSelectedPresetId={setSelectedPresetId}
        />
      )}

      {stepId === 2 && <Step2 explorer={explorer} expandedCat={expandedCat} setExpandedCat={setExpandedCat} expandedAttr={expandedAttr} setExpandedAttr={setExpandedAttr} />}

      {stepId === 3 && <Step3 sourceMode={sourceMode} setSourceMode={setSourceMode} urlText={urlText} setUrlText={setUrlText} onImportUrls={importUrls} busy={busy} />}

      {stepId === 4 && batchId && <Step4 batchId={batchId} hasSpreadsheet={hasSpreadsheet} hasImages={hasImages} imageNamingGuide={imageNamingGuide} />}

      {stepId === 5 && (
        <Step5
          hasSpreadsheet={hasSpreadsheet}
          hasImages={hasImages}
          busy={busy}
          spreadsheetResult={spreadsheetResult}
          imagesResult={imagesResult}
          uploadProgress={uploadProgress}
          onUploadSpreadsheet={doUploadSpreadsheet}
          onCambiaFoglio={cambiaFoglio}
          onUploadImages={doUploadImages}
          skuDelimiter={skuDelimiter}
          onChangeDelimiter={changeSkuDelimiter}
          reparsing={reparsing}
        />
      )}

      {stepId === 6 && <Step6 analysis={analysis} hasImages={hasImages} hasSpreadsheet={hasSpreadsheet} />}

      {stepId === 7 && (
        <Step7
          analysis={analysis}
          hasImages={hasImages}
          hasSpreadsheet={hasSpreadsheet}
          headers={spreadsheetResult?.headers ?? []}
          skuHeader={skuHeader}
          setSkuHeader={setSkuHeader}
          nameHeader={nameHeader}
          setNameHeader={setNameHeader}
          categoryHeader={categoryHeader}
          setCategoryHeader={setCategoryHeader}
          parentHeader={parentHeader}
          setParentHeader={setParentHeader}
          importOption={importOption}
          setImportOption={setImportOption}
          batchId={batchId}
          previewRows={spreadsheetResult?.previewRows ?? []}
          categoryOverrides={categoryOverrides}
          setCategoryOverrides={setCategoryOverrides}
        />
      )}

      {stepId === 8 && <Step8 attributes={attributes} headers={headers} mapping={mapping} setMapping={setMapping} skuHeader={skuHeader} nameHeader={nameHeader} categoryHeader={categoryHeader} extraCols={extraCols} setExtraCols={setExtraCols} />}

      {stepId === 9 && batchId && (
        <Step9 products={products} importSummary={importSummary} batchId={batchId} hasImages={hasImages} analyzing={analyzingImages} analyzeProgress={analyzeProgress} categoryFromFile={hasSpreadsheet && Boolean(categoryHeader)} />
      )}

      {stepId === 10 && (
        <Step10
          sampleDone={sampleDone}
          busy={busy}
          onRun={runSample}
          completeness={sampleCompleteness}
          content={sampleContent}
        />
      )}

      {stepId === 11 && <Step11 importSummary={importSummary} notifyByEmail={notifyByEmail} setNotifyByEmail={setNotifyByEmail} />}

      {/* Navigazione — SEMPRE raggiungibile: su mobile resta agganciata in basso
          (con passi lunghi altrimenti bisogna scorrere tutta la pagina). */}
      {/* z-[60] e non z-20: in fondo alla pagina vivono anche il banner cookie
          (z-50) e il pulsante d'aiuto, e alla prima visita coprivano proprio il
          comando principale. Chi sta lavorando ha la precedenza sull'avviso.

          Fondo PIENO, a ogni larghezza. Era `sm:bg-transparent`: da tablet in su
          la barra restava agganciata in fondo senza alcuno sfondo, e il
          contenuto le passava sotto — misurate sovrapposizioni di 115×26px sulle
          schede delle categorie. Il 5% di trasparenza con la sfocatura non
          nascondeva il testo: lo rendeva illeggibile ma visibile, che è peggio. */}
      <div className="sticky bottom-0 z-[60] -mx-4 flex items-center justify-between gap-2 border-t border-ink-200 bg-[var(--background)] px-4 py-3 sm:mx-0 sm:border-ink-100">
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={prevStep} disabled={busy || activeIndex <= 0}>
            <ArrowLeft className="h-4 w-4" />
            Indietro
          </Button>
          {/* Su telefono l'aiuto sta QUI e non galleggia: la barra è `sticky`,
              quindi con poco contenuto si ferma a metà schermo — proprio dove
              galleggiava il pulsante «Serve aiuto?», che finiva sopra «Crea e
              continua». Un comando accessorio che copre quello principale è il
              peggior modo di offrire aiuto. */}
          <Button
            variant="ghost"
            size="sm"
            className="sm:hidden"
            onClick={() => setChiediAiuto((n) => n + 1)}
            aria-label="Apri la guida"
          >
            <LifeBuoy className="h-4 w-4" />
          </Button>
        </div>

        <StepPrimaryAction
          stepId={stepId}
          // Il passo che carica blocca «Continua»: senza, si attraversavano
          // mappatura e verifica senza vederle.
          busy={busy || analyzingImages || passoInCaricamento === stepId}
          step3Label={sourceMode === 'url' ? 'Importa da URL' : 'Continua'}
          canProceed={{
            1: name.trim() !== '' && !!selectedPresetId && (presets?.length ?? 0) > 0,
            3: !!sourceMode && (sourceMode !== 'url' || urlText.trim().length > 0),
            5: (!hasSpreadsheet || !!spreadsheetResult) && (!hasImages || !!imagesResult),
            10: sampleDone,
          }}
          onStep1={submitStep1}
          onSources={submitSources}
          onSample={runSample}
          onStart={startGeneration}
          onNext={nextStep}
        />
      </div>

      {/* Onboarding: fumettini del passo corrente + chat-guida sempre a portata. */}
      {tourOpen && STEP_TOURS[stepId] && (
        <GuidedTour
          steps={STEP_TOURS[stepId]!}
          onClose={() => {
            markTourSeen(`wizard.${stepId}.v1`);
            setTourOpen(false);
          }}
        />
      )}
      <WizardGuide apriDaFuori={chiediAiuto > 0} onChiusa={() => setChiediAiuto(0)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra di avanzamento.
// ---------------------------------------------------------------------------

// Il totale dei passi dipende da cosa si carica: con un Excel ce ne sono due in
// più (colonne e mappatura). Finché la fonte non è scelta il totale **non si
// sa**, e prometterne uno vuol dire che a metà strada la barra passa da «di 9» a
// «di 11» senza che si sia fatto niente di sbagliato. Meglio non dirlo, che
// dirlo e ritrattare.
function ProgressBar({
  steps,
  activeIndex,
  totaleNoto,
}: {
  steps: StepDef[];
  activeIndex: number;
  totaleNoto: boolean;
}) {
  const pct = steps.length > 1 ? Math.round((Math.max(0, activeIndex) / (steps.length - 1)) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-ink-500">
        <span className="font-medium text-ink-700">
          Passo {Math.max(1, activeIndex + 1)}
          {totaleNoto ? ` di ${steps.length}` : ''}
        </span>
        <span>{steps[Math.max(0, activeIndex)]?.title}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-brand-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Azione primaria per passo.
// ---------------------------------------------------------------------------

function StepPrimaryAction({
  stepId,
  busy,
  canProceed,
  step3Label = 'Continua',
  onStep1,
  onSources,
  onSample,
  onStart,
  onNext,
}: {
  stepId: number;
  busy: boolean;
  canProceed: Record<number, boolean>;
  step3Label?: string;
  onStep1: () => void;
  onSources: () => void;
  onSample: () => void;
  onStart: () => void;
  onNext: () => void;
}) {
  const spinner = <Loader2 className="h-4 w-4 animate-spin" />;

  if (stepId === 1) {
    return (
      <Button onClick={onStep1} disabled={busy || !canProceed[1]}>
        {busy ? spinner : <>Crea e continua <ArrowRight className="h-4 w-4" /></>}
      </Button>
    );
  }
  if (stepId === 3) {
    return (
      <Button onClick={onSources} disabled={busy || !canProceed[3]}>
        {busy ? spinner : <>{step3Label} <ArrowRight className="h-4 w-4" /></>}
      </Button>
    );
  }
  if (stepId === 5) {
    return (
      <Button onClick={onNext} disabled={busy || !canProceed[5]}>
        Continua <ArrowRight className="h-4 w-4" />
      </Button>
    );
  }
  if (stepId === 10) {
    return (
      <Button onClick={onNext} disabled={busy || !canProceed[10]}>
        Continua <ArrowRight className="h-4 w-4" />
      </Button>
    );
  }
  if (stepId === 11) {
    return (
      <Button onClick={onStart} disabled={busy}>
        {busy ? spinner : <><Sparkles className="h-4 w-4" /> Avvia generazione</>}
      </Button>
    );
  }
  void onSample;
  return (
    <Button onClick={onNext} disabled={busy}>
      Continua <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Informazioni batch.
// ---------------------------------------------------------------------------

function Step1({
  name,
  setName,
  description,
  setDescription,
  presets,
  selectedPresetId,
  setSelectedPresetId,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  presets: PublishedPresetSummary[] | null;
  selectedPresetId: string | null;
  setSelectedPresetId: (v: string) => void;
}) {
  const selected = presets?.find((p) => p.id === selectedPresetId) ?? null;
  return (
    <div className="space-y-6">
      <div data-tour="batch-name">
        <Label htmlFor="batch-name">Nome del batch</Label>
        <Input id="batch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Collezione autunno 2026" />
      </div>
      <div>
        <Label htmlFor="batch-desc">Descrizione (facoltativa)</Label>
        <Textarea id="batch-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Note interne su questo batch." />
      </div>

      <div data-tour="preset-pick">
        <Label>
          Preset{' '}
          <HelpBubble text="Il preset è il modello della scheda: definisce le categorie (es. Vino, Ortofrutta) e i dati da compilare per ciascuna. Lo configuri in Configurazione → Preset, anche a chat con il Copilot." />
        </Label>
        {presets === null && (
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento preset…
          </div>
        )}
        {presets !== null && presets.length === 0 && (
          <Card>
            <CardContent className="space-y-3 p-6 text-sm text-ink-600">
              <p className="font-medium text-ink-900">Nessun preset pubblicato</p>
              <p>
                Per creare un batch devi prima configurare e pubblicare un preset con le sue categorie e i suoi attributi.
              </p>
              <Link href="/app/settings/presets" className="inline-flex font-medium text-brand-accent underline underline-offset-2">
                Vai alle impostazioni preset
              </Link>
            </CardContent>
          </Card>
        )}
        {presets !== null && presets.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {presets.map((p) => {
              const active = p.id === selectedPresetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPresetId(p.id)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors',
                    active ? 'border-brand-accent bg-brand-soft/70 ring-1 ring-brand-accent' : 'border-ink-200 bg-white hover:bg-ink-50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink-900">{p.name}</span>
                    {active && <Check className="h-4 w-4 text-brand-accent" />}
                  </div>
                  <div className="mt-1 text-sm text-ink-500">Settore: {p.sectorName}</div>
                  <div className="mt-2 flex gap-2 text-xs text-ink-500">
                    <Badge tone="gray">{p.categoriesCount} categorie</Badge>
                    <Badge tone="gray">{p.attributesCount} attributi</Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="text-sm text-ink-500">
          {/* `-my-1 py-1.5` porta l'area di tocco a 24px senza allargare la
              riga: un collegamento di testo è alto quanto il testo — 17px — e
              col dito non si prende. È lo stesso trattamento dei link legali
              nel piede. */}
          <Link
            href="/app/settings/presets"
            className="-my-1 inline-flex items-center py-1.5 font-medium text-brand-accent underline underline-offset-2"
          >
            Modifica preset
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Esploratore preset (sola lettura).
// ---------------------------------------------------------------------------

function Step2({
  explorer,
  expandedCat,
  setExpandedCat,
  expandedAttr,
  setExpandedAttr,
}: {
  explorer: PresetExplorer | null;
  expandedCat: Set<string>;
  setExpandedCat: (s: Set<string>) => void;
  expandedAttr: Set<string>;
  setExpandedAttr: (s: Set<string>) => void;
}) {
  if (explorer === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Caricamento preset…
      </div>
    );
  }
  function toggle(set: Set<string>, apply: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Settore <span className="font-medium text-ink-800">{explorer.sectorName}</span>. Questi sono gli attributi che verranno estratti e generati. Sola lettura.
      </p>
      {explorer.categories.length === 0 && <p className="text-sm text-ink-500">Nessuna categoria configurata nel preset.</p>}
      {explorer.categories.map((cat) => {
        const open = expandedCat.has(cat.id);
        return (
          <Card key={cat.id}>
            <button type="button" onClick={() => toggle(expandedCat, setExpandedCat, cat.id)} className="flex w-full items-center justify-between p-4 text-left">
              <span className="font-medium text-ink-900">{cat.name}</span>
              <span className="flex items-center gap-2 text-sm text-ink-500">
                {cat.attributes.length} attributi
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </button>
            {open && (
              <CardContent className="space-y-2 pt-0">
                {cat.attributes.map((attr) => {
                  const aopen = expandedAttr.has(attr.id);
                  return (
                    <div key={attr.id} className="rounded-lg border border-ink-100">
                      <button type="button" onClick={() => toggle(expandedAttr, setExpandedAttr, attr.id)} className="flex w-full items-center justify-between px-3 py-2 text-left">
                        <span className="flex items-center gap-2">
                          <span className="text-sm text-ink-800">{attr.name}</span>
                          <Badge tone="gray">{etichettaTipoDato(attr.dataType)}</Badge>
                          {attr.isRequired && <Badge tone="amber">obbligatorio</Badge>}
                        </span>
                        {aopen ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
                      </button>
                      {aopen && (
                        <div className="space-y-2 border-t border-ink-100 px-3 py-2 text-sm text-ink-600">
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Istruzione di estrazione</span>
                            <p className="mt-0.5">{attr.extractionInstruction ?? '—'}</p>
                          </div>
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Istruzione di generazione</span>
                            <p className="mt-0.5">{attr.generationInstruction ?? '—'}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Fonti.
// ---------------------------------------------------------------------------

interface SourceCard {
  mode: SourceMode | null;
  title: string;
  description: string;
  disabled?: boolean;
  note?: string;
}

const SOURCE_CARDS: SourceCard[] = [
  { mode: 'images', title: 'Solo immagini', description: 'Carichi solo le foto dei prodotti. Lo SKU viene letto dal nome del file (es. TSHIRT001_front.jpg).' },
  { mode: 'spreadsheet', title: 'CSV o Excel', description: 'Carichi un foglio con una riga per SKU e le colonne degli attributi.' },
  { mode: 'both', title: 'Immagini + CSV', description: 'Combini foglio e immagini: gli SKU della colonna SKU vengono associati al prefisso dei nomi immagine.' },
  { mode: 'url', title: 'Da URL', description: 'Incolli i link delle pagine prodotto (le tue o del fornitore): estraiamo i dati e le foto, poi l’AI riscrive la scheda.', note: 'Novità' },
  // «In arrivo» e «Prossimamente» erano due parole per lo stesso stato, una
  // accanto all'altra. Una sola, e la sceglie il codice in base a `disabled`:
  // così non si può più scriverne una terza per sbaglio.
  { mode: null, title: 'Google Drive', description: 'Colleghi una cartella Drive con file e immagini.', disabled: true },
  { mode: null, title: 'PDF', description: 'Estrazione da schede tecniche in PDF.', disabled: true },
];

function Step3({
  sourceMode,
  setSourceMode,
  urlText,
  setUrlText,
  onImportUrls,
  busy,
}: {
  sourceMode: SourceMode | null;
  setSourceMode: (m: SourceMode) => void;
  urlText: string;
  setUrlText: (v: string) => void;
  onImportUrls: () => void;
  busy: boolean;
}) {
  const urlCount = urlText.split(/\r?\n/).map((u) => u.trim()).filter(Boolean).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-500">
        Scegli da dove arrivano i dati dei prodotti. Puoi cambiare idea: se poi scopri di avere
        anche un Excel, torna a questo passo e scegli «Entrambe».
      </p>
      <div className="grid gap-3 sm:grid-cols-2" data-tour="sources">
        {SOURCE_CARDS.map((card) => {
          const active = card.mode !== null && card.mode === sourceMode;
          return (
            <button
              key={card.title}
              type="button"
              disabled={card.disabled}
              onClick={() => card.mode && setSourceMode(card.mode)}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                card.disabled && 'cursor-not-allowed opacity-60',
                active ? 'border-brand-accent bg-brand-soft/70 ring-1 ring-brand-accent' : 'border-ink-200 bg-white hover:bg-ink-50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink-900">{card.title}</span>
                {/* Una fonte che si può usare e una che non c'è ancora
                    portavano la STESSA pastiglia viola: «Novità» accanto a «In
                    arrivo», stesso colore, stesso peso. Il viola dice «guarda
                    qui», e su una cosa che non si può cliccare è un invito a
                    vuoto. Ora il disponibile è viola e l'indisponibile è
                    grigio, come tutto il resto che non si può toccare. */}
                {card.disabled ? (
                  <Badge tone="gray">In arrivo</Badge>
                ) : (
                  card.note && <Badge tone="violet">{card.note}</Badge>
                )}
                {active && <Check className="h-4 w-4 shrink-0 text-brand-accent" />}
              </div>
              <p className="mt-1 text-sm text-ink-500">{card.description}</p>
            </button>
          );
        })}
      </div>

      {sourceMode === 'url' && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <Label htmlFor="url-list">Link delle pagine prodotto (uno per riga)</Label>
              <Textarea
                id="url-list"
                rows={7}
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                placeholder={'https://www.tuosito.it/prodotti/maglione-rosso\nhttps://www.fornitore.com/p/olio-evo-500ml'}
                className="mt-1 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-ink-500">
                {urlCount > 0 ? `${urlCount} URL pronti · ` : ''}Massimo 60 per volta. Estraiamo nome,
                brand, prezzo, attributi e foto dai dati strutturati della pagina.
              </p>
            </div>
            <Avviso tono="attenzione" className="text-xs">
              Importa solo pagine di cui hai i diritti (tue o del tuo fornitore). L’AI riscrive una
              scheda nuova a partire dai fatti: non copiamo il testo originale.
            </Avviso>
            <div className="flex justify-end">
              <Button onClick={onImportUrls} disabled={busy || urlCount === 0} data-tour="url-import">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {busy ? 'Importo…' : 'Importa e continua'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Istruzioni e template.
// ---------------------------------------------------------------------------

function Step4({ batchId, hasSpreadsheet, hasImages, imageNamingGuide }: { batchId: string; hasSpreadsheet: boolean; hasImages: boolean; imageNamingGuide: string }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-2 p-5 text-sm text-ink-600">
          <p className="font-medium text-ink-900">Regole SKU</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Ogni prodotto ha uno SKU univoco. Una riga per SKU.</li>
            <li>Lo SKU non può contenere underscore; sono ammessi lettere, numeri, trattini e punti.</li>
            <li>I dati forniti vengono usati come fatti: le informazioni assenti non verranno inventate.</li>
          </ul>
        </CardContent>
      </Card>

      {hasSpreadsheet && (
        <div className="flex flex-wrap gap-2">
          <a href={`/api/batches/${batchId}/template?format=csv`} className="inline-flex">
            <Button variant="outline" size="sm" type="button">
              <Download className="h-4 w-4" /> Template CSV
            </Button>
          </a>
          <a href={`/api/batches/${batchId}/template?format=xlsx`} className="inline-flex">
            <Button variant="outline" size="sm" type="button">
              <Download className="h-4 w-4" /> Template Excel
            </Button>
          </a>
          <a href={`/api/batches/${batchId}/template?format=guide`} className="inline-flex">
            <Button variant="outline" size="sm" type="button">
              <Download className="h-4 w-4" /> Guida nomi immagini
            </Button>
          </a>
        </div>
      )}

      {hasImages && (
        <Card>
          <CardContent className="p-5">
            <pre className="whitespace-pre-wrap font-sans text-sm text-ink-600">{imageNamingGuide}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Caricamento.
// ---------------------------------------------------------------------------

function Step5({
  hasSpreadsheet,
  hasImages,
  busy,
  spreadsheetResult,
  imagesResult,
  uploadProgress,
  onUploadSpreadsheet,
  onCambiaFoglio,
  onUploadImages,
  skuDelimiter,
  onChangeDelimiter,
  reparsing,
}: {
  hasSpreadsheet: boolean;
  hasImages: boolean;
  busy: boolean;
  spreadsheetResult: UploadSpreadsheetResult | null;
  imagesResult: UploadImagesResult | null;
  uploadProgress: { done: number; total: number } | null;
  onUploadSpreadsheet: (file: File) => void;
  onCambiaFoglio: (foglio: string) => void;
  onUploadImages: (files: FileList | File[]) => void;
  skuDelimiter: '_' | '-' | '.' | ' ' | 'none';
  onChangeDelimiter: (d: '_' | '-' | '.' | ' ' | 'none') => void;
  reparsing: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="space-y-6">
      {hasSpreadsheet && (
        <div data-tour="upload-file">
          <Label>
            Foglio CSV o Excel{' '}
            <HelpBubble text="Serve una colonna con lo SKU (codice prodotto). Tutte le altre colonne potrai mapparle o importarle come dati extra nei passi successivi." />
          </Label>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-white p-6 text-center hover:bg-ink-50">
            <FileSpreadsheet className="h-6 w-6 text-ink-400" />
            <span className="text-sm text-ink-600">Seleziona un file .csv o .xlsx</span>
            <input
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadSpreadsheet(f);
              }}
            />
          </label>
          {/* Provare il prodotto senza rischiare: chi arriva qui la prima volta
              spesso non ha un file pronto, e chi ce l'ha non vuole darlo a uno
              strumento che non ha ancora visto lavorare. Otto righe vere di un
              listino di conserve, da scaricare e ricaricare qui sopra: fa il
              giro completo senza mettere in mezzo il proprio catalogo. */}
          {!spreadsheetResult && (
            <p className="mt-2 text-xs text-ink-500">
              Non hai un file sotto mano?{' '}
              <a
                href="/listino-di-esempio.csv"
                download
                className="font-medium text-brand-accent underline underline-offset-2"
              >
                Scarica un listino di esempio
              </a>{' '}
              e ricaricalo qui sopra.
            </p>
          )}
          {spreadsheetResult && (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <Check className="h-4 w-4" /> {spreadsheetResult.file.filename} — {spreadsheetResult.totalRows} righe
              </div>
              {/* Excel con più fogli: si dice QUALE è stato letto e si lascia
                  scegliere. Un workbook con «Istruzioni» prima e «Listino»
                  dopo finiva per importare le istruzioni, in silenzio. */}
              {spreadsheetResult.sheets.length > 1 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <Label htmlFor="foglio-excel">
                    Questo file ha {spreadsheetResult.sheets.length} fogli: sto leggendo «
                    {spreadsheetResult.sheet}»
                  </Label>
                  <Select
                    id="foglio-excel"
                    value={spreadsheetResult.sheet ?? ''}
                    onChange={(e) => onCambiaFoglio(e.target.value)}
                    disabled={busy}
                  >
                    {spreadsheetResult.sheets.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1.5 text-xs text-amber-800">
                    Se i prodotti sono su un altro foglio, scegliilo qui: l’anteprima
                    qui sotto si aggiorna.
                  </p>
                </div>
              )}
              <PreviewTable headers={spreadsheetResult.headers} rows={spreadsheetResult.previewRows} />
            </div>
          )}
        </div>
      )}

      {hasImages && (
        <div data-tour="upload-images">
          <Label>
            Immagini prodotto{' '}
            <HelpBubble text="Il nome del file deve contenere lo SKU: es. «1234-fronte.jpg» → SKU 1234. Più foto con lo stesso SKU finiscono sullo stesso prodotto. Dopo il caricamento scegli il separatore giusto." />
          </Label>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) onUploadImages(e.dataTransfer.files);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center',
              dragOver ? 'border-brand-accent bg-brand-soft/70' : 'border-ink-300 bg-white hover:bg-ink-50',
            )}
          >
            <UploadCloud className="h-6 w-6 text-ink-400" />
            <span className="text-sm text-ink-600">Trascina qui le immagini o clicca per selezionarle (.jpg, .jpeg, .png, .webp, .zip)</span>
            <span className="text-xs text-ink-500">Caricamento diretto e in parallelo: veloce anche con centinaia di immagini.</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.zip"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) onUploadImages(e.target.files);
              }}
            />
          </label>
          {uploadProgress && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-ink-500">
                <span>Caricamento immagini…</span>
                <span>
                  {uploadProgress.done}/{uploadProgress.total}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-brand-accent transition-all"
                  style={{
                    width: `${uploadProgress.total > 0 ? Math.round((uploadProgress.done / uploadProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {imagesResult && (
            <div className="mt-3 space-y-3 text-sm">
              <div className="rounded-lg border border-ink-200 bg-ink-50 p-3" data-tour="sku-separator">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-700">Separatore SKU:</span>
                  {([
                    { d: '_' as const, label: 'trattino_basso' },
                    { d: '-' as const, label: 'trattino -' },
                    { d: '.' as const, label: 'punto .' },
                    { d: ' ' as const, label: 'spazio' },
                    { d: 'none' as const, label: 'nessuno: il nome è lo SKU' },
                  ]).map((opt) => (
                    <button
                      key={opt.d}
                      type="button"
                      disabled={reparsing}
                      onClick={() => onChangeDelimiter(opt.d)}
                      className={
                        skuDelimiter === opt.d
                          ? 'rounded-md border border-brand-accent bg-brand-accent px-2.5 py-1 text-xs font-medium text-white'
                          : 'rounded-md border border-ink-300 bg-white px-2.5 py-1 text-xs text-ink-700 hover:border-ink-400'
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                  {reparsing && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Lo SKU è la parte del nome file <strong>prima</strong> del separatore. Es.
                  «100356-image_IT.jpg» con separatore «-» → SKU «100356». Le immagini con lo stesso
                  SKU vengono raggruppate sullo stesso prodotto.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="green">{imagesResult.validCount} valide</Badge>
                <Badge tone="amber">{imagesResult.invalidCount} da controllare</Badge>
              </div>
              <FilesTable files={imagesResult.files} />
            </div>
          )}
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento in corso…
        </div>
      )}
    </div>
  );
}

function PreviewTable({ headers, rows }: { headers: string[]; rows: Array<Record<string, string>> }) {
  if (rows.length === 0) return <p className="text-sm text-ink-500">Nessuna riga da mostrare.</p>;
  const shown = rows;
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200">
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-ink-50">
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="border-b border-ink-200 px-3 py-2 text-left font-semibold uppercase tracking-wide text-ink-500"
                  title={h}
                >
                  <span className="block max-w-[160px] truncate">{h}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-ink-50/50">
                {headers.map((h) => (
                  <td
                    key={h}
                    className="whitespace-nowrap border-b border-ink-100 px-3 py-1.5 text-ink-700"
                    title={r[h] ?? ''}
                  >
                    <span className="block max-w-[200px] truncate">{r[h] || <span className="text-ink-300">—</span>}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-ink-100 bg-ink-50 px-3 py-1.5 text-xs text-ink-500">
        {headers.length} colonne · anteprima di {shown.length} righe {rows.length > shown.length ? `(su ${rows.length})` : ''}
      </p>
    </div>
  );
}

/**
 * Verifica che i valori della colonna Categoria corrispondano a categorie del
 * catalogo. Quelli non riconosciuti vengono elencati e si possono rimappare a
 * mano su una categoria esistente (override passato all'import).
 */
function CategoryColumnValidator({
  batchId,
  header,
  previewRows,
  overrides,
  setOverrides,
}: {
  batchId: string;
  header: string;
  previewRows: Array<Record<string, string>>;
  overrides: Record<string, string>;
  setOverrides: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [fromPreset, setFromPreset] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getBatchCategoryOptions({ batchId })
      .then((r) => {
        if (!active) return;
        if (r.ok) {
          setCats(r.data.categories);
          setFromPreset(r.data.fromPreset);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [batchId]);

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  if (loading) return <p className="mt-2 text-xs text-ink-500">Verifico i valori della colonna…</p>;
  if (cats.length === 0) return null;

  const catByNorm = new Map(cats.map((c) => [norm(c.name), c] as const));
  const matchOf = (value: string) => {
    const n = norm(value);
    const exact = catByNorm.get(n);
    if (exact) return exact;
    return cats.find((c) => {
      const cn = norm(c.name);
      return cn && (n.includes(cn) || cn.includes(n));
    });
  };

  const values = [...new Set(previewRows.map((r) => (r[header] ?? '').trim()).filter(Boolean))];
  const rows = values.map((v) => ({ value: v, match: matchOf(v) }));
  const unresolved = rows.filter((r) => !r.match && !overrides[r.value]);
  const okCount = rows.length - unresolved.length;

  return (
    <div
      className={cn(
        'mt-3 rounded-lg border p-3',
        unresolved.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50',
      )}
    >
      <p className={cn('text-xs font-medium', unresolved.length > 0 ? 'text-amber-900' : 'text-emerald-800')}>
        {unresolved.length > 0
          ? `${unresolved.length} valore/i della colonna «${header}» non corrisponde a nessuna categoria: rimappalo qui sotto.`
          : `Tutti i valori della colonna «${header}» corrispondono a una categoria (${okCount}/${rows.length}).`}
      </p>
      {unresolved.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {unresolved.map((r) => (
            <div key={r.value} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-2">
              <span className="truncate text-sm text-amber-900" title={r.value}>
                «{r.value}»
              </span>
              <Select
                value={overrides[r.value] ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setOverrides((prev) => {
                    const next = { ...prev };
                    if (v) next[r.value] = v;
                    else delete next[r.value];
                    return next;
                  });
                }}
              >
                <option value="">— Scegli la categoria giusta —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-ink-500">
        Confronto con le {cats.length} categorie{' '}
        {fromPreset ? 'del preset scelto' : 'del settore (il preset non ne ha nessuna configurata)'}.
        Verifica basata sull&apos;anteprima ({previewRows.length} righe). I valori nuovi che compaiono
        oltre l&apos;anteprima potrai correggerli al passo «Verifica dati».
      </p>
    </div>
  );
}

function FilesTable({ files }: { files: UploadedFileSummary[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>SKU</TH>
          <TH>File</TH>
          <TH>Stato</TH>
          <TH>Problemi</TH>
        </TR>
      </THead>
      <TBody>
        {files.map((f, i) => (
          <TR key={i}>
            <TD>{f.sku ?? '—'}</TD>
            <TD>{f.filename}</TD>
            <TD>
              <Badge tone={f.status === 'valid' || f.status === 'ready' ? 'green' : 'amber'}>{f.status}</Badge>
            </TD>
            <TD className="text-ink-500">{f.problem ?? '—'}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Analisi file.
// ---------------------------------------------------------------------------

function Metric({ label, value, tone = 'gray' }: { label: string; value: number; tone?: BadgeTone }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold text-ink-900">{value}</div>
        <div className="mt-1 text-sm text-ink-500">{label}</div>
        <div className="mt-2">
          <Badge tone={tone}>{tone === 'red' ? 'da risolvere' : tone === 'amber' ? 'da controllare' : 'ok'}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function Step6({ analysis, hasImages, hasSpreadsheet }: { analysis: AnalyzeData | null; hasImages: boolean; hasSpreadsheet: boolean }) {
  if (analysis === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Analisi in corso…
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">Risultato del confronto tra le sorgenti (unione tramite SKU esatto).</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="SKU totali unici" value={analysis.totalUniqueSkus} tone="gray" />
        {hasSpreadsheet && hasImages && <Metric label="SKU in entrambe le fonti" value={analysis.inBoth.length} tone="gray" />}
        {hasSpreadsheet && <Metric label="Solo nel file" value={analysis.onlyFile.length} tone={analysis.onlyFile.length > 0 ? 'amber' : 'gray'} />}
        {hasImages && <Metric label="Solo nelle immagini" value={analysis.onlyImages.length} tone={analysis.onlyImages.length > 0 ? 'amber' : 'gray'} />}
        {hasSpreadsheet && <Metric label="SKU duplicati nel file" value={analysis.duplicateFileSkus.length} tone={analysis.duplicateFileSkus.length > 0 ? 'red' : 'gray'} />}
        {hasSpreadsheet && <Metric label="Righe senza SKU" value={analysis.rowsWithoutSku} tone={analysis.rowsWithoutSku > 0 ? 'red' : 'gray'} />}
        {hasImages && <Metric label="Immagini senza SKU" value={analysis.filesWithoutSku.length} tone={analysis.filesWithoutSku.length > 0 ? 'amber' : 'gray'} />}
      </div>
      {/* Il numero rosso diceva che c'era un problema e si fermava lì. Questo
          dice cosa succederà, e dove si vedrà a chi è successo. */}
      {hasSpreadsheet && analysis.duplicateFileSkus.length > 0 && (
        <p className="text-sm text-amber-800">
          Con lo stesso codice ripetuto entra <strong>la prima riga</strong>: le altre vengono
          scartate. Dopo l’importazione trovi l’elenco di quali, riga per riga.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 7 — Associazione SKU.
// ---------------------------------------------------------------------------

function Step7({
  analysis,
  hasImages,
  hasSpreadsheet,
  headers,
  skuHeader,
  setSkuHeader,
  nameHeader,
  setNameHeader,
  categoryHeader,
  setCategoryHeader,
  parentHeader,
  setParentHeader,
  importOption,
  setImportOption,
  batchId,
  previewRows,
  categoryOverrides,
  setCategoryOverrides,
}: {
  analysis: AnalyzeData | null;
  hasImages: boolean;
  hasSpreadsheet: boolean;
  headers: string[];
  skuHeader: string;
  setSkuHeader: (v: string) => void;
  nameHeader: string;
  setNameHeader: (v: string) => void;
  categoryHeader: string;
  setCategoryHeader: (v: string) => void;
  parentHeader: string;
  setParentHeader: (v: string) => void;
  importOption: 'complete' | 'includeImageOnly' | 'excludeIncomplete';
  setImportOption: (v: 'complete' | 'includeImageOnly' | 'excludeIncomplete') => void;
  batchId: string | null;
  previewRows: Array<Record<string, string>>;
  categoryOverrides: Record<string, string>;
  setCategoryOverrides: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  return (
    <div className="space-y-6">
      {hasSpreadsheet && (
        <div data-tour="sku-column">
          <Label htmlFor="sku-header">
            Colonna SKU{' '}
            <HelpBubble text="Lo SKU è il codice univoco del prodotto: collega righe del file, foto e schede generate. Le righe senza SKU vengono scartate." />
          </Label>
          <Select id="sku-header" value={skuHeader} onChange={(e) => setSkuHeader(e.target.value)}>
            <option value="">— Seleziona la colonna SKU —</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-ink-500">Le righe senza SKU in questa colonna verranno scartate.</p>
        </div>
      )}

      {hasSpreadsheet && (
        <div className="rounded-lg border border-ink-200 p-4">
          <Label htmlFor="name-header">
            Colonna Nome prodotto
            <HelpBubble text="Come si chiama il prodotto nel tuo file. È il titolo che vedrai nei risultati e il punto di partenza della scheda. Senza, il prodotto si chiama come il suo codice." />
          </Label>
          <Select id="name-header" value={nameHeader} onChange={(e) => setNameHeader(e.target.value)}>
            <option value="">— Nessuna colonna: userò il codice come nome —</option>
            {headers.map((h) => (
              <option key={h} value={h} disabled={h === skuHeader}>
                {h}
                {h === skuHeader ? ' (colonna SKU)' : ''}
              </option>
            ))}
          </Select>
          {nameHeader === '' && (
            <p className="mt-1.5 text-xs text-amber-700">
              Senza questa colonna i prodotti si chiameranno come il loro codice
              (es. <span className="font-mono">OLI-001</span>).
            </p>
          )}
        </div>
      )}

      {hasSpreadsheet && (
        <div className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 p-4" data-tour="category-column">
          <Label htmlFor="category-header">Colonna Categoria (consigliata)</Label>
          <Select
            id="category-header"
            value={categoryHeader}
            onChange={(e) => setCategoryHeader(e.target.value)}
          >
            <option value="">— Nessuna colonna: la categoria viene dedotta dall’AI dalle foto —</option>
            {headers.map((h) => (
              <option key={h} value={h} disabled={h === skuHeader}>
                {h}
                {h === skuHeader ? ' (colonna SKU)' : ''}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-ink-600">
            La categoria di ogni prodotto viene presa da questa colonna e agganciata in automatico al
            tuo catalogo (nessuna AI). <strong>Decide quali attributi e istruzioni del preset vengono
            usati in generazione</strong>: un Vino riceve gli attributi del vino, non quelli della
            carne. Se scegli una colonna, l&apos;AI <strong>non deduce la categoria dalle foto</strong>.
          </p>
          {categoryHeader && batchId && (
            <CategoryColumnValidator
              batchId={batchId}
              header={categoryHeader}
              previewRows={previewRows}
              overrides={categoryOverrides}
              setOverrides={setCategoryOverrides}
            />
          )}
        </div>
      )}

      {hasSpreadsheet && (
        <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
          <Label htmlFor="parent-header">Colonna «codice padre» — varianti colore/taglia (facoltativa)</Label>
          <Select
            id="parent-header"
            value={parentHeader}
            onChange={(e) => setParentHeader(e.target.value)}
          >
            <option value="">— Nessuna: ogni riga è un prodotto a sé —</option>
            {headers.map((h) => (
              <option key={h} value={h} disabled={h === skuHeader}>
                {h}
                {h === skuHeader ? ' (colonna SKU)' : ''}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-ink-600">
            Se il tuo file ha una colonna che indica il <strong>prodotto padre</strong> (es. il codice
            modello condiviso da tutte le taglie/colori), selezionala qui: le righe con lo stesso
            codice vengono <strong>raggruppate come varianti</strong> e nell’export mantengono il
            legame padre → varianti (utile per Shopify/Woo).
          </p>
        </div>
      )}

      {hasImages && hasSpreadsheet && analysis && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SkuList title="In entrambe le fonti" skus={analysis.inBoth} tone="green" />
          <SkuList title="Solo nel file" skus={analysis.onlyFile} tone="amber" />
          <SkuList title="Solo nelle immagini" skus={analysis.onlyImages} tone="amber" />
          <SkuList title="Duplicati nel file" skus={analysis.duplicateFileSkus} tone="red" />
          {analysis.filesWithoutSku.length > 0 && <SkuList title="Immagini senza SKU" skus={analysis.filesWithoutSku} tone="red" />}
        </div>
      )}

      <div>
        <Label>Come procedere</Label>
        <div className="space-y-2">
          <OptionRow checked={importOption === 'complete'} onSelect={() => setImportOption('complete')} title="Continua con i prodotti completi" description="Importa i prodotti con SKU valido; i solo-immagini restano esclusi." />
          {hasImages && (
            <OptionRow checked={importOption === 'includeImageOnly'} onSelect={() => setImportOption('includeImageOnly')} title="Includi anche i prodotti solo-immagini" description="Crea un prodotto anche per gli SKU presenti solo tra le immagini." />
          )}
          <OptionRow checked={importOption === 'excludeIncomplete'} onSelect={() => setImportOption('excludeIncomplete')} title="Escludi i prodotti incompleti" description="Scarta i prodotti che non raggiungono i requisiti minimi di qualità." />
        </div>
      </div>
    </div>
  );
}

function SkuList({ title, skus, tone }: { title: string; skus: string[]; tone: BadgeTone }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink-800">{title}</span>
          <Badge tone={tone}>{skus.length}</Badge>
        </div>
        {skus.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {skus.slice(0, 30).map((s) => (
              <span key={s} className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                {s}
              </span>
            ))}
            {skus.length > 30 && <span className="text-xs text-ink-500">+{skus.length - 30}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OptionRow({ checked, onSelect, title, description }: { checked: boolean; onSelect: () => void; title: string; description: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors', checked ? 'border-brand-accent bg-brand-soft/70' : 'border-ink-200 bg-white hover:bg-ink-50')}
    >
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-brand-accent bg-brand-accent' : 'border-ink-300')}>
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-ink-900">{title}</span>
        <span className="block text-sm text-ink-500">{description}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Step 8 — Mapping attributi.
// ---------------------------------------------------------------------------

function Step8({
  attributes,
  headers,
  mapping,
  setMapping,
  skuHeader,
  nameHeader,
  categoryHeader,
  extraCols,
  setExtraCols,
}: {
  attributes: PresetAttributeOption[] | null;
  headers: string[];
  mapping: Record<string, string>;
  setMapping: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  skuHeader: string;
  nameHeader: string;
  categoryHeader: string;
  extraCols: Record<string, string>;
  setExtraCols: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  if (attributes === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Caricamento attributi…
      </div>
    );
  }
  // Colonne non ancora usate (né SKU, né Nome, né Categoria, né mappate).
  const usedHeaders = new Set<string>([skuHeader, nameHeader, categoryHeader, ...Object.values(mapping)].filter(Boolean));
  const importableAll = headers.filter((h) => !usedHeaders.has(h));
  const importedCount = importableAll.filter((h) => h in extraCols).length;
  function includeAll() {
    setExtraCols((prev) => {
      const next = { ...prev };
      for (const h of importableAll) if (!(h in next)) next[h] = h;
      return next;
    });
  }
  function excludeAll() {
    setExtraCols((prev) => {
      const next = { ...prev };
      for (const h of importableAll) delete next[h];
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Include/escludi: di default tutte le colonne sono dati; togli quelle inutili. */}
      <div className="rounded-lg border border-brand-accent/30 bg-brand-soft/50 p-4">
        <p className="text-sm font-semibold text-ink-900">Colonne importate come dati</p>
        <p className="mt-0.5 text-xs text-ink-600">
          Ogni colonna del file diventa un&apos;informazione per lo SKU (es. peso, descrizione): non
          devi mappare nulla. <strong>Escludi</strong> qui sotto solo le colonne che non ti servono
          (es. costo interno). L&apos;unica cosa da mappare è la <strong>Categoria</strong> (già
          scelta). Le info restano sotto l&apos;audit anti-invenzione.
        </p>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="text-ink-500">{importedCount}/{importableAll.length} colonne incluse</span>
          <button type="button" onClick={includeAll} className="font-medium text-brand-accent hover:underline">Includi tutte</button>
          <button type="button" onClick={excludeAll} className="font-medium text-ink-500 hover:underline">Escludi tutte</button>
        </div>
      </div>

      <details className="rounded-lg border border-ink-100">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink-700">
          Mappatura avanzata (facoltativa): abbina attributi del preset a colonne specifiche
        </summary>
        <div className="space-y-2 p-3" data-tour="mapping">
        {attributes.map((attr) => (
          <div key={attr.id} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-ink-100 p-3 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-800">{attr.name}</span>
              {attr.isRequired && <Badge tone="amber">obbligatorio</Badge>}
            </div>
            <Select
              value={mapping[attr.id] ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setMapping((prev) => {
                  const next = { ...prev };
                  if (v) next[attr.id] = v;
                  else delete next[attr.id];
                  return next;
                });
              }}
            >
              <option value="">— Nessuna colonna —</option>
              {headers.map((h) => (
                <option
                  key={h}
                  value={h}
                  disabled={h === skuHeader || h === nameHeader || h === categoryHeader}
                >
                  {h}
                  {h === skuHeader ? ' (colonna SKU)' : ''}
                  {h === nameHeader ? ' (colonna Nome)' : ''}
                  {h === categoryHeader ? ' (colonna Categoria)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ))}
        </div>
      </details>

      <FreeColumnsSection
        headers={headers}
        mapping={mapping}
        skuHeader={skuHeader}
        categoryHeader={categoryHeader}
        extraCols={extraCols}
        setExtraCols={setExtraCols}
      />
    </div>
  );
}

/**
 * "Altre colonne del file": qualsiasi colonna non ancora usata può essere
 * importata come dato in più (fatto passato all'AI). Il nome è modificabile.
 */
function FreeColumnsSection({
  headers,
  mapping,
  skuHeader,
  categoryHeader,
  extraCols,
  setExtraCols,
}: {
  headers: string[];
  mapping: Record<string, string>;
  skuHeader: string;
  categoryHeader: string;
  extraCols: Record<string, string>;
  setExtraCols: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const used = new Set<string>([skuHeader, categoryHeader, ...Object.values(mapping)].filter(Boolean));
  const available = headers.filter((h) => !used.has(h));
  if (available.length === 0) return null;
  return (
    <div className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 p-4" data-tour="extra-columns">
      <p className="text-sm font-medium text-ink-800">Colonne da importare (togli la spunta per escludere)</p>
      <p className="mt-0.5 text-xs text-ink-600">
        Di default vengono importate tutte come dato. <strong>Togli la spunta</strong> a quelle che
        non ti servono (es. «costo interno»). Puoi anche rinominare il campo. Ogni dato resta sotto
        l’audit anti-invenzione.
      </p>
      <div className="mt-3 space-y-2">
        {available.map((h) => {
          const checked = h in extraCols;
          return (
            <div key={h} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[auto_1fr_1fr]">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setExtraCols((prev) => {
                      const next = { ...prev };
                      if (on) next[h] = h;
                      else delete next[h];
                      return next;
                    });
                  }}
                  className="h-4 w-4 rounded border-ink-300"
                />
                <span className="font-mono text-xs text-ink-600">{h}</span>
              </label>
              {checked ? (
                <>
                  <span className="hidden text-center text-xs text-ink-500 sm:block">→</span>
                  <Input
                    value={extraCols[h] ?? h}
                    onChange={(e) =>
                      setExtraCols((prev) => ({ ...prev, [h]: e.target.value }))
                    }
                    placeholder="Nome del campo"
                    aria-label={`Nome del campo per ${h}`}
                  />
                </>
              ) : (
                <span className="text-xs text-ink-500 sm:col-span-2">non importata</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 9 — Verifica dati.
// ---------------------------------------------------------------------------

function Step9({
  products,
  importSummary,
  batchId,
  hasImages,
  analyzing,
  analyzeProgress,
  categoryFromFile,
}: {
  products: BatchProductRow[] | null;
  importSummary: ImportResultV2 | null;
  batchId: string;
  hasImages: boolean;
  analyzing: boolean;
  analyzeProgress: { done: number; total: number } | null;
  categoryFromFile: boolean;
}) {
  if (products === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Importazione dei prodotti…
      </div>
    );
  }
  const senzaCategoria = products.filter((p) => !p.category).length;
  const pct =
    analyzeProgress && analyzeProgress.total > 0
      ? Math.min(100, Math.round((analyzeProgress.done / analyzeProgress.total) * 100))
      : null;
  return (
    <div className="space-y-4">
      {hasImages && analyzing && (
        <div className="space-y-2 rounded-lg border border-brand-accent/20 bg-brand-soft/60 p-3" data-tour="analyze">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-accent">
            <Loader2 className="h-4 w-4 animate-spin" />
            {categoryFromFile
              ? 'Analisi foto: leggo le etichette per estrarre i dati (la categoria la prendo dal file)…'
              : 'Analisi automatica delle foto: leggo le etichette e deduco la categoria…'}
          </div>
          <div className="flex items-center justify-between text-xs text-brand-accent/80">
            <span>
              {analyzeProgress ? `${analyzeProgress.done} / ${analyzeProgress.total} prodotti` : 'Avvio…'}
            </span>
            <span>{pct !== null ? `${pct}%` : ''}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/60">
            <div
              className="h-full rounded-full bg-brand-accent transition-all duration-500"
              style={{ width: `${pct ?? 5}%` }}
            />
          </div>
          <p className="text-xs text-brand-accent/80">
            <strong>Puoi chiudere questa pagina</strong>: l&apos;analisi prosegue da sola e riprende
            da dove è arrivata. Resta qui solo se vuoi rivedere le categorie prima di generare.
          </p>
        </div>
      )}
      {hasImages && !analyzing && (
        <p className="rounded-lg border border-ink-100 bg-ink-50 p-3 text-sm text-ink-600">
          Foto analizzate: i dati leggibili sull’etichetta sono stati usati come fatti. Materiali,
          composizione e dati tecnici non deducibili dalle foto restano da inserire.
        </p>
      )}
      {!analyzing && senzaCategoria > 0 && (
        <Avviso tono="attenzione">
          <strong>{senzaCategoria} prodotti senza categoria.</strong> Senza categoria le schede
          escono generiche (mancano i campi specifici del prodotto). Assegna una categoria qui
          sotto prima di continuare.
        </Avviso>
      )}
      {importSummary && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="blue">{importSummary.imported} importati</Badge>
          <Badge tone="green">{importSummary.valid} validi</Badge>
          {/* Diceva «da rivedere»: una parola che promette una revisione che
              non esiste da nessuna parte. Sono righe **scartate**, e adesso si
              può anche vedere quali. */}
          <Badge tone="amber">{importSummary.invalid} righe scartate</Badge>
          {importSummary.imageOnly > 0 && <Badge tone="violet">{importSummary.imageOnly} solo-immagini</Badge>}
          {/* Prodotti entrati senza i loro dati: il database ha rifiutato la
              scrittura. Prima finiva solo nella telemetria e l'utente scopriva
              il buco a generazione fatta. */}
          {importSummary.factsInsertErrors > 0 && (
            <Badge tone="red">{importSummary.factsInsertErrors} senza dati (scrittura rifiutata)</Badge>
          )}
          {/* Era il caso di TUTTI i prodotti di ogni catalogo, e nessuno lo
              diceva: si scopriva guardando i risultati. */}
          {importSummary.senzaNome > 0 && (
            <Badge tone="amber">{importSummary.senzaNome} col codice al posto del nome</Badge>
          )}
          {importSummary.categoriesMatched > 0 && (
            <Badge tone="green">{importSummary.categoriesMatched} collegati a categoria</Badge>
          )}
          {importSummary.scartate.length > 0 && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm text-ink-600 underline underline-offset-2">
                Quali righe sono state scartate
              </summary>
              <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-ink-200 bg-white p-2 text-xs">
                {importSummary.scartate.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-1 py-0.5">
                    <span className="truncate font-mono text-ink-700">{r.sku ?? '(senza codice)'}</span>
                    <span className="shrink-0 text-ink-500">{r.motivo}</span>
                  </li>
                ))}
              </ul>
              {importSummary.invalid > importSummary.scartate.length && (
                <p className="mt-1 text-xs text-ink-500">
                  Elenco tagliato alle prime {importSummary.scartate.length}: serve a capire cosa è
                  successo, non a rifare l’import.
                </p>
              )}
            </details>
          )}
          {importSummary.unmatchedCategories.length > 0 && (
            <Badge tone="amber">
              {importSummary.unmatchedCategories.length} categorie non riconosciute
            </Badge>
          )}
        </div>
      )}
      {importSummary && importSummary.unmatchedCategories.length > 0 && (
        <p className="text-xs text-amber-700">
          Categorie nel file non presenti nel catalogo:{' '}
          {importSummary.unmatchedCategories.slice(0, 8).join(', ')}
          {importSummary.unmatchedCategories.length > 8 ? '…' : ''}. Puoi crearle da
          Impostazioni → Categorie (Importa lista) e reimportare.
        </p>
      )}
      {products.length > 0 && (
        <div data-tour="assign-categories">
          <CategoryAssigner batchId={batchId} reloadKey={analyzing ? (analyzeProgress?.done ?? 0) : -1} />
        </div>
      )}
      {products.length === 0 ? (
        <p className="text-sm text-ink-500">Nessun prodotto importato. Torna indietro e controlla la colonna SKU o le sorgenti.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>SKU</TH>
              <TH>Nome</TH>
              <TH>Categoria</TH>
              <TH>Qualità</TH>
              <TH>Attributi</TH>
              <TH>Immagini</TH>
              <TH>Stato</TH>
            </TR>
          </THead>
          <TBody>
            {products.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium text-ink-900">{p.sku ?? '—'}</TD>
                <TD>{p.name ?? '—'}</TD>
                <TD>{p.category ?? '—'}</TD>
                <TD>
                  <Badge tone={p.quality >= 80 ? 'green' : p.quality >= 60 ? 'amber' : 'red'}>{p.quality}</Badge>
                </TD>
                <TD>{p.attributesCount}</TD>
                <TD>{p.imagesCount}</TD>
                <TD>
                  <Badge tone={p.status === 'eligible' ? 'green' : 'gray'}>{p.status}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {hasImages && !analyzing && (
        <ImageQcPanel batchId={batchId} reloadKey={analyzeProgress?.done ?? 0} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 10 — Campione.
// ---------------------------------------------------------------------------

function Step10({
  sampleDone,
  busy,
  onRun,
  completeness,
  content,
}: {
  sampleDone: boolean;
  busy: boolean;
  onRun: () => void;
  completeness: Completeness | null;
  content: SampleCopy | null;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Genera un campione gratuito su un prodotto rappresentativo per verificare tono e correttezza
        prima della generazione in massa. Se il prodotto ha solo foto, l’AI legge prima le etichette
        in automatico.
      </p>
      {!sampleDone ? (
        <div data-tour="sample" className="inline-block">
          <Button onClick={onRun} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'Genero il campione…' : 'Genera campione'}
          </Button>
        </div>
      ) : (
        <>
          <Avviso tono="riuscito">Campione generato.</Avviso>
          {content && <SampleOutput content={content} />}
          {completeness && <SampleCompleteness completeness={completeness} />}
          <Button variant="outline" size="sm" onClick={onRun} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Rigenera campione
          </Button>
        </>
      )}
    </div>
  );
}

/** Mostra inline la scheda generata dal campione (titolo, descrizioni, bullet, meta). */
function SampleOutput({ content }: { content: SampleCopy }) {
  const bullets = Array.isArray(content.bullets) ? content.bullets : [];
  return (
    <div className="space-y-4 rounded-lg border border-ink-200 bg-white p-4">
      {content.title && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Titolo</p>
          <p className="mt-0.5 text-base font-semibold text-ink-900">{content.title}</p>
        </div>
      )}
      {content.shortDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Descrizione breve</p>
          <p className="mt-0.5 text-sm text-ink-700">{content.shortDescription}</p>
        </div>
      )}
      {content.longDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Descrizione lunga</p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-ink-700">{content.longDescription}</p>
        </div>
      )}
      {bullets.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Punti chiave</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-ink-700">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {content.metaDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Meta description</p>
          <p className="mt-0.5 text-sm text-ink-500">{content.metaDescription}</p>
        </div>
      )}
    </div>
  );
}

// Riepilogo completezza del campione (stato + attributi mancanti).
function SampleCompleteness({ completeness }: { completeness: Completeness }) {
  const isPartial =
    completeness.status === 'partial' || completeness.status === 'insufficient';
  return (
    <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-700">Completezza campione</span>
        <Badge tone={COMPLETENESS_TONES[completeness.status]}>{COMPLETENESS_LABELS[completeness.status]}</Badge>
      </div>
      {isPartial && (
        <p className="text-sm text-amber-700">Generazione parziale: i dati mancanti non sono stati inventati.</p>
      )}
      {completeness.missingAttributes.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Attributi mancanti</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {completeness.missingAttributes.map((a) => (
              <span key={a} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                {a}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 11 — Conferma e avvio.
// ---------------------------------------------------------------------------

function Step11({
  importSummary,
  notifyByEmail,
  setNotifyByEmail,
}: {
  importSummary: ImportResultV2 | null;
  notifyByEmail: boolean;
  setNotifyByEmail: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4" data-tour="launch">
      <Card>
        <CardContent className="space-y-3 p-5 text-sm text-ink-600">
          <p className="font-medium text-ink-900">Pronto per la generazione</p>
          {importSummary && (
            <ul className="list-inside list-disc space-y-1">
              <li>{importSummary.imported} prodotti importati</li>
              <li>{importSummary.valid} idonei alla generazione</li>
              {importSummary.imageOnly > 0 && <li>{importSummary.imageOnly} prodotti solo-immagini</li>}
            </ul>
          )}
          {importSummary && importSummary.imageOnly > 0 && (
            <div className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 p-3 text-brand-accent">
              <p className="font-medium">Prodotti solo-immagini</p>
              <p className="mt-0.5 text-ink-600">
                All’avvio l’AI legge automaticamente le etichette delle foto ed estrae i dati (peso,
                ingredienti, valori nutrizionali…). I prodotti con abbastanza dati leggibili
                diventano idonei e vengono generati; l’eventuale conteggio «idonei» qui sopra si
                aggiorna dopo la lettura.
              </p>
            </div>
          )}
          <p>Verrà riservato 1 credito per ogni prodotto idoneo. La generazione avviene in background: puoi chiudere la pagina.</p>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
            <input
              type="checkbox"
              checked={notifyByEmail}
              onChange={(e) => setNotifyByEmail(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300"
            />
            <span>
              <span className="font-medium text-ink-800">Avvisami via email quando è pronto</span>
              <span className="mt-0.5 block text-ink-500">
                Ti mandiamo un’email all’indirizzo del tuo account appena la generazione finisce.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-2 text-ink-500">
            <ImageIcon className="h-4 w-4" /> Potrai rivedere e correggere i risultati al termine.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
