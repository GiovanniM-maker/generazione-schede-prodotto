'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, Send, Sparkles, Check, Trash2, Square, X } from 'lucide-react';
import type { CopilotEntityType } from '@app/core';
import {
  startCopilotConversation,
  sendCopilotMessage,
  confirmDraft,
  discardDraft,
  type CopilotDraftView,
} from '@/lib/actions/copilot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Stato della registrazione audio (Fase 6). Il testo trascritto è SEMPRE
// modificabile e non viene mai inviato in chat automaticamente.
type RecorderState =
  | 'idle'
  | 'recording'
  | 'recorded'
  | 'transcribing'
  | 'transcribed';

// Preferenza dei formati di registrazione. audio/webm è fallback: OpenRouter
// non lo elenca tra i formati audio, quindi si preferiscono mp4/ogg.
const RECORDER_MIME_CANDIDATES = ['audio/mp4', 'audio/ogg', 'audio/webm'];

function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function mimeToFilename(mime: string): string {
  const base = mime.split(';')[0]?.trim();
  const ext =
    base === 'audio/mp4'
      ? 'm4a'
      : base === 'audio/ogg'
        ? 'ogg'
        : base === 'audio/webm'
          ? 'webm'
          : 'webm';
  return `registrazione.${ext}`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const ENTITY_LABEL: Record<CopilotEntityType, string> = {
  attribute: 'attributo',
  category: 'categoria',
};

export function CopilotPanel({
  entityType,
  sectorId,
  entityId,
  onClose,
}: {
  entityType: CopilotEntityType;
  sectorId?: string;
  /** Se presente, il copilot MODIFICA l'entità esistente. */
  entityId?: string;
  onClose?: () => void;
}) {
  const isEdit = Boolean(entityId);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<CopilotDraftView | null>(null);
  const [confirmationSummary, setConfirmationSummary] = useState<string>('');
  const [missingInformation, setMissingInformation] = useState<string[]>([]);
  const [input, setInput] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Registrazione audio (Fase 6) ---
  const [audioSupported, setAudioSupported] = useState(false);
  const [recState, setRecState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [audioError, setAudioError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>('');
  const cancelledRef = useRef<boolean>(false);
  const audioBlobRef = useRef<Blob | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const label = ENTITY_LABEL[entityType];

  // Rileva il supporto a MediaRecorder/getUserMedia una sola volta.
  useEffect(() => {
    const ok =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined' &&
      pickRecorderMime() !== '';
    setAudioSupported(ok);
  }, []);

  // Cleanup allo smontaggio: ferma lo stream, il timer e revoca l'URL.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function setPreviewUrl(url: string | null) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url;
    setAudioUrl(url);
  }

  function resetRecorder() {
    clearTimer();
    stopStream();
    chunksRef.current = [];
    audioBlobRef.current = null;
    setPreviewUrl(null);
    setElapsed(0);
    setTranscript('');
    setRecState('idle');
  }

  async function startRecording() {
    setAudioError(null);
    const mime = pickRecorderMime();
    if (!mime) {
      setAudioError('Registrazione non supportata da questo browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelledRef.current = false;
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        clearTimer();
        stopStream();
        if (cancelledRef.current) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        if (blob.size === 0) {
          setAudioError('Registrazione vuota, riprova.');
          setRecState('idle');
          return;
        }
        audioBlobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        setRecState('recorded');
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setElapsed(0);
      setRecState('recording');
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      stopStream();
      setAudioError('Permesso microfono negato o microfono non disponibile.');
      setRecState('idle');
    }
  }

  function stopRecording() {
    cancelledRef.current = false;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }

  function cancelRecording() {
    cancelledRef.current = true;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    resetRecorder();
  }

  async function handleTranscribe() {
    const blob = audioBlobRef.current;
    if (!blob) return;
    setAudioError(null);
    setRecState('transcribing');
    try {
      const fd = new FormData();
      fd.append('audio', blob, mimeToFilename(mimeRef.current || blob.type));
      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: fd });
      const data: { text?: string; error?: string } = await res.json();
      if (!res.ok) {
        setAudioError(data.error ?? 'Errore di trascrizione.');
        setRecState('recorded');
        return;
      }
      setTranscript(typeof data.text === 'string' ? data.text : '');
      setRecState('transcribed');
    } catch {
      setAudioError('Errore di rete durante la trascrizione.');
      setRecState('recorded');
    }
  }

  // "Usa testo": copia il transcript nell'input della chat SENZA inviare.
  function handleUseTranscript() {
    const text = transcript.trim();
    if (text) {
      setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    }
    resetRecorder();
  }

  // Avvia la conversazione al montaggio.
  useEffect(() => {
    let active = true;
    (async () => {
      const res = await startCopilotConversation({ entityType, sectorId, entityId });
      if (!active) return;
      if (!res.ok) {
        setError(res.error);
        setStarting(false);
        return;
      }
      setConversationId(res.conversationId);
      setDraftId(res.draftId);
      setStarting(false);
    })();
    return () => {
      active = false;
    };
  }, [entityType, sectorId, entityId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || !conversationId) return;
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    startTransition(async () => {
      const res = await sendCopilotMessage({ conversationId, message: text });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.output.assistantMessage },
      ]);
      setDraft(res.draft);
      setConfirmationSummary(res.output.confirmationSummary);
      setMissingInformation(res.output.missingInformation);
    });
  }

  function handleConfirm() {
    if (!draftId) return;
    setError(null);
    startTransition(async () => {
      const res = await confirmDraft({ draftId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const path =
        entityType === 'attribute'
          ? `/app/settings/attributes/${res.entityId}`
          : `/app/settings/categories/${res.entityId}`;
      onClose?.();
      router.push(path);
    });
  }

  function handleDiscard() {
    if (!draftId) {
      onClose?.();
      return;
    }
    setError(null);
    startTransition(async () => {
      await discardDraft({ draftId });
      onClose?.();
    });
  }

  const canConfirm = draft?.status === 'ready_for_confirmation';
  const data = draft?.data;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      {/* Colonna chat */}
      <div className="flex min-h-[460px] flex-col">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-accent" />
          <h3 className="text-base font-semibold text-gray-900">
            Copilot — {isEdit ? `modifica ${label}` : `nuova ${label}`}
          </h3>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4"
        >
          {starting ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Avvio del copilot…
            </div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-gray-500">
              {isEdit ? (
                <>
                  Descrivi come vuoi modificare questa {label}. Per esempio: «
                  {entityType === 'attribute'
                    ? 'Rinominala in Composizione e rendila un elenco'
                    : 'Scrivi come si riconosce dalle foto: tavoletta scura, cacao 70%+'}
                  ». Preparerò una bozza da confermare.
                </>
              ) : (
                <>
                  Descrivi la {label} che vuoi creare. Per esempio: «
                  {entityType === 'attribute'
                    ? 'Aggiungi un attributo Materiale per le magliette'
                    : 'Crea la categoria Cioccolato fondente e spiega come si riconosce dalle foto'}
                  ». Preparerò una bozza da confermare.
                </>
              )}
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user' ? 'flex justify-end' : 'flex justify-start'
                }
              >
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-lg bg-brand-accent px-3 py-2 text-sm text-white'
                      : 'max-w-[85%] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800'
                  }
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {pending && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Il copilot sta pensando…
            </div>
          )}
        </div>

        {audioError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {audioError}
          </div>
        )}

        {/* Pannello registrazione audio (Fase 6) */}
        {recState === 'recording' && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-medium text-red-700">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
              Registrazione… {formatElapsed(elapsed)}
            </span>
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" onClick={stopRecording}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelRecording}>
                <X className="h-4 w-4" />
                Annulla
              </Button>
            </div>
          </div>
        )}

        {recState === 'recorded' && audioUrl && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <audio controls src={audioUrl} className="w-full" />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={handleTranscribe}>
                <Sparkles className="h-4 w-4" />
                Trascrivi
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={resetRecorder}>
                <X className="h-4 w-4" />
                Annulla
              </Button>
            </div>
          </div>
        )}

        {recState === 'transcribing' && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Trascrizione in corso…
          </div>
        )}

        {recState === 'transcribed' && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <label className="text-xs font-medium text-gray-600">
              Trascrizione (modificabile prima di usarla)
            </label>
            <Textarea
              rows={3}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Testo trascritto…"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleUseTranscript}
                disabled={!transcript.trim()}
              >
                <Check className="h-4 w-4" />
                Usa testo
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={resetRecorder}>
                <Trash2 className="h-4 w-4" />
                Scarta
              </Button>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-end gap-2">
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Scrivi al copilot…`}
            disabled={starting || pending}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={startRecording}
            disabled={
              !audioSupported ||
              starting ||
              pending ||
              recState === 'recording' ||
              recState === 'transcribing'
            }
            title={
              audioSupported
                ? 'Registra un messaggio vocale'
                : 'Registrazione audio non supportata da questo browser'
            }
            aria-label="Registra messaggio vocale"
          >
            <Mic className="h-4 w-4" />
            <span className="sr-only">Registra messaggio vocale</span>
          </Button>
          <Button
            type="button"
            size="md"
            onClick={handleSend}
            disabled={starting || pending || !input.trim()}
          >
            <Send className="h-4 w-4" />
            Invia
          </Button>
        </div>
        {!audioSupported && (
          <p className="mt-1 text-xs text-gray-400">
            Registrazione audio non disponibile su questo browser.
          </p>
        )}
      </div>

      {/* Colonna bozza */}
      <div className="flex flex-col gap-3">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">
              Bozza proposta
            </h4>
            {draft && (
              <Badge tone={canConfirm ? 'green' : 'gray'}>
                {canConfirm ? 'Pronta' : 'In lavorazione'}
              </Badge>
            )}
          </div>

          {!data ? (
            <p className="text-sm text-gray-500">
              La bozza comparirà qui dopo il primo messaggio.
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <DraftField label="Nome" value={data.name} />
              <DraftField label="Descrizione" value={data.description} />
              {entityType === 'category' && (
                <DraftField label="Come si riconosce" value={data.recognitionHint} />
              )}
              {entityType === 'attribute' && (
                <>
                  <DraftField label="Tipo" value={data.attributeKind} />
                  <DraftField label="Tipo di dato" value={data.dataType} />
                  <DraftField label="Unità" value={data.unit} />
                  <DraftField
                    label="Valori enum"
                    value={data.enumValues?.join(', ') ?? null}
                  />
                  <DraftField
                    label="Istruzione di estrazione"
                    value={data.extractionInstruction}
                  />
                  <DraftField
                    label="Istruzione di generazione"
                    value={data.generationInstruction}
                  />
                  <DraftField
                    label="Categorie"
                    value={data.categoryKeys?.join(', ') ?? null}
                  />
                  <DraftField
                    label="Obbligatorio"
                    value={
                      data.isRequired === null
                        ? null
                        : data.isRequired
                          ? 'Sì'
                          : 'No'
                    }
                  />
                </>
              )}
            </dl>
          )}

          {missingInformation.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-xs font-medium text-amber-800">
                Informazioni mancanti
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                {missingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {confirmationSummary && (
            <p className="mt-3 text-xs text-gray-600">{confirmationSummary}</p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={!canConfirm || pending}
              title={
                canConfirm
                  ? 'Crea e pubblica'
                  : 'Completa la bozza prima di confermare'
              }
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Conferma e crea
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={pending}
            >
              <Trash2 className="h-4 w-4" />
              Scarta
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function DraftField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className={value ? 'text-gray-900' : 'text-gray-300'}>
        {value || '—'}
      </dd>
    </div>
  );
}
