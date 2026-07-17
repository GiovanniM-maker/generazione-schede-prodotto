'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, Send, Sparkles, Check, Trash2 } from 'lucide-react';
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

const ENTITY_LABEL: Record<CopilotEntityType, string> = {
  attribute: 'attributo',
  category: 'categoria',
};

export function CopilotPanel({
  entityType,
  sectorId,
  onClose,
}: {
  entityType: CopilotEntityType;
  sectorId?: string;
  onClose?: () => void;
}) {
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

  const label = ENTITY_LABEL[entityType];

  // Avvia la conversazione al montaggio.
  useEffect(() => {
    let active = true;
    (async () => {
      const res = await startCopilotConversation({ entityType, sectorId });
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
  }, [entityType, sectorId]);

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
            Copilot — nuova {label}
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
              Descrivi la {label} che vuoi creare. Per esempio: «
              {entityType === 'attribute'
                ? 'Aggiungi un attributo Materiale per le magliette'
                : 'Crea una categoria Magliette'}
              ». Preparerò una bozza da confermare.
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
            disabled
            title="Audio in arrivo"
            aria-label="Registra (audio in arrivo)"
          >
            <Mic className="h-4 w-4" />
            <span className="sr-only">Audio in arrivo</span>
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
        <p className="mt-1 text-xs text-gray-400">
          Registrazione audio non ancora disponibile: «Audio in arrivo».
        </p>
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
