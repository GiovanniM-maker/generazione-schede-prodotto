'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HelpCircle, ArrowLeft, LifeBuoy } from 'lucide-react';
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
  importFromUrls,
  importFromPdfs,
  avviaListaSku,
  proseguiListaSku,
  progressoListaSku,
  listaConfermeIdentita,
  leggiFoglioListaSku,
  type FoglioListaSku,
  anteprimaListaSku,
  type AnteprimaListaSku,
  type ProgressoListaSku,
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
import type { MappaturaListaSku } from '@app/core';
import { motivoMancante } from '@app/core/comandi';
import {
  indiceStadio,
  leggiStadio,
  passiVisibili,
  passoAttivo,
  prossimoStadio,
  stadioDiRipresa,
  stadioPrecedente,
  primoPasso,
  STADI,
  SOTTOTITOLI,
  TITOLI,
  type Stadio,
} from '@app/core/stadi';
import { runVisualExtractionForBatch } from '@/lib/actions/visual';
import { verificaCreditiBatch, type VerificaBatchResult } from '@/lib/actions/diritti';
import {
  startVisualAnalysisAction,
  getVisualAnalysisProgressAction,
} from '@/lib/actions/visual-background';
import { ConfermaIdentita } from '@/components/batch/conferma-identita';
import { GuidedTour, tourSeen, markTourSeen } from '@/components/onboarding/guided-tour';
import { WizardGuide } from '@/components/onboarding/wizard-guide';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Avviso } from '@/components/ui/avviso';
import { cn } from '@/lib/utils';
import { normalizeCompleteness, type Completeness } from '@/lib/completeness';
import { STEP_TOURS } from '@/components/batch/passi/definizioni';
import type { AnalyzeData, SampleCopy, SourceMode } from '@/components/batch/passi/tipi';
import {
  sha256Hex,
  mimeFromName,
  messaggioDiRete,
  normalize,
  fuzzyHeader,
} from '@/components/batch/passi/utili';
import { ProgressBar, Sezione, StepPrimaryAction } from '@/components/batch/passi/pezzi';
import { Step1, Step2 } from '@/components/batch/passi/prepara';
import {
  ConfermeInSospeso,
  LavorazioneListaSku,
  Step3,
  Step4,
  Step5,
} from '@/components/batch/passi/carica';
import { Step6, Step7, Step8 } from '@/components/batch/passi/mappa';
import { EsitoListaSku, Step9 } from '@/components/batch/passi/ripara';
import { Step10, Step11 } from '@/components/batch/passi/prova';

// ---------------------------------------------------------------------------
// Wizard "Nuovo batch" v2 — multi-step, centrato sullo SKU. Ogni passo chiama
// le server action e mostra gli errori restituiti inline.
// ---------------------------------------------------------------------------

