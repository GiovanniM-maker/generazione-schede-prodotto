'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Check, Send, FolderTree, Tags } from 'lucide-react';
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

export function PresetCopilotPanel({
  presetId,
  onClose,
}: {
  presetId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [plan, setPlan] = useState<PresetPlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const totalAttrs = plan
    ? plan.categories.reduce((n, c) => n + c.attributes.length, 0)
    : 0;

  function send() {
    const request = input.trim();
    if (!request) return;
    setError(null);
    setApplied(null);
    const nextHistory: ChatMsg[] = [...history, { role: 'user', content: request }];
    setHistory(nextHistory);
    setInput('');
    startTransition(async () => {
      const res = await planPresetAction({ presetId, request, history });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setHistory([...nextHistory, { role: 'assistant', content: res.data.assistantMessage }]);
      setPlan(res.data);
    });
  }

  function apply() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await applyPresetPlanAction({ presetId, categories: plan.categories });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setApplied(
        `Create/aggiunte ${res.data.categoriesAdded} categorie e ${res.data.attributesAdded} attributi al preset.`,
      );
      setPlan(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand-accent" />
        <p className="text-sm text-gray-600">
          Descrivi il preset che vuoi. Es: «Crea 5 categorie di pasta con 3 attributi ciascuna».
          Preparo tutto (categorie, attributi e tipi) da confermare — una sola chiamata AI.
        </p>
      </div>

      {history.length > 0 && (
        <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
          {history.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] rounded-lg bg-brand-accent px-3 py-1.5 text-sm text-white'
                    : 'max-w-[85%] rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800'
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {pending && !plan && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sto progettando il preset…
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {applied && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {applied} <button className="underline" onClick={onClose}>Chiudi</button>
        </div>
      )}

      {/* Anteprima del piano */}
      {plan && (
        <div className="rounded-lg border border-gray-200">
          <div className="border-b border-gray-100 px-4 py-2.5 text-sm">
            <span className="font-semibold text-gray-900">Piano proposto</span>
            <span className="ml-2 text-gray-500">
              {plan.categories.length} categorie · {totalAttrs} attributi
            </span>
          </div>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto p-4">
            {plan.categories.map((c, i) => (
              <div key={i}>
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  <FolderTree className="h-4 w-4 text-brand-accent" />
                  {c.name}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 pl-5">
                  {c.attributes.map((a, j) => (
                    <span
                      key={j}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700"
                    >
                      <Tags className="h-3 w-3 text-gray-400" />
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
          <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => setPlan(null)} disabled={pending}>
              Scarta
            </Button>
            <Button size="sm" onClick={apply} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Crea nel preset
            </Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2">
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
          placeholder="Es: crea 5 categorie di pasta con 3 attributi ciascuna…"
          disabled={pending}
          className="flex-1"
        />
        <Button size="md" onClick={send} disabled={pending || !input.trim()}>
          <Send className="h-4 w-4" />
          Invia
        </Button>
      </div>
    </div>
  );
}
