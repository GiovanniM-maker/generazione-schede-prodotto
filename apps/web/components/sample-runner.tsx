'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  Check,
  RefreshCw,
  PencilLine,
} from 'lucide-react';
import { createToneProfileAction } from '@/lib/actions/tone';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  COMPLETENESS_LABELS,
  COMPLETENESS_TONES,
  normalizeCompleteness,
  type Completeness,
} from '@/lib/completeness';

const STYLES = [
  'Essenziale e diretto',
  'Elegante e ricercato',
  'Commerciale e coinvolgente',
];

const MAX_REGEN = 5;

interface SampleFact {
  fieldKey: string;
  value: string;
  status: string;
}
interface SampleContent {
  title: string;
  shortDescription: string;
  longDescription: string;
  bullets: string[];
  metaDescription: string;
  usedFactKeys: string[];
  warnings: string[];
}
interface SampleAudit {
  severity: 'none' | 'low' | 'medium' | 'high';
  unsupportedClaims: string[];
}
interface SampleResult {
  productId: string;
  facts: SampleFact[];
  content: SampleContent;
  audit: SampleAudit;
  completeness: Completeness | null;
}

export function SampleRunner({
  batchId,
  organizationId,
  hasProfile: initialHasProfile,
}: {
  batchId: string;
  organizationId: string;
  hasProfile: boolean;
}) {
  const router = useRouter();
  const [hasProfile, setHasProfile] = useState(initialHasProfile);
  const [style, setStyle] = useState(STYLES[0] ?? '');
  const [feedback, setFeedback] = useState('');
  const [sample, setSample] = useState<SampleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenCount, setRegenCount] = useState(0);
  const [toneApproved, setToneApproved] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);
  const [insufficient, setInsufficient] = useState(false);
  const [editing, setEditing] = useState(false);

  const remaining = MAX_REGEN - regenCount;

  async function saveTone(guidance?: string) {
    await createToneProfileAction({
      organizationId,
      name: 'Tono del batch',
      style,
      guidance: guidance?.trim() || undefined,
      batchId,
    });
    setHasProfile(true);
  }

  async function runSample() {
    const res = await fetch(`/api/batches/${batchId}/sample`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Errore nella generazione del campione');
    }
    const raw = (await res.json()) as Omit<SampleResult, 'completeness'> & {
      completeness?: unknown;
    };
    return { ...raw, completeness: normalizeCompleteness(raw.completeness ?? null) };
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setToneApproved(false);
    try {
      if (!hasProfile) await saveTone();
      const result = await runSample();
      setSample(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (remaining <= 0) return;
    setBusy(true);
    setError(null);
    setToneApproved(false);
    try {
      const result = await runSample();
      setSample(result);
      setRegenCount((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  async function applyFeedback() {
    if (!feedback.trim() || remaining <= 0) return;
    setBusy(true);
    setError(null);
    setToneApproved(false);
    try {
      await saveTone(feedback);
      const result = await runSample();
      setSample(result);
      setRegenCount((n) => n + 1);
      setEditing(false);
      setFeedback('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  async function enqueue() {
    setEnqueuing(true);
    setError(null);
    setInsufficient(false);
    try {
      const res = await fetch(`/api/batches/${batchId}/enqueue`, {
        method: 'POST',
      });
      if (res.status === 402) {
        setInsufficient(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Errore nella messa in coda');
      }
      router.push(`/app/batches/${batchId}/processing`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setEnqueuing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Form tono (se non c'è un profilo) */}
      {!hasProfile && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="font-semibold text-gray-900">Imposta il tono</h2>
            <div>
              <Label htmlFor="style">Stile</Label>
              <Select
                id="style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                {STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="fb">Indicazioni aggiuntive (facoltative)</Label>
              <Textarea
                id="fb"
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Es. evita superlativi, usa un tono sobrio."
              />
            </div>
          </CardContent>
        </Card>
      )}

      {!sample && (
        <Button size="lg" onClick={generate} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generazione campione…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Genera campione
            </>
          )}
        </Button>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {sample && (
        <div className="space-y-6">
          {/* Avviso severità */}
          {(sample.audit.severity === 'medium' ||
            sample.audit.severity === 'high') && (
            <div
              className={
                sample.audit.severity === 'high'
                  ? 'flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800'
                  : 'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800'
              }
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  Attenzione: possibili affermazioni non supportate dai dati.
                </p>
                {sample.audit.unsupportedClaims.length > 0 && (
                  <ul className="mt-1 list-inside list-disc">
                    {sample.audit.unsupportedClaims.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Completezza campione */}
          {sample.completeness && (
            <Card>
              <CardContent className="space-y-2 p-6">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Completezza
                  </h3>
                  <Badge tone={COMPLETENESS_TONES[sample.completeness.status]}>
                    {COMPLETENESS_LABELS[sample.completeness.status]}
                  </Badge>
                </div>
                {(sample.completeness.status === 'partial' ||
                  sample.completeness.status === 'insufficient') && (
                  <p className="text-sm text-amber-700">
                    Generazione parziale: i dati mancanti non sono stati
                    inventati.
                  </p>
                )}
                {sample.completeness.missingAttributes.length > 0 && (
                  <div>
                    <FieldLabel>Attributi mancanti</FieldLabel>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sample.completeness.missingAttributes.map((a) => (
                        <span
                          key={a}
                          className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Fatti utilizzati */}
          <Card>
            <CardContent className="p-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Fatti utilizzati
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {sample.facts.length === 0 && (
                  <span className="text-sm text-gray-400">Nessun fatto</span>
                )}
                {sample.facts.map((f, i) => (
                  <Badge key={i} tone="gray">
                    <span className="font-medium">{f.fieldKey}</span>: {f.value}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Contenuto generato */}
          <Card>
            <CardContent className="space-y-5 p-6">
              <Field label="Titolo" value={sample.content.title} />
              <Field
                label="Descrizione breve"
                value={sample.content.shortDescription}
              />
              <Field
                label="Descrizione completa"
                value={sample.content.longDescription}
              />
              <div>
                <FieldLabel>Bullet</FieldLabel>
                <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-gray-700">
                  {sample.content.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
              <Field
                label="Meta description"
                value={sample.content.metaDescription}
              />

              {sample.content.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="font-medium">Avvisi</p>
                  <ul className="mt-1 list-inside list-disc">
                    {sample.content.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Editing indicazioni */}
          {editing && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <Label htmlFor="fb2">Modifica le indicazioni di tono</Label>
                <Textarea
                  id="fb2"
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Descrivi cosa vuoi cambiare nel tono."
                />
                <div className="flex gap-2">
                  <Button
                    onClick={applyFeedback}
                    disabled={busy || !feedback.trim() || remaining <= 0}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Applica e rigenera'
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setEditing(false)}
                    disabled={busy}
                  >
                    Annulla
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Azioni */}
          {!toneApproved ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setToneApproved(true)} disabled={busy}>
                <Check className="h-4 w-4" />
                Approva il tono
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditing((v) => !v)}
                disabled={busy}
              >
                <PencilLine className="h-4 w-4" />
                Modifica indicazioni
              </Button>
              <Button
                variant="outline"
                onClick={regenerate}
                disabled={busy || remaining <= 0}
              >
                <RefreshCw className="h-4 w-4" />
                Rigenera il campione
              </Button>
              <span className="text-xs text-gray-400">
                {remaining} rigenerazioni rimaste
              </span>
            </div>
          ) : (
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-2 text-emerald-700">
                  <Check className="h-5 w-5" />
                  <span className="font-medium">Tono approvato</span>
                </div>
                <p className="text-sm text-gray-500">
                  Verrà riservato 1 credito per ogni prodotto idoneo. La
                  generazione avviene in background.
                </p>
                {insufficient && (
                  <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <span className="font-medium">Crediti insufficienti</span>
                    <span>
                      Non hai crediti a sufficienza per generare l’intero batch.
                    </span>
                    <Link
                      href="/app/billing"
                      className="font-medium underline underline-offset-2"
                    >
                      Acquista crediti
                    </Link>
                  </div>
                )}
                <div className="flex gap-3">
                  <Button size="lg" onClick={enqueue} disabled={enqueuing}>
                    {enqueuing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Avvio…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Genera in massa
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setToneApproved(false)}
                    disabled={enqueuing}
                  >
                    Torna indietro
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {children}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}