export function BatchWizard({ imageNamingGuide }: { imageNamingGuide: string }) {
  const router = useRouter();
  const parametri = useSearchParams();

  // Cinque stadi al posto di undici passi. Dentro uno stadio i vecchi passi
  // stanno tutti nella stessa schermata, uno sotto l'altro: sono cose che si
  // guardano insieme, non undici volte «Continua».
  const [stadio, setStadio] = useState<Stadio>('prepara');
  /** Ripresa in corso: finché non finisce non si mostra il passo 1 a vuoto. */
  const [ripresaInCorso, setRipresaInCorso] = useState(false);

  // Tour guidato del passo corrente: si apre da solo la prima volta, poi solo
  // dal pulsante "Guida".
  const [tourOpen, setTourOpen] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [presetVersionId, setPresetVersionId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode | null>(null);

  // Quali vecchi passi sono in vista adesso.
  //
  // Dentro «Mappa» l'associazione degli SKU e l'accostamento delle colonne
  // hanno senso solo con un foglio: chi carica solo immagini non ha colonne da
  // accostare. Prima quei due passi SPARIVANO dalla barra, che quindi cambiava
  // lunghezza a metà strada — «5 di 11» che diventa «5 di 9» mentre la si
  // guarda. Adesso gli stadi restano cinque e cambia solo cosa c'è dentro.
  const haFoglio = sourceMode === 'spreadsheet' || sourceMode === 'both';
  const passiInVista: number[] = passiVisibili(stadio, { haFoglio });
  const mostra = useCallback(
    (passo: number) => passiVisibili(stadio, { haFoglio }).includes(passo),
    [stadio, haFoglio],
  );
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

  /**
   * Se i crediti bastano, chiesto prima di premere «Avvia generazione».
   *
   * `null` finché non si arriva all'ultimo passo: si chiede lì, non prima,
   * perché fino a quel momento il numero di prodotti idonei cambia sotto i
   * piedi — l'importazione, la mappatura e l'assegnazione delle categorie lo
   * spostano tutti.
   */
  const [dirittiBatch, setDirittiBatch] = useState<VerificaBatchResult | null>(null);

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
  // Arrivati all'ultimo passo, si chiede se i crediti bastano. Ogni volta: fra
  // un tentativo e l'altro possono essere stati spesi altrove — un collega, un
  // altro batch — e una risposta vecchia qui vale meno di nessuna risposta.
  useEffect(() => {
    if (!mostra(11) || !batchId) return;
    let vivo = true;
    setDirittiBatch(null);
    verificaCreditiBatch(batchId).then((r) => {
      if (vivo) setDirittiBatch(r);
    });
    return () => {
      vivo = false;
    };
  }, [mostra, batchId]);

  const passoAvviabile = stadio !== 'prepara' || (presets !== null && presets.length > 0);
  useEffect(() => {
    setTourOpen(
      passoAvviabile && Boolean(STEP_TOURS[primoPasso(stadio)]) && !tourSeen(`wizard.${stadio}.v1`),
    );
  }, [stadio, passoAvviabile]);

  // Step 2
  const [explorer, setExplorer] = useState<PresetExplorer | null>(null);
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());
  const [expandedAttr, setExpandedAttr] = useState<Set<string>>(new Set());

  // Step 5
  /** Le fonti sono state inviate: da qui in poi c'è qualcosa da caricare. */
  const [sorgentiInviate, setSorgentiInviate] = useState(false);
  const [spreadsheetResult, setSpreadsheetResult] = useState<UploadSpreadsheetResult | null>(null);
  const [imagesResult, setImagesResult] = useState<UploadImagesResult | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
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
  const [importOption, setImportOption] = useState<
    'complete' | 'includeImageOnly' | 'excludeIncomplete'
  >('complete');

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
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [skuText, setSkuText] = useState('');
  const [skuDomini, setSkuDomini] = useState('');
  const [skuRaggruppa, setSkuRaggruppa] = useState(true);
  const [skuAnteprima, setSkuAnteprima] = useState<AnteprimaListaSku | null>(null);
  const [confermeAperte, setConfermeAperte] = useState(false);
  const [confermeInSospeso, setConfermeInSospeso] = useState(0);
  const [skuFoglio, setSkuFoglio] = useState<FoglioListaSku | null>(null);
  const [skuMappatura, setSkuMappatura] = useState<MappaturaListaSku | null>(null);
  const [coda, setCoda] = useState<ProgressoListaSku | null>(null);
  const [codaInCorso, setCodaInCorso] = useState(false);
  const rifErrore = useRef<HTMLDivElement | null>(null);

  // Step 9 — analisi immagini automatica (OCR etichette + categoria dedotta).
  const [analyzingImages, setAnalyzingImages] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  // Step 11 — avviso email a fine generazione (opt-in, attivo di default).
  const [notifyByEmail, setNotifyByEmail] = useState(true);

  // Step 10
  const [sampleDone, setSampleDone] = useState(false);
  const [sampleCompleteness, setSampleCompleteness] = useState<Completeness | null>(null);
  const [sampleContent, setSampleContent] = useState<SampleCopy | null>(null);

  // I fumetti dello stadio: SOLO quelli del suo primo passo.
  //
  // Il primo giro li univa tutti — dentro «Prepara» sarebbero stati quelli del
  // passo 1 più quelli del 2 — e il risultato era una guida più lunga proprio
  // sulla prima schermata. Cioè l'opposto di quello che questa tappa serve a
  // fare. Se ne accorge la suite del browser: due prove che non chiudevano mai
  // la guida hanno cominciato a trovarsela davanti al comando principale.
  const fumetti = STEP_TOURS[primoPasso(stadio)] ?? [];

  // Dentro uno stadio i pezzi compaiono man mano: la fonte si sceglie prima
  // che ci sia qualcosa da caricare, e l'anteprima del foglio esiste solo dopo
  // che il foglio è stato letto. Il comando in fondo è quello del primo pezzo
  // ancora da fare — non quello dell'ultimo, che chiederebbe di continuare
  // senza aver fatto niente.
  const fatto: Record<number, boolean> = {
    1: batchId !== null,
    2: true, // si guarda e basta
    3: sorgentiInviate,
    4: true, // istruzioni e template: si leggono
    5:
      (!haFoglio || !!spreadsheetResult) &&
      (!(sourceMode === 'images' || sourceMode === 'both') || !!imagesResult),
    6: true,
    7: true,
    8: true,
    9: true,
    10: sampleDone,
    11: false,
  };
  const passoInCorso = passoAttivo(passiInVista, fatto);

  const hasSpreadsheet = haFoglio;
  const hasImages = sourceMode === 'images' || sourceMode === 'both';

  const goTo = useCallback((s: Stadio) => {
    setError(null);
    setStadio(s);
    // Cambiando stadio si cambia schermata: restare a metà pagina è il modo
    // più veloce di far credere che non sia successo niente.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const nextStep = useCallback(() => {
    const p = prossimoStadio(stadio);
    if (p) goTo(p);
  }, [stadio, goTo]);

  const prevStep = useCallback(() => {
    const p = stadioPrecedente(stadio);
    if (p) goTo(p);
  }, [stadio, goTo]);

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
    if (!mostra(2) || !presetVersionId) return;
    setExplorer(null);
    setPassoInCaricamento(2);
    void getPresetExplorer({ presetVersionId })
      .then((res) => {
        if (res.ok) setExplorer(res.data);
        else setError(res.error);
      })
      .catch((e: unknown) => setError(messaggioDiRete(e)))
      .finally(() => setPassoInCaricamento((p) => (p === 2 ? null : p)));
  }, [mostra, presetVersionId]);

  // Step 6: analisi.
  useEffect(() => {
    if (!mostra(6) || !batchId) return;
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
  }, [mostra, batchId, skuHeader]);

  // Step 8: attributi + header per mapping.
  useEffect(() => {
    if (!mostra(8) || !batchId) return;
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
  }, [mostra, batchId, skuHeader]);

  // Step 7: prova a indovinare la colonna Categoria dalle intestazioni.
  useEffect(() => {
    if (!mostra(7) || categoryHeader) return;
    const hs = spreadsheetResult?.headers ?? [];
    const guess = hs.find((h) =>
      ['categoria', 'category', 'reparto', 'famiglia', 'tipologia', 'macrocategoria'].includes(
        normalize(h),
      ),
    );
    if (guess) setCategoryHeader(guess);
  }, [mostra, spreadsheetResult, categoryHeader]);

  // Step 7: e la colonna Nome. Il suggerimento arriva dal server insieme al
  // file (come quello dello SKU): la logica sta in @app/core, che qui non si
  // può importare — è un componente client e il pacchetto porta con sé
  // `node:crypto`.
  useEffect(() => {
    if (!mostra(7) || nameHeader) return;
    const guess = spreadsheetResult?.suggestedNameHeader;
    if (guess && guess !== skuHeader) setNameHeader(guess);
  }, [mostra, spreadsheetResult, nameHeader, skuHeader]);

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

  // La coda di conferma sopravvive alla sessione: sta a database, non nella
  // memoria del browser. Senza questo controllo, chi chiude la pagina con dei
  // codici da confermare non avrebbe più nessuna strada per tornarci — e la
  // riga «lo ritrovi riaprendo questa lavorazione» sarebbe una promessa che il
  // prodotto non mantiene.
  useEffect(() => {
    if (!mostra(3) || !batchId) return;
    let vivo = true;
    void (async () => {
      const res = await listaConfermeIdentita({ batchId }).catch(() => null);
      if (vivo) setConfermeInSospeso(res && res.ok ? res.data.length : 0);
    })();
    return () => {
      vivo = false;
    };
  }, [mostra, batchId, confermeAperte]);

  // Una coda lasciata a metà si ritrova riaprendo la lavorazione: lo stato sta
  // nel registro, non qui. Senza questa lettura, chi chiude la pagina durante
  // una lista da cinquecento codici non avrebbe nessuna strada per riprenderla
  // — e ricominciando da capo ripagherebbe le ricerche già fatte.
  useEffect(() => {
    if ((!mostra(3) && !mostra(9)) || !batchId || codaInCorso) return;
    let vivo = true;
    void (async () => {
      const res = await progressoListaSku({ batchId }).catch(() => null);
      if (vivo && res && res.ok && res.data.totale > 0) setCoda(res.data);
    })();
    return () => {
      vivo = false;
    };
  }, [mostra, batchId, codaInCorso]);

  // Un errore che compare fuori dallo schermo è un errore che non esiste.
  //
  // Il messaggio si scrive in cima al passo, ma il pulsante che lo provoca sta
  // in fondo alla pagina: chi clicca «Cerca e importa» dopo aver riempito il
  // riquadro dei codici è scrollato in basso, e l'esito — riuscito o fallito —
  // gli compare alle spalle. Il prodotto sembra non aver fatto niente.
  useEffect(() => {
    if (!error) return;
    rifErrore.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  // Step 9: import + prodotti (+ analisi immagini automatica).
  useEffect(() => {
    if (!mostra(9) || !batchId) return;
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

    // Import da URL o da PDF: i prodotti sono già stati creati dalla loro
    // action. NON rieseguire confirmImportV2 (cancellerebbe gli importati).
    if (sourceMode === 'url' || sourceMode === 'pdf' || sourceMode === 'sku') {
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
      includeImageOnly:
        hasImages && (importOption === 'includeImageOnly' || sourceMode === 'images'),
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
          categoryOverrides:
            hasSpreadsheet && Object.keys(categoryOverrides).length > 0
              ? categoryOverrides
              : undefined,
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
  }, [mostra, batchId]);

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
  // `history.replaceState` e NON `router.replace`: la pagina è dinamica, e il
  // replace del router rifà la richiesta al server — autenticazione compresa —
  // A OGNI CAMBIO DI PASSO. Era il motivo per cui il wizard «si fermava» fra un
  // passo e l'altro: undici passi, undici giri al server per aggiornare due
  // parametri nell'indirizzo che il server non usa nemmeno. La cronologia del
  // browser basta, e `useSearchParams` la vede lo stesso.
  useEffect(() => {
    if (!batchId || ripresaInCorso) return;
    const atteso = `?batch=${batchId}&stadio=${stadio}`;
    if (window.location.search !== atteso) {
      window.history.replaceState(null, '', `/app/batches/new${atteso}`);
    }
  }, [batchId, stadio, ripresaInCorso]);

  // Ripresa: `?batch=…` all'apertura significa che stiamo tornando su un
  // lavoro lasciato a metà.
  const batchDaRiprendere = parametri.get('batch');
  const stadioDaRiprendere = parametri.get('stadio');
  const passoDaRiprendere = parametri.get('passo');
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
        else if (
          d.sourceType === 'spreadsheet' ||
          d.sourceType === 'images' ||
          d.sourceType === 'pdf'
        )
          setSourceMode(d.sourceType);
        // La fonte «Lista SKU» mancava da questo elenco: riaprendo una sua
        // lavorazione, il passo 3 compariva SENZA nessuna fonte selezionata —
        // come se la scelta non fosse mai stata fatta — e il tetto qui sotto
        // riportava il passo indietro. Era il «mi porta al 3 e poi torna
        // indietro» visto dal vivo.
        else if (d.sourceType === 'sku_list') setSourceMode('sku');
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
        // caricato il massimo è il passo delle fonti. I prodotti contano quanto
        // i file: la Lista SKU li crea senza caricare niente.
        const massimo =
          d.spreadsheet || d.immagini > 0 || d.prodotti > 0 ? 9 : d.sourceType ? 4 : 3;
        // `?passo=8` continua a voler dire qualcosa: il wizard si scriveva da
        // solo quel numero nella cronologia, quindi sta nei segnalibri della
        // gente. Chi ci torna deve ritrovarsi dov'era, non all'inizio.
        setStadio(stadioDiRipresa(leggiStadio(stadioDaRiprendere, passoDaRiprendere), massimo));
      })
      .catch((e: unknown) => setError(messaggioDiRete(e)))
      .finally(() => {
        if (!annullato) setRipresaInCorso(false);
      });
    return () => {
      annullato = true;
    };
  }, [batchDaRiprendere, batchId, stadioDaRiprendere, passoDaRiprendere]);

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
      res = await createBatchV2({
        name,
        description: description || undefined,
        presetId: selectedPresetId,
      });
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
    // URL e PDF: flusso dedicato (creano i prodotti subito, saltano la
    // mappatura — non c'è un foglio di cui scegliere le colonne).
    if (sourceMode === 'url') {
      await importUrls();
      return;
    }
    if (sourceMode === 'pdf') {
      await importPdfs();
      return;
    }
    if (sourceMode === 'sku') {
      await importSku();
      return;
    }
    const sourceTypes: WizardSourceType[] =
      sourceMode === 'both'
        ? ['spreadsheet', 'images']
        : sourceMode === 'spreadsheet'
          ? ['spreadsheet']
          : ['images'];
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
    // Non `nextStep()`: i tre pezzi di «Carica» stanno nella stessa schermata.
    // Scelta la fonte, compare il caricamento — sotto, dove si stava già
    // guardando. Cambiare stadio qui salterebbe proprio il caricamento.
    setSorgentiInviate(true);
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
    goTo('ripara');
  }

  async function importPdfs() {
    if (!batchId) return;
    if (pdfFiles.length === 0) {
      setError('Scegli almeno una scheda tecnica in PDF.');
      return;
    }
    const fd = new FormData();
    fd.append('batchId', batchId);
    for (const f of pdfFiles) fd.append('files', f);
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await importFromPdfs(fd);
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
        `Nessun prodotto importato. ${res.data.failures[0]?.reason ?? 'Controlla che i PDF siano schede tecniche con testo selezionabile.'}`,
      );
      return;
    }
    setImportSummary({
      imported: res.data.imported,
      valid: res.data.imported - res.data.senzaFatti,
      invalid: res.data.senzaFatti,
      imageOnly: 0,
      // L'import da PDF fallisce per documento, non per riga: i motivi stanno
      // già nel suo elenco di `failures`.
      scartate: [],
      factsInsertErrors: 0,
      senzaNome: 0,
      categoriesMatched: 0,
      unmatchedCategories: [],
    });
    goTo('ripara');
  }

  // Il foglio arriva anche come parametro, non solo dallo stato.
  //
  // Chiamandola subito dopo `setSkuFoglio`, lo stato non è ancora aggiornato in
  // questa chiusura: `skuFoglio` è ancora `null`, la funzione crede che non ci
  // sia nessun file e con la casella di testo vuota cancella l'anteprima. Il
  // risultato era che dopo aver caricato un CSV i numeri non comparivano
  // affatto — cioè spariva l'unico momento in cui il cliente vede quanto gli
  // costerà, prima di spendere.
  async function anteprimaSku(mapp?: MappaturaListaSku | null, foglio?: FoglioListaSku | null) {
    if (!batchId) return;
    const mappatura = mapp ?? skuMappatura;
    const f = foglio ?? skuFoglio;
    const daFoglio = f && mappatura?.sku;
    if (!daFoglio && !skuText.trim()) {
      setSkuAnteprima(null);
      return;
    }
    const res = await anteprimaListaSku({
      batchId,
      ...(daFoglio ? { righeFoglio: f.righe, mappatura: mappatura! } : { testo: skuText }),
      raggruppa: skuRaggruppa,
    }).catch(() => null);
    setSkuAnteprima(res && res.ok ? res.data : null);
  }

  async function caricaFoglioSku(file: File) {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('batchId', batchId);
    fd.append('files', file);
    let res;
    try {
      res = await leggiFoglioListaSku(fd);
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
    setSkuFoglio(res.data);
    setSkuMappatura(res.data.suggerita);
    // L'anteprima parte subito: la mappatura suggerita è già utilizzabile, e
    // vedere i numeri prima di toccare le tendine è quello che fa capire se il
    // suggerimento ha preso le colonne giuste.
    if (res.data.suggerita.sku) void anteprimaSku(res.data.suggerita, res.data);
  }

  // ---------------------------------------------------------------------------
  // La coda a scaglioni, vista da qui.
  //
  // Un catalogo intero non si risolve in una richiesta: si mette in coda e poi
  // si fanno dei giri. Il ciclo sta nel browser ma lo STATO no — sta nel
  // registro, e per questo chiudere la pagina a metà costa il giro in corso e
  // nient'altro: si riapre la lavorazione e si riprende da dove era.
  // ---------------------------------------------------------------------------

  async function giraLaCoda(iniziale: ProgressoListaSku) {
    if (!batchId) return;
    setCoda(iniziale);
    setCodaInCorso(true);
    // Anche `busy`, che è quello che spegne i due pulsanti «Cerca e importa».
    // Senza, restano accesi per tutto il giro: un secondo clic farebbe partire
    // una seconda lavorazione sulla stessa coda, e due giri paralleli possono
    // prendere la stessa riga prima che l'altro l'abbia registrata — due
    // ricerche pagate e due prodotti dallo stesso codice.
    setBusy(true);
    let ultimo = iniziale;
    try {
      // Il tetto sui giri non è una scadenza: è la protezione da un giro che
      // non avanza mai. Se si esce di qui con la coda non finita, resta lo
      // stato a schermo e il tasto per riprendere — non un silenzio.
      for (let giro = 0; giro < 200 && !ultimo.finita; giro++) {
        const res = await proseguiListaSku({ batchId }).catch(() => null);
        if (!res || !res.ok) {
          setError(
            res && !res.ok ? res.error : 'La lavorazione si è interrotta: riprendi quando vuoi.',
          );
          return;
        }
        ultimo = res.data;
        setCoda(ultimo);
      }
    } finally {
      setCodaInCorso(false);
      setBusy(false);
    }
    if (ultimo.finita) concludiListaSku(ultimo);
  }

  /**
   * Rilegge dal registro com'è andata, e aggiorna quello che si vede.
   *
   * Serve DOPO la coda di conferma. Prima la conferma finiva con un
   * `goTo('ripara')` e basta: i prodotti nati lì non entravano in nessun conteggio —
   * il riepilogo restava quello di quando erano tutti ancora da confermare,
   * cioè zero — e i codici non riusciti non venivano nominati da nessuna
   * parte. Dieci codici entrati, sei prodotti usciti, e nessuna riga a
   * spiegare gli altri quattro.
   */
  async function aggiornaEsitoLista(): Promise<ProgressoListaSku | null> {
    if (!batchId) return null;
    const res = await progressoListaSku({ batchId }).catch(() => null);
    if (!res || !res.ok) return null;
    setCoda(res.data);
    if (res.data.importati > 0) setImportSummary(riepilogoDa(res.data));
    return res.data;
  }

  function concludiListaSku(d: ProgressoListaSku) {
    // Le ambiguità si sciolgono PRIMA di andare avanti: per quei codici non è
    // stato scritto nessun campo, e passare al passo dopo lascerebbe fuori dal
    // catalogo dei prodotti che l'utente crede di aver importato.
    if (d.daConfermare > 0) {
      setConfermeAperte(true);
      if (d.importati > 0) setImportSummary(riepilogoDa(d));
      return;
    }
    if (d.importati === 0) {
      // I motivi per cui può non aver importato niente vogliono dire cose molto
      // diverse, e dirlo genericamente manda l'utente a cercare il problema
      // dalla parte sbagliata.
      const perche =
        d.daRiprovare > 0 || d.esaurite > 0
          ? 'La ricerca non ha risposto: riprendi fra poco. I codici non sono stati archiviati come inesistenti.'
          : 'Nessuna pagina trovata per questi codici. Prova a indicare la marca o a limitare la ricerca al sito del fornitore.';
      setError(`Nessun prodotto importato. ${perche}`);
      return;
    }
    setImportSummary(riepilogoDa(d));
    setCoda(d);
    goTo('ripara');
  }

  function riepilogoDa(d: ProgressoListaSku) {
    return {
      imported: d.importati,
      valid: d.risolti,
      invalid: d.conRiserva,
      imageOnly: 0,
      scartate: [],
      factsInsertErrors: 0,
      senzaNome: 0,
      categoriesMatched: 0,
      unmatchedCategories: [],
    };
  }

  async function importSku() {
    if (!batchId) return;
    if (!skuText.trim() && !(skuFoglio && skuMappatura?.sku)) {
      setError('Incolla almeno un codice, oppure carica un file e indica la colonna dei codici.');
      return;
    }
    setBusy(true);
    setError(null);
    let res;
    try {
      const daFoglio = skuFoglio && skuMappatura?.sku;
      res = await avviaListaSku({
        batchId,
        ...(daFoglio
          ? { righeFoglio: skuFoglio.righe, mappatura: skuMappatura }
          : { testo: skuText }),
        raggruppa: skuRaggruppa,
        domini: skuDomini
          .split(/[\s,;]+/)
          .map((d) => d.trim())
          .filter(Boolean),
      });
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
    await giraLaCoda(res.data);
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
          failedSummaries.push({
            filename: t.name,
            sku: t.sku,
            status: 'errore',
            problem: t.problem,
          });
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
              failedSummaries.push({
                filename: t.name,
                sku: t.sku,
                status: 'errore',
                problem: 'Upload fallito',
              });
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
            failedSummaries.push({
              filename: t.name,
              sku: t.sku,
              status: 'errore',
              problem: 'Upload fallito',
            });
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
        // Il controllo prima di premere copre quasi tutti i casi. Resta la
        // corsa: un collega che avvia un altro batch nei secondi in mezzo. La
        // frase la si richiede al server invece di indovinarla, così dice lo
        // stesso numero del riquadro qui sopra — e nomina la pagina giusta,
        // che si chiama Fatturazione e non «Abbonamento».
        const aggiornato = await verificaCreditiBatch(batchId);
        setError(
          aggiornato.ok && !aggiornato.verifica.ok
            ? `${aggiornato.verifica.frase} Li trovi nella pagina Fatturazione.`
            : 'I crediti non bastano più: qualcuno ne ha usati mentre stavi per avviare. Controlla il saldo nella pagina Fatturazione.',
        );
        setDirittiBatch(aggiornato);
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
  //
  // Con un'eccezione: il passo che mostra il foglio caricato. Lì non si compila
  // niente, si GUARDA — è il momento in cui si verifica che il file sia stato
  // letto giusto, e mostrarlo in 768 px vuol dire mostrarne tre colonne su
  // dodici e chiedere di fidarsi del resto. Le colonne di un listino non si
  // accorciano perché la finestra è stretta.
  return (
    <div
      className={cn(mostra(5) ? 'max-w-none' : 'max-w-3xl', 'space-y-6')}
      // Lo stesso segnale che usa `PageShell`: il guscio dell'app lo legge con
      // `:has()` e allarga sé stesso e l'intestazione. Il wizard non è dentro
      // un `PageShell` che possa chiederlo per lui, quindi lo chiede da sé.
      data-larghezza={mostra(5) ? 'piena' : undefined}
    >
      {/* La barra di avanzamento non cambia più larghezza fra un passo e
          l'altro.
          Il pulsante «Guida» c'è solo su alcuni passi, e stava ACCANTO alla
          barra: dove c'era, la barra misurava 669 px; dove non c'era, 768.
          Novantanove pixel di differenza su uno strumento che serve a misurare
          l'avanzamento — la parte colorata si allungava e si accorciava per una
          ragione che con l'avanzamento non c'entra niente.
          Ora il pulsante sta nella riga di intestazione della barra, insieme al
          nome del passo: quella riga è testo, e può cambiare quanto vuole. */}
      <ProgressBar
        steps={STADI.map((s: Stadio) => ({ id: s, title: TITOLI[s] }))}
        activeIndex={indiceStadio(stadio)}
        // Gli stadi sono cinque SEMPRE: non c'è più un totale da scoprire
        // strada facendo. Era il difetto che il conto dei passi si portava
        // dietro — la barra cambiava lunghezza mentre la si guardava.
        totaleNoto
        azione={
          fumetti.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTourOpen(true)}
              aria-label="Rivedi la guida di questo passo"
              className="-my-1 shrink-0 text-ink-500"
            >
              <HelpCircle className="h-4 w-4" />
              Guida
            </Button>
          ) : null
        }
      />

      {/* Il titolo dello stadio. «Mappa» da solo non vuol dire niente a chi
          apre il wizard la prima volta, e questa riga si legge PRIMA di sapere
          cosa conterrà. Prima al suo posto c'era il nome del passo, undici
          volte, dentro la riga della barra: minuscolo e accanto a un conto. */}
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{TITOLI[stadio]}</h1>
        <p className="mt-0.5 text-sm text-ink-500">{SOTTOTITOLI[stadio]}</p>
      </div>

      {error && (
        <div ref={rifErrore}>
          <Avviso tono="errore">{error}</Avviso>
        </div>
      )}

      {mostra(1) && (
        <Sezione titolo="Il lavoro" attivo={passoInCorso === 1}>
          <Step1
            onInvio={submitStep1}
            pronto={name.trim() !== '' && !!selectedPresetId && (presets?.length ?? 0) > 0 && !busy}
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            presets={presets}
            selectedPresetId={selectedPresetId}
            setSelectedPresetId={setSelectedPresetId}
          />
        </Sezione>
      )}

      {mostra(2) && (
        <Sezione titolo="Cosa prevede il preset" attivo={passoInCorso === 2}>
          <Step2
            explorer={explorer}
            expandedCat={expandedCat}
            setExpandedCat={setExpandedCat}
            expandedAttr={expandedAttr}
            setExpandedAttr={setExpandedAttr}
          />
        </Sezione>
      )}

      {/* Le conferme d'identità prendono la schermata: non sono un pezzo
          dello stadio, sono una domanda che sospende tutto il resto. */}
      {mostra(3) && confermeAperte && batchId && (
        <ConfermaIdentita
          batchId={batchId}
          onFinito={() => {
            setConfermeAperte(false);
            void aggiornaEsitoLista();
            goTo('ripara');
          }}
        />
      )}

      {mostra(3) && !confermeAperte && confermeInSospeso > 0 && (
        <ConfermeInSospeso quanti={confermeInSospeso} onRiprendi={() => setConfermeAperte(true)} />
      )}

      {mostra(3) && !confermeAperte && coda && coda.totale > 0 && (codaInCorso || !coda.finita) && (
        <LavorazioneListaSku
          coda={coda}
          inCorso={codaInCorso}
          onRiprendi={() => void giraLaCoda(coda)}
        />
      )}

      {mostra(3) && !confermeAperte && (
        <Sezione titolo="Da dove arrivano i dati" attivo={passoInCorso === 3}>
          <Step3
            sourceMode={sourceMode}
            setSourceMode={setSourceMode}
            urlText={urlText}
            setUrlText={setUrlText}
            pdfFiles={pdfFiles}
            setPdfFiles={setPdfFiles}
            skuText={skuText}
            setSkuText={setSkuText}
            skuDomini={skuDomini}
            setSkuDomini={setSkuDomini}
            skuRaggruppa={skuRaggruppa}
            setSkuRaggruppa={setSkuRaggruppa}
            skuAnteprima={skuAnteprima}
            skuFoglio={skuFoglio}
            skuMappatura={skuMappatura}
            setSkuMappatura={(m) => {
              setSkuMappatura(m);
              void anteprimaSku(m);
            }}
            onCaricaFoglioSku={caricaFoglioSku}
            onAnteprimaSku={() => void anteprimaSku()}
            busy={busy}
          />
        </Sezione>
      )}

      {mostra(4) && batchId && (
        <Sezione titolo="Come preparare i file" attivo={passoInCorso === 4}>
          <Step4
            batchId={batchId}
            hasSpreadsheet={hasSpreadsheet}
            hasImages={hasImages}
            imageNamingGuide={imageNamingGuide}
          />
        </Sezione>
      )}

      {mostra(5) && (
        <Sezione titolo="I file" attivo={passoInCorso === 5}>
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
        </Sezione>
      )}

      {mostra(6) && (
        <Sezione titolo="Cosa è arrivato" attivo={passoInCorso === 6}>
          <Step6 analysis={analysis} hasImages={hasImages} hasSpreadsheet={hasSpreadsheet} />
        </Sezione>
      )}

      {mostra(7) && (
        <Sezione titolo="Le colonne che identificano il prodotto" attivo={passoInCorso === 7}>
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
        </Sezione>
      )}

      {mostra(8) && (
        <Sezione titolo="Le colonne e gli attributi" attivo={passoInCorso === 8}>
          <Step8
            attributes={attributes}
            headers={headers}
            mapping={mapping}
            setMapping={setMapping}
            skuHeader={skuHeader}
            nameHeader={nameHeader}
            categoryHeader={categoryHeader}
            extraCols={extraCols}
            setExtraCols={setExtraCols}
          />
        </Sezione>
      )}

      {/* Che fine hanno fatto i codici, al passo 9.

          Prima non c'era: chi incollava dieci codici e ne vedeva sei arrivava
          qui e non trovava una riga sui quattro mancanti. I motivi erano nel
          registro — «il motore non ha proposto nessuna pagina», «una pagina
          trovata ma non raggiungibile» — e non li leggeva nessuno. Un import
          che perde per strada il 40% senza dirlo è peggio di uno che fallisce:
          quello almeno si nota. */}
      {mostra(9) && coda && coda.totale > 0 && <EsitoListaSku coda={coda} />}

      {mostra(9) && batchId && (
        <Step9
          products={products}
          importSummary={importSummary}
          batchId={batchId}
          hasImages={hasImages}
          analyzing={analyzingImages}
          analyzeProgress={analyzeProgress}
          categoryFromFile={hasSpreadsheet && Boolean(categoryHeader)}
        />
      )}

      {mostra(10) && (
        <Sezione titolo="La prova su un prodotto" attivo={passoInCorso === 10}>
          <Step10
            sampleDone={sampleDone}
            busy={busy}
            onRun={runSample}
            completeness={sampleCompleteness}
            content={sampleContent}
          />
        </Sezione>
      )}

      {mostra(11) && (
        <Sezione titolo="Prima di partire" attivo={passoInCorso === 11}>
          <Step11
            importSummary={importSummary}
            diritti={dirittiBatch}
            notifyByEmail={notifyByEmail}
            setNotifyByEmail={setNotifyByEmail}
          />
        </Sezione>
      )}

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
          <Button
            variant="ghost"
            onClick={prevStep}
            disabled={busy}
            nonDisponibile={stadioPrecedente(stadio) === null ? 'Sei al primo stadio.' : ''}
          >
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
          passo={passoInCorso}
          // Il passo che carica blocca «Continua»: senza, si attraversavano
          // mappatura e verifica senza vederle.
          busy={
            busy || analyzingImages || (passoInCaricamento !== null && mostra(passoInCaricamento))
          }
          step3Label={
            sourceMode === 'url'
              ? 'Importa da URL'
              : sourceMode === 'pdf'
                ? 'Importa i PDF'
                : sourceMode === 'sku'
                  ? 'Cerca e importa'
                  : 'Continua'
          }
          step3BusyLabel={
            sourceMode === 'url'
              ? 'Importo…'
              : sourceMode === 'pdf'
                ? 'Leggo i PDF…'
                : sourceMode === 'sku'
                  ? 'Cerco…'
                  : 'Un momento…'
          }
          // Prima qui passavano dei BOOLEANI: il motivo per cui non si può
          // andare avanti esisteva — è scritto in queste stesse righe — e
          // veniva buttato via al confine. Dall'altra parte restava un pulsante
          // grigio, cioè la cosa che l'audit chiama «spento senza dirlo».
          motivi={{
            1: motivoMancante([
              { manca: name.trim() === '', cosa: 'il nome del lavoro' },
              { manca: !selectedPresetId, cosa: 'un preset' },
              {
                manca: (presets?.length ?? 0) === 0,
                cosa: 'almeno un preset pubblicato nelle impostazioni',
              },
            ]),
            3: motivoMancante([
              { manca: !sourceMode, cosa: 'da dove arrivano i dati' },
              {
                manca: sourceMode === 'url' && urlText.trim().length === 0,
                cosa: 'almeno un indirizzo',
              },
              { manca: sourceMode === 'pdf' && pdfFiles.length === 0, cosa: 'almeno un PDF' },
              {
                manca:
                  sourceMode === 'sku' &&
                  skuText.trim().length === 0 &&
                  !(skuFoglio && skuMappatura?.sku),
                cosa: 'almeno un codice',
              },
            ]),
            5: motivoMancante([
              { manca: hasSpreadsheet && !spreadsheetResult, cosa: 'la lettura del foglio' },
              { manca: hasImages && !imagesResult, cosa: 'la lettura delle immagini' },
            ]),
            10: motivoMancante([{ manca: !sampleDone, cosa: 'la prova su un prodotto' }]),
          }}
          onSources={submitSources}
          onSample={runSample}
          onStart={startGeneration}
          // Il pulsante resta spento finché la risposta non arriva, e se dice
          // di no. La ragione è scritta sopra, nel riquadro: un pulsante grigio
          // senza spiegazione è la cosa che si voleva togliere.
          avvioBloccato={dirittiBatch != null && (!dirittiBatch.ok || !dirittiBatch.verifica.ok)}
          onNext={nextStep}
        />
      </div>

      {/* Onboarding: fumettini del passo corrente + chat-guida sempre a portata. */}
      {tourOpen && fumetti.length > 0 && (
        <GuidedTour
          steps={fumetti}
          onClose={() => {
            markTourSeen(`wizard.${stadio}.v1`);
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

// ---------------------------------------------------------------------------
// Azione primaria per passo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 1 — Informazioni batch.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 2 — Esploratore preset (sola lettura).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 3 — Fonti.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 4 — Istruzioni e template.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 5 — Caricamento.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 6 — Analisi file.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 7 — Associazione SKU.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 8 — Mapping attributi.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 9 — Verifica dati.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 10 — Campione.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 11 — Conferma e avvio.
// ---------------------------------------------------------------------------
