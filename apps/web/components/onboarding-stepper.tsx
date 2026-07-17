'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, AlertCircle } from 'lucide-react';
import { ensureOrgAction } from '@/lib/actions/ui';
import { createToneProfileAction } from '@/lib/actions/tone';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const STYLES: { value: string; label: string; desc: string; summary: string }[] = [
  {
    value: 'Essenziale e diretto',
    label: 'Essenziale e diretto',
    desc: 'Frasi brevi, informazioni chiare, nessun fronzolo.',
    summary:
      'Le schede saranno concise e concrete, con frasi brevi che vanno dritte al punto.',
  },
  {
    value: 'Elegante e ricercato',
    label: 'Elegante e ricercato',
    desc: 'Tono raffinato, lessico curato, atmosfera premium.',
    summary:
      'Le schede avranno un tono raffinato e curato, adatto a un posizionamento premium.',
  },
  {
    value: 'Commerciale e coinvolgente',
    label: 'Commerciale e coinvolgente',
    desc: 'Linguaggio persuasivo ma corretto, orientato alla conversione.',
    summary:
      'Le schede useranno un linguaggio coinvolgente e orientato alla vendita, senza esagerazioni.',
  },
  {
    value: 'Personalizzato',
    label: 'Personalizzato',
    desc: 'Descrivi tu il tono desiderato.',
    summary: 'Le schede seguiranno le indicazioni di tono che hai fornito.',
  },
];

const TOTAL = 6;

export function OnboardingStepper() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [style, setStyle] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [example1, setExample1] = useState('');
  const [example2, setExample2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);

  const selectedStyle = STYLES.find((s) => s.value === style);

  function next() {
    setError(null);
    setStep((s) => Math.min(s + 1, TOTAL));
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const { organizationId } = await ensureOrgAction(name);
      const guidance =
        style === 'Personalizzato' && custom.trim()
          ? custom.trim()
          : website.trim()
            ? `Sito di riferimento: ${website.trim()}`
            : undefined;
      const examples = [example1, example2]
        .map((e) => e.trim())
        .filter(Boolean);
      const result = await createToneProfileAction({
        organizationId,
        name,
        style: style === 'Personalizzato' ? custom.trim() || 'Personalizzato' : style,
        examples: examples.length ? examples : undefined,
        guidance,
      });
      if (!result.ok) {
        setError(result.error ?? 'Errore durante la generazione del profilo');
        return;
      }
      setGenerated(true);
      setStep(6);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Errore durante la generazione del profilo',
      );
    } finally {
      setLoading(false);
    }
  }

  const canNext =
    (step === 1 && name.trim().length > 0) ||
    step === 2 ||
    (step === 3 && style && (style !== 'Personalizzato' || custom.trim())) ||
    step === 4;

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        {/* Progresso */}
        <div className="mb-8 flex items-center gap-2">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                i < step ? 'bg-brand-accent' : 'bg-gray-200',
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Come si chiama il tuo brand?
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Lo useremo per personalizzare il tono delle descrizioni.
              </p>
            </div>
            <div>
              <Label htmlFor="brand">Nome del brand</Label>
              <Input
                id="brand"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Atelier Milano"
                autoFocus
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Hai un sito web? (facoltativo)
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Può aiutarci a cogliere lo stile del tuo brand.
              </p>
            </div>
            <div>
              <Label htmlFor="website">URL del sito</Label>
              <Input
                id="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://www.esempio.it"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Quale stile preferisci?
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Definisce il tono di voce delle descrizioni.
              </p>
            </div>
            <div className="grid gap-3">
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStyle(s.value)}
                  className={cn(
                    'rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                    style === s.value
                      ? 'border-brand-accent bg-blue-50/50 ring-1 ring-brand-accent'
                      : 'border-gray-200 hover:border-gray-300',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{s.label}</span>
                    {style === s.value && (
                      <Check className="h-4 w-4 text-brand-accent" />
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{s.desc}</p>
                </button>
              ))}
            </div>
            {style === 'Personalizzato' && (
              <div>
                <Label htmlFor="custom">Descrivi il tono desiderato</Label>
                <Textarea
                  id="custom"
                  rows={3}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Es. tono giovane e ironico, con riferimenti allo streetwear."
                />
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Hai già delle descrizioni? (facoltativo)
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Incolla 1 o 2 esempi esistenti: ci aiutano a replicare il tuo
                stile.
              </p>
            </div>
            <div>
              <Label htmlFor="ex1">Esempio 1</Label>
              <Textarea
                id="ex1"
                rows={3}
                value={example1}
                onChange={(e) => setExample1(e.target.value)}
                placeholder="Incolla qui una descrizione esistente…"
              />
            </div>
            <div>
              <Label htmlFor="ex2">Esempio 2</Label>
              <Textarea
                id="ex2"
                rows={3}
                value={example2}
                onChange={(e) => setExample2(e.target.value)}
                placeholder="Facoltativo"
              />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Riepilogo
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Genereremo un profilo di tono per il tuo brand.
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Brand</span>
                <span className="font-medium text-gray-900">{name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Stile</span>
                <span className="font-medium text-gray-900">
                  {style === 'Personalizzato' ? 'Personalizzato' : style}
                </span>
              </div>
              {website.trim() && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">Sito</span>
                  <span className="font-medium text-gray-900">{website}</span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Esempi forniti</span>
                <span className="font-medium text-gray-900">
                  {[example1, example2].filter((e) => e.trim()).length}
                </span>
              </div>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {step === 6 && generated && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Check className="h-7 w-7" />
              </span>
              <h2 className="text-xl font-semibold text-gray-900">
                Profilo del brand pronto
              </h2>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <p className="font-medium text-gray-900">{name}</p>
              <p className="mt-2">
                {selectedStyle?.summary ??
                  'Le schede seguiranno il tono che hai indicato.'}
              </p>
              <p className="mt-2">
                Il sistema userà solo i dati che carichi: non verranno inventate
                caratteristiche non presenti nel catalogo.
              </p>
            </div>
          </div>
        )}

        {/* Navigazione */}
        <div className="mt-8 flex items-center justify-between">
          {step > 1 && step < 6 ? (
            <Button variant="ghost" onClick={back} disabled={loading}>
              <ArrowLeft className="h-4 w-4" />
              Indietro
            </Button>
          ) : (
            <span />
          )}

          {step < 5 && (
            <Button onClick={next} disabled={!canNext}>
              Continua
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {step === 5 && (
            <Button onClick={generate} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generazione…
                </>
              ) : (
                <>
                  Genera profilo
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}
          {step === 6 && (
            <Button onClick={() => router.push('/app')}>
              Vai alla dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
