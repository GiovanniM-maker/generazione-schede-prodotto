'use client';

import { useEffect, useRef, useState } from 'react';
import { LifeBuoy, X, RotateCcw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Guida-chat del wizard: un albero di domande/risposte DETERMINISTICO (zero
// chiamate AI, risposta istantanea) che prende per mano chi non sa da dove
// partire. Ogni nodo spiega e propone i passi successivi.
// ---------------------------------------------------------------------------

interface GuideNode {
  text: string;
  options?: Array<{ label: string; next: string }>;
}

const NODES: Record<string, GuideNode> = {
  start: {
    text: 'Ciao! Ti guido io, passo per passo. Cosa hai in mano per creare le schede prodotto?',
    options: [
      { label: '📷 Solo foto dei prodotti', next: 'photos' },
      { label: '📊 Solo un Excel/CSV', next: 'excel' },
      { label: '📷+📊 Foto ed Excel insieme', next: 'both' },
      { label: '🤷 Non so da dove partire', next: 'lost' },
    ],
  },
  lost: {
    text:
      'Nessun problema. Il flusso è: 1) scegli un preset (il "modello" della scheda: categorie e attributi), 2) carichi foto e/o Excel, 3) l’AI legge i dati, 4) generi un campione gratuito per vedere il risultato, 5) avvii la generazione di tutto. Da cosa vuoi partire?',
    options: [
      { label: 'Ho delle foto', next: 'photos' },
      { label: 'Ho un Excel', next: 'excel' },
      { label: 'Cos’è un preset?', next: 'preset' },
    ],
  },
  preset: {
    text:
      'Il preset è il modello della scheda: dice quali categorie esistono (es. Vino, Ortofrutta…) e quali dati servono per ciascuna (peso, ingredienti, gradazione…). Lo trovi in Configurazione → Preset: puoi costruirlo a chat con il Copilot («Crea 5 categorie di pasta con 3 attributi») o importare liste. Nel wizard lo scegli al passo 1.',
    options: [
      { label: 'Ok, e poi?', next: 'lost' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  photos: {
    text:
      'Perfetto: bastano le foto. Due cose importanti. 1) Il NOME del file deve contenere il codice prodotto (SKU): es. «1234-fronte.jpg» → SKU 1234. Dopo il caricamento scegli il separatore giusto (-, _, punto o spazio). 2) Più foto con lo stesso SKU finiscono sullo stesso prodotto (fronte, retro, etichetta…). Al passo Fonti scegli «Immagini».',
    options: [
      { label: 'E la categoria come funziona?', next: 'category' },
      { label: 'L’AI cosa legge dalle foto?', next: 'ocr' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  excel: {
    text:
      'Bene. Serve una colonna con lo SKU (codice prodotto): la scegli tu al passo «Associazione SKU». Poi mappi le colonne sugli attributi del preset e — importante — puoi importare ANCHE le colonne extra del file (es. «descrizione materiale», «prezzo») dalla sezione «Altre colonne del file»: ogni dato in più arricchisce la scheda. Al passo Fonti scegli «Spreadsheet».',
    options: [
      { label: 'E la categoria?', next: 'category' },
      { label: 'Posso aggiungere anche le foto?', next: 'both' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  both: {
    text:
      'La combinazione migliore: l’Excel porta i dati certi, le foto aggiungono ciò che è stampato sul pack. L’aggancio avviene via SKU: la colonna SKU dell’Excel deve corrispondere allo SKU nel nome delle foto (es. riga «1234» ↔ file «1234-fronte.jpg»). Al passo Fonti scegli «Entrambe».',
    options: [
      { label: 'E la categoria?', next: 'category' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  category: {
    text:
      'La categoria decide QUALI dati l’AI cerca e usa per ogni prodotto (a un vino non chiede gli attributi della carne). Hai 3 modi: 1) MAPPATA dall’Excel — scegli la «Colonna Categoria» al passo Associazione SKU (consigliata, zero AI); 2) DEDOTTA — senza colonna, l’AI la riconosce dalle foto scegliendo tra le categorie del preset; 3) A MANO — al passo «Verifica dati» apri «Assegna le categorie a mano» e le imposti per SKU, anche in blocco.',
    options: [
      { label: 'L’AI cosa legge dalle foto?', next: 'ocr' },
      { label: 'Quanto costa generare?', next: 'credits' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  ocr: {
    text:
      'L’AI legge il testo stampato sulle etichette (denominazione, peso, ingredienti, valori nutrizionali, marchio…) e lo trasforma in dati verificati. Non inventa: se un dato non è leggibile resta vuoto, e un controllo automatico blocca qualsiasi affermazione non supportata dai dati. I claim di puro marketing non diventano mai «fatti».',
    options: [
      { label: 'Come vedo cosa ha letto?', next: 'review' },
      { label: 'Quanto costa generare?', next: 'credits' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  credits: {
    text:
      'Il CAMPIONE è gratuito: al passo «Campione» generi la scheda di un prodotto di prova e la vedi subito, così controlli tono e qualità prima di spendere. La generazione vera costa 1 credito per prodotto idoneo (lo vedi al passo «Conferma e avvio» prima di partire). Se una scheda non ti piace puoi rigenerarla o correggerla a mano.',
    options: [
      { label: 'E dopo la generazione?', next: 'review' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  review: {
    text:
      'Nella pagina Risultati trovi tutte le schede: titolo, descrizioni, punti elenco, meta SEO, FAQ e alt text. Con la matita apri il dettaglio: vedi ANCHE gli attributi estratti (con fonte: foto o excel, e affidabilità) e puoi correggere i testi — le tue correzioni insegnano all’AI a scrivere meglio. Quando sei soddisfatto esporti in CSV/XLSX o direttamente nel formato Shopify, WooCommerce o PrestaShop.',
    options: [
      { label: 'Torna all’inizio', next: 'start' },
      { label: 'Ho capito, grazie', next: 'end' },
    ],
  },
  end: {
    text:
      'Ottimo! Procedi pure con i passi del wizard: ogni passo ha la sua mini-guida (pulsante «Guida» in alto). Se ti blocchi, riapri questa chat dal salvagente in basso a destra. Buon lavoro! 🚀',
    options: [{ label: 'Ricomincia da capo', next: 'start' }],
  },
};

interface Msg {
  role: 'guide' | 'user';
  text: string;
}

export function WizardGuide({ autoOpen }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [nodeId, setNodeId] = useState('start');
  const [history, setHistory] = useState<Msg[]>([{ role: 'guide', text: NODES.start!.text }]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-apertura alla prima visita (persistita).
  useEffect(() => {
    if (!autoOpen) return;
    try {
      if (localStorage.getItem('guide.wizard.opened') !== '1') {
        setOpen(true);
        localStorage.setItem('guide.wizard.opened', '1');
      }
    } catch {
      /* storage non disponibile: non aprire in automatico */
    }
  }, [autoOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, open]);

  const node = NODES[nodeId] ?? NODES.start!;

  function choose(opt: { label: string; next: string }) {
    const nextNode = NODES[opt.next];
    if (!nextNode) return;
    setHistory((h) => [
      ...h,
      { role: 'user', text: opt.label },
      { role: 'guide', text: nextNode.text },
    ]);
    setNodeId(opt.next);
  }

  function restart() {
    setNodeId('start');
    setHistory([{ role: 'guide', text: NODES.start!.text }]);
  }

  return (
    <>
      {/* Pulsante flottante */}
      {!open && (
        <button
          type="button"
          data-tour="wizard-guide"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-full bg-brand-accent px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2"
          aria-label="Apri la guida"
        >
          <LifeBuoy className="h-4 w-4" />
          Serve aiuto?
        </button>
      )}

      {/* Pannello chat */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-[60] flex max-h-[min(560px,80vh)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
          role="dialog"
          aria-label="Guida del wizard"
        >
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <LifeBuoy className="h-4 w-4 text-brand-accent" />
              <p className="text-sm font-semibold text-gray-900">Guida passo-passo</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={restart}
                aria-label="Ricomincia la guida"
                className="rounded p-1 text-gray-400 hover:text-gray-700"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Chiudi la guida"
                className="rounded p-1 text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
            {history.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-brand-accent px-3 py-1.5 text-sm text-white'
                      : 'max-w-[90%] rounded-2xl rounded-bl-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-800'
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          {/* Opzioni del nodo corrente */}
          {node.options && node.options.length > 0 && (
            <div className="border-t border-gray-100 p-3">
              <div className="flex flex-wrap gap-1.5">
                {node.options.map((opt) => (
                  <button
                    key={opt.next + opt.label}
                    type="button"
                    onClick={() => choose(opt)}
                    className="rounded-full border border-brand-accent/40 bg-white px-3 py-1.5 text-xs font-medium text-brand-accent transition hover:bg-brand-accent hover:text-white"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
