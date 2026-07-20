'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Loader2,
  Check,
  Send,
  FolderTree,
  Tags,
  Copy,
  Square,
  Mic,
  MicOff,
} from 'lucide-react';
import {
  planPresetAction,
  applyPresetPlanAction,
  type PresetPlanResult,
} from '@/lib/actions/preset-copilot';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

const TYPE_LABEL: Record<string, string> = {
  text: 'testo',
  long_text: 'testo lungo',
  boolean: 'sì/no',
  integer: 'intero',
  decimal: 'decimale',
  date: 'data',
  enum: 'elenco',
  multi_enum: 'multi-elenco',
  measurement: 'misura',
  percentage: '%',
  currency: 'valuta',
};

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

// Tipo minimale per la Web Speech API (non presente nei lib TS di default).
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    SpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function PresetCopilotPanel({
  presetId,
  onClose,
}: {
  presetId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [plan, setPlan] = useState<PresetPlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);

  const runId = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVoiceSupported(getSpeechCtor() !== null);
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  // Auto-scroll in fondo quando arrivano messaggi.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history.length, busy, plan]);

  const nothingNew = plan ? plan.newCategories === 0 && plan.newAttributes === 0 : false;

  function send() {
    const request = input.trim();
    if (!request || busy) return;
    setError(null);
    setApplied(null);
    const myId = ++runId.current;
    const nextHistory: ChatMsg[] = [...history, { role: 'user', content: request }];
    setHistory(nextHistory);
    setInput('');
    setBusy(true);
    planPresetAction({ presetId, request, history })
      .then((res) => {
        if (myId !== runId.current) return; // richiesta annullata con "Stop"
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setHistory([...nextHistory, { role: 'assistant', content: res.data.assistantMessage }]);
        setPlan(res.data);
      })
      .catch(() => {
        if (myId !== runId.current) return;
        setBusy(false);
        setError('Errore di rete. Riprova.');
      });
  }

  function stop() {
    runId.current++; // invalida la risposta ancora in arrivo
    setBusy(false);
  }

  function apply() {
    if (!plan || applying) return;
    setError(null);
    setApplying(true);
    applyPresetPlanAction({ presetId, categories: plan.categories })
      .then((res) => {
        setApplying(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setApplied(
          `Fatto: ${res.data.categoriesAdded} categorie e ${res.data.attributesAdded} attributi aggiunti al preset.`,
        );
        setPlan(null);
        router.refresh();
      })
      .catch(() => {
        setApplying(false);
        setError('Errore durante la creazione. Riprova.');
      });
  }

  async function copyMsg(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard non disponibile */
    }
  }

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'it-IT';
    rec.interimResults = true;
    rec.continuous = false;
    voiceBaseRef.current = input ? input.trimEnd() + ' ' : '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r) text += r[0].transcript;
      }
      setInput(voiceBaseRef.current + text);
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Intro */}
      <div className="flex items-start gap-2 border-b border-gray-100 px-1 pb-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" />
        <p className="text-sm text-gray-600">
          Descrivi il preset che vuoi, oppure incolla un elenco di categorie e attributi. Preparo un
          piano (categorie, attributi e tipi) da confermare — <strong>ciò che è già nel preset non
          te lo richiedo di nuovo</strong>.
        </p>
      </div>

      {/* Conversazione (scorre) */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
        {history.length === 0 && !busy && (
          <div className="mt-6 space-y-2 text-center text-sm text-gray-400">
            <p>Esempi:</p>
            <p className="italic">«Crea 5 categorie di pasta con 3 attributi ciascuna»</p>
            <p className="italic">
              «Aggiungi la categoria Uova con peso, metodo allevamento (elenco) e biologico sì/no»
            </p>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={m.role === 'user' ? 'max-w-[85%]' : 'group max-w-[85%]'}>
              <div
                className={
                  m.role === 'user'
                    ? 'rounded-2xl rounded-br-sm bg-brand-accent px-3.5 py-2 text-sm text-white'
                    : 'rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800'
                }
              >
                {m.content}
              </div>
              {m.role === 'assistant' && (
                <button
                  type="button"
                  onClick={() => copyMsg(m.content, i)}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 opacity-0 transition hover:text-gray-700 group-hover:opacity-100"
                >
                  {copiedIdx === i ? (
                    <>
                      <Check className="h-3 w-3" /> copiato
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> copia
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Sto progettando il preset…
          </div>
        )}
      </div>

      {/* Anteprima del piano */}
      {plan && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 text-sm">
            <span className="font-semibold text-gray-900">Piano proposto</span>
            <span className="text-gray-500">
              {nothingNew ? (
                'tutto già presente'
              ) : (
                <span className="font-medium text-emerald-700">
                  +{plan.newCategories} categorie · +{plan.newAttributes} attributi
                </span>
              )}
            </span>
          </div>
          <div className="max-h-[38vh] space-y-3 overflow-y-auto p-4">
            {plan.categories.map((c, i) => (
              <div key={i}>
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  <FolderTree className="h-4 w-4 text-brand-accent" />
                  {c.name}
                  {c.existing ? (
                    <Badge tone="gray">già presente</Badge>
                  ) : (
                    <Badge tone="green">nuova</Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 pl-5">
                  {c.attributes.map((a, j) => (
                    <span
                      key={j}
                      className={
                        a.existing
                          ? 'inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-400'
                          : 'inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-gray-700'
                      }
                      title={a.existing ? 'già presente' : 'nuovo'}
                    >
                      {a.existing ? (
                        <Check className="h-3 w-3 text-gray-400" />
                      ) : (
                        <Tags className="h-3 w-3 text-emerald-500" />
                      )}
                      {a.name}
                      <Badge tone="gray">{TYPE_LABEL[a.dataType] ?? a.dataType}</Badge>
                    </span>
                  ))}
                  {c.attributes.length === 0 && (
                    <span className="text-xs text-gray-400">nessun attributo</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
            <span className="text-xs text-gray-400">
              {nothingNew
                ? 'Niente da aggiungere: è già tutto nel preset.'
                : 'Verranno aggiunti solo gli elementi in verde.'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPlan(null)} disabled={applying}>
                Scarta
              </Button>
              <Button size="sm" onClick={apply} disabled={applying || nothingNew}>
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {nothingNew
                  ? 'Niente da aggiungere'
                  : `Aggiungi ${plan.newCategories + plan.newAttributes} nuovi`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {applied && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {applied}{' '}
          <button className="underline" onClick={onClose}>
            Chiudi
          </button>
        </div>
      )}

      {/* Input pinnato in basso */}
      <div className="border-t border-gray-100 pt-3">
        <div className="flex items-end gap-2">
          {voiceSupported && (
            <Button
              variant={listening ? 'primary' : 'outline'}
              size="md"
              onClick={toggleVoice}
              disabled={busy}
              aria-label={listening ? 'Ferma dettatura' : 'Detta con la voce'}
              title={listening ? 'Ferma dettatura' : 'Detta con la voce'}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={listening ? 'Parla pure, sto ascoltando…' : 'Scrivi o incolla qui…'}
            className="flex-1"
          />
          {busy ? (
            <Button variant="outline" size="md" onClick={stop} aria-label="Ferma">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button size="md" onClick={send} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
              Invia
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-xs text-gray-400">
          Invio per inviare · Shift+Invio per andare a capo
        </p>
      </div>
    </div>
  );
}
