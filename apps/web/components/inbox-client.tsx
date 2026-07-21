'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Pencil, Loader2, Inbox as InboxIcon, MessageCircleQuestion } from 'lucide-react';
import { answerDoubtAction, type DoubtView } from '@/lib/actions/doubts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function InboxClient({ initial }: { initial: DoubtView[] }) {
  const router = useRouter();
  const [doubts, setDoubts] = useState<DoubtView[]>(initial);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function resolve(id: string, action: 'confirm' | 'correct' | 'dismiss', value?: string) {
    setError(null);
    startTransition(async () => {
      const res = await answerDoubtAction({ doubtId: id, action, value });
      if (!res.ok) {
        setError(res.error ?? 'Errore');
        return;
      }
      setDoubts((d) => d.filter((x) => x.id !== id));
      setEditingId(null);
      router.refresh();
    });
  }

  if (doubts.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-gray-500">
          <InboxIcon className="h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">Nessun dubbio in sospeso</p>
          <p className="text-sm">
            Quando l’AI legge un dato dalle foto senza esserne certa, te lo chiede qui.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {doubts.map((d) => (
        <Card key={d.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-2">
              <MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-gray-900">{d.productName ?? 'Prodotto'}</span>
                  {d.fieldLabel && <Badge tone="violet">{d.fieldLabel}</Badge>}
                  {d.confidence != null && (
                    <span className="text-xs text-amber-600">{Math.round(d.confidence * 100)}% sicuro</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-700">{d.question}</p>
              </div>
            </div>

            {editingId === d.id ? (
              <div className="flex flex-wrap items-center gap-2 pl-7">
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Valore corretto"
                  className="max-w-xs"
                  autoFocus
                />
                <Button size="sm" disabled={pending || !editValue.trim()} onClick={() => resolve(d.id, 'correct', editValue.trim())}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Salva correzione
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={pending}>
                  Annulla
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pl-7">
                <Button size="sm" disabled={pending} onClick={() => resolve(d.id, 'confirm')}>
                  <Check className="h-4 w-4 text-emerald-100" />
                  Sì, è corretto{d.suggestedValue ? ` («${d.suggestedValue}»)` : ''}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setEditingId(d.id);
                    setEditValue(d.suggestedValue ?? '');
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Correggi
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => resolve(d.id, 'dismiss')}>
                  <X className="h-4 w-4 text-gray-400" />
                  Ignora
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
