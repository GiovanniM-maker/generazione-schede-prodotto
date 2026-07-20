'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
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
} from 'lucide-react';
import {
  listPublishedPresets,
  createBatchV2,
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
  type PublishedPresetSummary,
  type PresetExplorer,
  type UploadSpreadsheetResult,
  type UploadImagesResult,
  type UploadedFileSummary,
  type PresetAttributeOption,
  type BatchProductRow,
  type WizardSourceType,
} from '@/lib/actions/batch-wizard';
import { runVisualExtractionForBatch } from '@/lib/actions/visual';
import { CategoryAssigner } from '@/components/batch/category-assigner';
import { GuidedTour, tourSeen, markTourSeen, type TourStep } from '@/components/onboarding/guided-tour';
import { HelpBubble } from '@/components/onboarding/help-bubble';
import { WizardGuide } from '@/components/onboarding/wizard-guide';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';
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

type SourceMode = 'images' | 'spreadsheet' | 'both';

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

  const [stepId, setStepId] = useState(1);

  // Tour guidato del passo corrente: si apre da solo la prima volta, poi solo
  // dal pulsante "Guida".
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    setTourOpen(Boolean(STEP_TOURS[stepId]) && !tourSeen(`wizard.${stepId}.v1`));
  }, [stepId]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [presetVersionId, setPresetVersionId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [presets, setPresets] = useState<PublishedPresetSummary[] | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Step 2
  const [explorer, setExplorer] = useState<PresetExplorer | null>(null);
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());
  const [expandedAttr, setExpandedAttr] = useState<Set<string>>(new Set());

  // Step 5
  const [spreadsheetResult, setSpreadsheetResult] = useState<UploadSpreadsheetResult | null>(null);
  const [imagesResult, setImagesResult] = useState<UploadImagesResult | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [skuDelimiter, setSkuDelimiter] = useState<'_' | '-' | '.' | ' '>('_');
  const [reparsing, setReparsing] = useState(false);

  // Step 6
  const [analysis, setAnalysis] = useState<AnalyzeData | null>(null);

  // Step 7
  const [skuHeader, setSkuHeader] = useState('');
  const [categoryHeader, setCategoryHeader] = useState('');
  const [importOption, setImportOption] = useState<'complete' | 'includeImageOnly' | 'excludeIncomplete'>('complete');

  // Step 8
  const [attributes, setAttributes] = useState<PresetAttributeOption[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // Colonne libere del file da importare come fatti: header -> nome attributo.
  const [extraCols, setExtraCols] = useState<Record<string, string>>({});

  // Step 9
  const [products, setProducts] = useState<BatchProductRow[] | null>(null);
  const [importSummary, setImportSummary] = useState<{ imported: number; valid: number; invalid: number; imageOnly: number; categoriesMatched: number; unmatchedCategories: string[] } | null>(null);

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
      if (res.ok) setPresets(res.data);
      else setError(res.error);
    });
  }, [presets]);

  // Step 2: esploratore preset.
  useEffect(() => {
    if (stepId !== 2 || !presetVersionId) return;
    setExplorer(null);
    void getPresetExplorer({ presetVersionId }).then((res) => {
      if (res.ok) setExplorer(res.data);
      else setError(res.error);
    });
  }, [stepId, presetVersionId]);

  // Step 6: analisi.
  useEffect(() => {
    if (stepId !== 6 || !batchId) return;
    setAnalysis(null);
    void analyzeBatch({ batchId }).then((res) => {
      if (res.ok) {
        setAnalysis(res.data);
        if (!skuHeader && res.data.suggestedSkuHeader) setSkuHeader(res.data.suggestedSkuHeader);
      } else setError(res.error);
    });
  }, [stepId, batchId, skuHeader]);

  // Step 8: attributi + header per mapping.
  useEffect(() => {
    if (stepId !== 8 || !batchId) return;
    setAttributes(null);
    void getBatchPresetAttributes({ batchId }).then((res) => {
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
    });
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

  // Step 9: import + prodotti.
  useEffect(() => {
    if (stepId !== 9 || !batchId) return;
    setProducts(null);
    setImportSummary(null);
    const options = {
      includeImageOnly: hasImages && (importOption === 'includeImageOnly' || sourceMode === 'images'),
      excludeIncomplete: importOption === 'excludeIncomplete',
    };
    void (async () => {
      const imp = await confirmImportV2({
        batchId,
        skuHeader: hasSpreadsheet ? skuHeader : '',
        attributeMapping: hasSpreadsheet ? mapping : {},
        categoryHeader: hasSpreadsheet ? categoryHeader : undefined,
        extraColumns: hasSpreadsheet
          ? Object.entries(extraCols).map(([header, name]) => ({ header, name: name || header }))
          : undefined,
        options,
      });
      if (!imp.ok) {
        setError(imp.error);
        return;
      }
      setImportSummary(imp.data);
      const list = await getBatchProductsV2({ batchId });
      if (list.ok) setProducts(list.data.products);
      else setError(list.error);
    })();
  }, [stepId, batchId]);

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
    setBusy(true);
    setError(null);
    const res = await createBatchV2({ name, description: description || undefined, presetId: selectedPresetId });
    setBusy(false);
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
    const sourceTypes: WizardSourceType[] =
      sourceMode === 'both' ? ['spreadsheet', 'images'] : sourceMode === 'spreadsheet' ? ['spreadsheet'] : ['images'];
    setBusy(true);
    setError(null);
    const res = await setBatchSources({ batchId, sourceTypes });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    nextStep();
  }

  async function doUploadSpreadsheet(file: File) {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set('batchId', batchId);
    fd.set('sourceType', 'spreadsheet');
    fd.set('files', file);
    const res = await uploadBatchFiles(fd);
    setBusy(false);
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

  function changeSkuDelimiter(d: '_' | '-' | '.' | ' ') {
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
      const r = await fetch(`/api/batches/${batchId}/enqueue`, { method: 'POST' });
      if (r.status === 402) {
        setError('Crediti insufficienti per generare l’intero batch. Acquista crediti dalla pagina Abbonamento.');
        return;
      }
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Errore nell’avvio della generazione');
      }
      router.push(`/app/batches/${batchId}/processing`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  // --- Render ---

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <ProgressBar steps={activeSteps} activeIndex={activeIndex} />
        </div>
        {STEP_TOURS[stepId] && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTourOpen(true)}
            aria-label="Rivedi la guida di questo passo"
            className="shrink-0 text-gray-500"
          >
            <HelpCircle className="h-4 w-4" />
            Guida
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
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

      {stepId === 3 && <Step3 sourceMode={sourceMode} setSourceMode={setSourceMode} />}

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
          categoryHeader={categoryHeader}
          setCategoryHeader={setCategoryHeader}
          importOption={importOption}
          setImportOption={setImportOption}
        />
      )}

      {stepId === 8 && <Step8 attributes={attributes} headers={headers} mapping={mapping} setMapping={setMapping} skuHeader={skuHeader} categoryHeader={categoryHeader} extraCols={extraCols} setExtraCols={setExtraCols} />}

      {stepId === 9 && batchId && (
        <Step9 products={products} importSummary={importSummary} batchId={batchId} hasImages={hasImages} />
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

      {stepId === 11 && <Step11 importSummary={importSummary} />}

      {/* Navigazione */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-4">
        <Button variant="ghost" onClick={prevStep} disabled={busy || activeIndex <= 0}>
          <ArrowLeft className="h-4 w-4" />
          Indietro
        </Button>

        <StepPrimaryAction
          stepId={stepId}
          busy={busy}
          canProceed={{
            1: name.trim() !== '' && !!selectedPresetId && (presets?.length ?? 0) > 0,
            3: !!sourceMode,
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
      <WizardGuide />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra di avanzamento.
// ---------------------------------------------------------------------------

function ProgressBar({ steps, activeIndex }: { steps: StepDef[]; activeIndex: number }) {
  const pct = steps.length > 1 ? Math.round((Math.max(0, activeIndex) / (steps.length - 1)) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span className="font-medium text-gray-700">
          Passo {Math.max(1, activeIndex + 1)} di {steps.length}
        </span>
        <span>{steps[Math.max(0, activeIndex)]?.title}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
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
  onStep1,
  onSources,
  onSample,
  onStart,
  onNext,
}: {
  stepId: number;
  busy: boolean;
  canProceed: Record<number, boolean>;
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
        {busy ? spinner : <>Continua <ArrowRight className="h-4 w-4" /></>}
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
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento preset…
          </div>
        )}
        {presets !== null && presets.length === 0 && (
          <Card>
            <CardContent className="space-y-3 p-6 text-sm text-gray-600">
              <p className="font-medium text-gray-900">Nessun preset pubblicato</p>
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
                    active ? 'border-brand-accent bg-blue-50/50 ring-1 ring-brand-accent' : 'border-gray-200 bg-white hover:bg-gray-50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    {active && <Check className="h-4 w-4 text-brand-accent" />}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">Settore: {p.sectorName}</div>
                  <div className="mt-2 flex gap-2 text-xs text-gray-500">
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
        <div className="text-sm text-gray-500">
          <Link href="/app/settings/presets" className="font-medium text-brand-accent underline underline-offset-2">
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
      <div className="flex items-center gap-2 text-sm text-gray-500">
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
      <p className="text-sm text-gray-500">
        Settore <span className="font-medium text-gray-800">{explorer.sectorName}</span>. Questi sono gli attributi che verranno estratti e generati. Sola lettura.
      </p>
      {explorer.categories.length === 0 && <p className="text-sm text-gray-500">Nessuna categoria configurata nel preset.</p>}
      {explorer.categories.map((cat) => {
        const open = expandedCat.has(cat.id);
        return (
          <Card key={cat.id}>
            <button type="button" onClick={() => toggle(expandedCat, setExpandedCat, cat.id)} className="flex w-full items-center justify-between p-4 text-left">
              <span className="font-medium text-gray-900">{cat.name}</span>
              <span className="flex items-center gap-2 text-sm text-gray-500">
                {cat.attributes.length} attributi
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </button>
            {open && (
              <CardContent className="space-y-2 pt-0">
                {cat.attributes.map((attr) => {
                  const aopen = expandedAttr.has(attr.id);
                  return (
                    <div key={attr.id} className="rounded-lg border border-gray-100">
                      <button type="button" onClick={() => toggle(expandedAttr, setExpandedAttr, attr.id)} className="flex w-full items-center justify-between px-3 py-2 text-left">
                        <span className="flex items-center gap-2">
                          <span className="text-sm text-gray-800">{attr.name}</span>
                          <Badge tone="gray">{attr.dataType}</Badge>
                          {attr.isRequired && <Badge tone="amber">obbligatorio</Badge>}
                        </span>
                        {aopen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      </button>
                      {aopen && (
                        <div className="space-y-2 border-t border-gray-100 px-3 py-2 text-sm text-gray-600">
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Istruzione di estrazione</span>
                            <p className="mt-0.5">{attr.extractionInstruction ?? '—'}</p>
                          </div>
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Istruzione di generazione</span>
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
  { mode: null, title: 'Google Drive', description: 'Colleghi una cartella Drive con file e immagini.', disabled: true, note: 'In arrivo' },
  { mode: null, title: 'PDF', description: 'Estrazione da schede tecniche in PDF.', disabled: true, note: 'Prossimamente' },
];

function Step3({ sourceMode, setSourceMode }: { sourceMode: SourceMode | null; setSourceMode: (m: SourceMode) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
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
                active ? 'border-brand-accent bg-blue-50/50 ring-1 ring-brand-accent' : 'border-gray-200 bg-white hover:bg-gray-50',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{card.title}</span>
                {card.note && <Badge tone="violet">{card.note}</Badge>}
                {active && <Check className="h-4 w-4 text-brand-accent" />}
              </div>
              <p className="mt-1 text-sm text-gray-500">{card.description}</p>
            </button>
          );
        })}
      </div>
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
        <CardContent className="space-y-2 p-5 text-sm text-gray-600">
          <p className="font-medium text-gray-900">Regole SKU</p>
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
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-600">{imageNamingGuide}</pre>
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
  onUploadImages: (files: FileList | File[]) => void;
  skuDelimiter: '_' | '-' | '.' | ' ';
  onChangeDelimiter: (d: '_' | '-' | '.' | ' ') => void;
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
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-white p-6 text-center hover:bg-gray-50">
            <FileSpreadsheet className="h-6 w-6 text-gray-400" />
            <span className="text-sm text-gray-600">Seleziona un file .csv o .xlsx</span>
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
          {spreadsheetResult && (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <Check className="h-4 w-4" /> {spreadsheetResult.file.filename} — {spreadsheetResult.totalRows} righe
              </div>
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
              dragOver ? 'border-brand-accent bg-blue-50/50' : 'border-gray-300 bg-white hover:bg-gray-50',
            )}
          >
            <UploadCloud className="h-6 w-6 text-gray-400" />
            <span className="text-sm text-gray-600">Trascina qui le immagini o clicca per selezionarle (.jpg, .jpeg, .png, .webp, .zip)</span>
            <span className="text-xs text-gray-400">Caricamento diretto e in parallelo: veloce anche con centinaia di immagini.</span>
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
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span>Caricamento immagini…</span>
                <span>
                  {uploadProgress.done}/{uploadProgress.total}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
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
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3" data-tour="sku-separator">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-700">Separatore SKU:</span>
                  {([
                    { d: '_' as const, label: 'trattino_basso' },
                    { d: '-' as const, label: 'trattino -' },
                    { d: '.' as const, label: 'punto .' },
                    { d: ' ' as const, label: 'spazio' },
                  ]).map((opt) => (
                    <button
                      key={opt.d}
                      type="button"
                      disabled={reparsing}
                      onClick={() => onChangeDelimiter(opt.d)}
                      className={
                        skuDelimiter === opt.d
                          ? 'rounded-md border border-brand-accent bg-brand-accent px-2.5 py-1 text-xs font-medium text-white'
                          : 'rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400'
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                  {reparsing && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                </div>
                <p className="mt-2 text-xs text-gray-500">
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
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento in corso…
        </div>
      )}
    </div>
  );
}

function PreviewTable({ headers, rows }: { headers: string[]; rows: Array<Record<string, string>> }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">Nessuna riga da mostrare.</p>;
  return (
    <Table>
      <THead>
        <TR>
          {headers.map((h) => (
            <TH key={h}>{h}</TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.map((r, i) => (
          <TR key={i}>
            {headers.map((h) => (
              <TD key={h}>{r[h] ?? ''}</TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
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
            <TD className="text-gray-500">{f.problem ?? '—'}</TD>
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
        <div className="text-2xl font-semibold text-gray-900">{value}</div>
        <div className="mt-1 text-sm text-gray-500">{label}</div>
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
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Analisi in corso…
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Risultato del confronto tra le sorgenti (unione tramite SKU esatto).</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="SKU totali unici" value={analysis.totalUniqueSkus} tone="gray" />
        {hasSpreadsheet && hasImages && <Metric label="SKU in entrambe le fonti" value={analysis.inBoth.length} tone="gray" />}
        {hasSpreadsheet && <Metric label="Solo nel file" value={analysis.onlyFile.length} tone={analysis.onlyFile.length > 0 ? 'amber' : 'gray'} />}
        {hasImages && <Metric label="Solo nelle immagini" value={analysis.onlyImages.length} tone={analysis.onlyImages.length > 0 ? 'amber' : 'gray'} />}
        {hasSpreadsheet && <Metric label="SKU duplicati nel file" value={analysis.duplicateFileSkus.length} tone={analysis.duplicateFileSkus.length > 0 ? 'red' : 'gray'} />}
        {hasSpreadsheet && <Metric label="Righe senza SKU" value={analysis.rowsWithoutSku} tone={analysis.rowsWithoutSku > 0 ? 'red' : 'gray'} />}
        {hasImages && <Metric label="Immagini senza SKU" value={analysis.filesWithoutSku.length} tone={analysis.filesWithoutSku.length > 0 ? 'amber' : 'gray'} />}
      </div>
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
  categoryHeader,
  setCategoryHeader,
  importOption,
  setImportOption,
}: {
  analysis: AnalyzeData | null;
  hasImages: boolean;
  hasSpreadsheet: boolean;
  headers: string[];
  skuHeader: string;
  setSkuHeader: (v: string) => void;
  categoryHeader: string;
  setCategoryHeader: (v: string) => void;
  importOption: 'complete' | 'includeImageOnly' | 'excludeIncomplete';
  setImportOption: (v: 'complete' | 'includeImageOnly' | 'excludeIncomplete') => void;
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
          <p className="mt-1 text-xs text-gray-500">Le righe senza SKU in questa colonna verranno scartate.</p>
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
          <p className="mt-1.5 text-xs text-gray-600">
            La categoria di ogni prodotto viene presa da questa colonna e agganciata in automatico al
            tuo catalogo (nessuna AI). <strong>Decide quali attributi e istruzioni del preset vengono
            usati in generazione</strong>: un Vino riceve gli attributi del vino, non quelli della
            carne. I nomi non presenti nel catalogo verranno segnalati al passo successivo.
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
          <span className="text-sm font-medium text-gray-800">{title}</span>
          <Badge tone={tone}>{skus.length}</Badge>
        </div>
        {skus.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {skus.slice(0, 30).map((s) => (
              <span key={s} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {s}
              </span>
            ))}
            {skus.length > 30 && <span className="text-xs text-gray-400">+{skus.length - 30}</span>}
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
      className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors', checked ? 'border-brand-accent bg-blue-50/50' : 'border-gray-200 bg-white hover:bg-gray-50')}
    >
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-brand-accent bg-brand-accent' : 'border-gray-300')}>
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-gray-900">{title}</span>
        <span className="block text-sm text-gray-500">{description}</span>
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
  categoryHeader,
  extraCols,
  setExtraCols,
}: {
  attributes: PresetAttributeOption[] | null;
  headers: string[];
  mapping: Record<string, string>;
  setMapping: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  skuHeader: string;
  categoryHeader: string;
  extraCols: Record<string, string>;
  setExtraCols: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  if (attributes === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Caricamento attributi…
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Associa ogni attributo del preset a una colonna del file. Gli attributi non associati verranno lasciati vuoti.</p>
      <div className="space-y-2" data-tour="mapping">
        {attributes.map((attr) => (
          <div key={attr.id} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-gray-100 p-3 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">{attr.name}</span>
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
                <option key={h} value={h} disabled={h === skuHeader || h === categoryHeader}>
                  {h}
                  {h === skuHeader ? ' (colonna SKU)' : ''}
                  {h === categoryHeader ? ' (colonna Categoria)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>

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
      <p className="text-sm font-medium text-gray-800">Altre colonne del file</p>
      <p className="mt-0.5 text-xs text-gray-600">
        Spunta le colonne extra da importare come dato (es. «descrizione materiale», «prezzo»). Ogni
        dato in più viene passato all’AI e resta comunque sotto l’audit anti-invenzione. Puoi
        rinominare il campo.
      </p>
      <div className="mt-3 space-y-2">
        {available.map((h) => {
          const checked = h in extraCols;
          return (
            <div key={h} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[auto_1fr_1fr]">
              <label className="flex items-center gap-2 text-sm text-gray-700">
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
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="font-mono text-xs text-gray-600">{h}</span>
              </label>
              {checked ? (
                <>
                  <span className="hidden text-center text-xs text-gray-400 sm:block">→</span>
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
                <span className="text-xs text-gray-400 sm:col-span-2">non importata</span>
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
}: {
  products: BatchProductRow[] | null;
  importSummary: { imported: number; valid: number; invalid: number; imageOnly: number; categoriesMatched: number; unmatchedCategories: string[] } | null;
  batchId: string;
  hasImages: boolean;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [visualMsg, setVisualMsg] = useState<string | null>(null);
  const [visualErr, setVisualErr] = useState<string | null>(null);

  async function analyzeImages() {
    setAnalyzing(true);
    setVisualErr(null);
    setVisualMsg(null);
    try {
      const res = await runVisualExtractionForBatch({ batchId });
      if (!res.ok) {
        setVisualErr(res.error);
        return;
      }
      const warnings: string[] = [];
      if (res.data.productsSkipped > 0) {
        warnings.push(
          `${res.data.productsSkipped} prodotti non sono stati analizzati (max ${res.data.maxProducts} per esecuzione): rilancia l'analisi per completarli.`,
        );
      }
      if (res.data.productsWithTruncatedImages > 0) {
        warnings.push(
          `Per ${res.data.productsWithTruncatedImages} prodotti sono state usate solo le prime ${res.data.maxImagesPerProduct} immagini.`,
        );
      }
      setVisualMsg(
        `${res.data.productsProcessed} prodotti analizzati, ${res.data.attributesSuggested} attributi suggeriti. Conferma i suggerimenti nella revisione dei dati.` +
          (warnings.length ? ` ${warnings.join(' ')}` : ''),
      );
    } catch {
      setVisualErr('Analisi immagini non riuscita. Riprova.');
    } finally {
      setAnalyzing(false);
    }
  }

  if (products === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Importazione dei prodotti…
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {hasImages && (
        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3" data-tour="analyze">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-600">
              Suggerimenti visivi: verranno usati come fatti solo se li confermi. Materiali,
              composizione e dati tecnici non sono deducibili dalle immagini.
            </p>
            <Button onClick={analyzeImages} disabled={analyzing} className="shrink-0">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analizza immagini
            </Button>
          </div>
          {visualMsg && (
            <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {visualMsg}{' '}
              <Link href={`/app/batches/${batchId}/input`} className="font-medium underline">
                Vai alla revisione
              </Link>
            </p>
          )}
          {visualErr && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{visualErr}</p>
          )}
        </div>
      )}
      {importSummary && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="blue">{importSummary.imported} importati</Badge>
          <Badge tone="green">{importSummary.valid} validi</Badge>
          <Badge tone="amber">{importSummary.invalid} da rivedere</Badge>
          {importSummary.imageOnly > 0 && <Badge tone="violet">{importSummary.imageOnly} solo-immagini</Badge>}
          {importSummary.categoriesMatched > 0 && (
            <Badge tone="green">{importSummary.categoriesMatched} collegati a categoria</Badge>
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
          <CategoryAssigner batchId={batchId} />
        </div>
      )}
      {products.length === 0 ? (
        <p className="text-sm text-gray-500">Nessun prodotto importato. Torna indietro e controlla la colonna SKU o le sorgenti.</p>
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
                <TD className="font-medium text-gray-900">{p.sku ?? '—'}</TD>
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
      <p className="text-sm text-gray-500">
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
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <Check className="h-4 w-4" /> Campione generato.
          </div>
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
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      {content.title && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Titolo</p>
          <p className="mt-0.5 text-base font-semibold text-gray-900">{content.title}</p>
        </div>
      )}
      {content.shortDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Descrizione breve</p>
          <p className="mt-0.5 text-sm text-gray-700">{content.shortDescription}</p>
        </div>
      )}
      {content.longDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Descrizione lunga</p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-gray-700">{content.longDescription}</p>
        </div>
      )}
      {bullets.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Punti chiave</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-gray-700">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {content.metaDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Meta description</p>
          <p className="mt-0.5 text-sm text-gray-500">{content.metaDescription}</p>
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
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Completezza campione</span>
        <Badge tone={COMPLETENESS_TONES[completeness.status]}>{COMPLETENESS_LABELS[completeness.status]}</Badge>
      </div>
      {isPartial && (
        <p className="text-sm text-amber-700">Generazione parziale: i dati mancanti non sono stati inventati.</p>
      )}
      {completeness.missingAttributes.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Attributi mancanti</p>
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

function Step11({ importSummary }: { importSummary: { imported: number; valid: number; invalid: number; imageOnly: number; categoriesMatched: number; unmatchedCategories: string[] } | null }) {
  return (
    <div className="space-y-4" data-tour="launch">
      <Card>
        <CardContent className="space-y-3 p-5 text-sm text-gray-600">
          <p className="font-medium text-gray-900">Pronto per la generazione</p>
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
              <p className="mt-0.5 text-gray-600">
                All’avvio l’AI legge automaticamente le etichette delle foto ed estrae i dati (peso,
                ingredienti, valori nutrizionali…). I prodotti con abbastanza dati leggibili
                diventano idonei e vengono generati; l’eventuale conteggio «idonei» qui sopra si
                aggiorna dopo la lettura.
              </p>
            </div>
          )}
          <p>Verrà riservato 1 credito per ogni prodotto idoneo. La generazione avviene in background.</p>
          <div className="flex items-center gap-2 text-gray-500">
            <ImageIcon className="h-4 w-4" /> Potrai rivedere e correggere i risultati al termine.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
