'use client';

import Link from 'next/link';
import { Loader2, Sparkles, ArrowRight, Coins } from 'lucide-react';
import { type UploadedFileSummary } from '@/lib/actions/batch-wizard';
import { type VerificaBatchResult } from '@/lib/actions/diritti';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { COMPLETENESS_LABELS, COMPLETENESS_TONES, type Completeness } from '@/lib/completeness';
import type { SampleCopy } from '@/components/batch/passi/tipi';

// I pezzi che i passi si passano fra loro.
//
// Nessuno di questi È un passo: sono la barra di avanzamento, l'azione
// primaria, le tabelle di anteprima, i riquadri di riepilogo. Stavano sparsi
// in mezzo alle schermate, ciascuno subito dopo quella che lo usava per prima.
// ---------------------------------------------------------------------------

// Il totale dei passi dipende da cosa si carica: con un Excel ce ne sono due in
// più (colonne e mappatura). Finché la fonte non è scelta il totale **non si
// sa**, e prometterne uno vuol dire che a metà strada la barra passa da «di 9» a
// «di 11» senza che si sia fatto niente di sbagliato. Meglio non dirlo, che
// dirlo e ritrattare.
export function ProgressBar({
  steps,
  activeIndex,
  totaleNoto,
  azione,
}: {
  steps: { id: string; title: string }[];
  activeIndex: number;
  totaleNoto: boolean;
  /** Un comando che sta con l'intestazione, non con la barra. */
  azione?: React.ReactNode;
}) {
  const pct =
    steps.length > 1 ? Math.round((Math.max(0, activeIndex) / (steps.length - 1)) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex min-h-[1.75rem] items-center justify-between gap-2 text-xs text-ink-500">
        <span className="font-medium text-ink-700">
          Passo {Math.max(1, activeIndex + 1)}
          {totaleNoto ? ` di ${steps.length}` : ''}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{steps[Math.max(0, activeIndex)]?.title}</span>
          {azione}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-brand-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function StepPrimaryAction({
  passo,
  busy,
  motivi,
  step3Label = 'Continua',
  step3BusyLabel = 'Un momento…',
  onSources,
  onSample,
  onStart,
  avvioBloccato = false,
  onNext,
}: {
  /**
   * Il passo su cui si sta lavorando dentro lo stadio.
   *
   * Non è più «lo stadio»: dentro «Carica» la fonte si sceglie prima che ci
   * sia qualcosa da caricare, quindi il comando in fondo cambia man mano. Chi
   * lo calcola è `passoAttivo` in `@app/core/stadi`.
   */
  passo: number | null;
  busy: boolean;
  /** Perché non si può andare avanti, per passo. Vuoto = si può. */
  motivi: Record<number, string>;
  step3Label?: string;
  step3BusyLabel?: string;
  onSources: () => void;
  onSample: () => void;
  onStart: () => void;
  avvioBloccato?: boolean;
  onNext: () => void;
}) {
  if (passo === 1) {
    return (
      <Button type="submit" form="passo-batch" loading={busy} nonDisponibile={motivi[1]}>
        Crea e continua <ArrowRight className="h-4 w-4" />
      </Button>
    );
  }
  if (passo === 3) {
    // Con l'etichetta, non solo la rotella: leggere trenta PDF o cercare
    // cinquecento codici dura, e «sta girando» non basta a far capire cosa.
    return (
      <Button onClick={onSources} loading={busy} nonDisponibile={motivi[3]}>
        {busy ? (
          step3BusyLabel
        ) : (
          <>
            {step3Label} <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    );
  }
  if (passo === 5) {
    return (
      <Button onClick={onNext} loading={busy} nonDisponibile={motivi[5]}>
        Continua <ArrowRight className="h-4 w-4" />
      </Button>
    );
  }
  if (passo === 10) {
    return (
      <Button onClick={onNext} loading={busy} nonDisponibile={motivi[10]}>
        Continua <ArrowRight className="h-4 w-4" />
      </Button>
    );
  }
  if (passo === 11) {
    return (
      <Button
        onClick={onStart}
        loading={busy}
        // Il motivo per esteso sta nel riquadro qui sopra: qui basta dire che
        // c'è, e dove leggerlo.
        nonDisponibile={
          avvioBloccato
            ? 'Il controllo sui crediti non è passato: il motivo è scritto qui sopra.'
            : ''
        }
      >
        <Sparkles className="h-4 w-4" /> Avvia generazione
      </Button>
    );
  }
  void onSample;
  return (
    <Button onClick={onNext} loading={busy}>
      Continua <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

export function PreviewTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Record<string, string>>;
}) {
  if (rows.length === 0) return <p className="text-sm text-ink-500">Nessuna riga da mostrare.</p>;
  const shown = rows;
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200">
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-ink-50">
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="border-b border-ink-200 px-3 py-2 text-left font-semibold uppercase tracking-wide text-ink-500"
                  title={h}
                >
                  <span className="block max-w-[160px] truncate">{h}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-ink-50/50">
                {headers.map((h) => (
                  <td
                    key={h}
                    className="whitespace-nowrap border-b border-ink-100 px-3 py-1.5 text-ink-700"
                    title={r[h] ?? ''}
                  >
                    <span className="block max-w-[200px] truncate">
                      {r[h] || <span className="text-ink-300">—</span>}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-ink-100 bg-ink-50 px-3 py-1.5 text-xs text-ink-500">
        {headers.length} colonne · anteprima di {shown.length} righe{' '}
        {rows.length > shown.length ? `(su ${rows.length})` : ''}
      </p>
    </div>
  );
}

export function FilesTable({ files }: { files: UploadedFileSummary[] }) {
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
              <Badge tone={f.status === 'valid' || f.status === 'ready' ? 'green' : 'amber'}>
                {f.status}
              </Badge>
            </TD>
            <TD className="text-ink-500">{f.problem ?? '—'}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function Metric({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value: number;
  tone?: BadgeTone;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold text-ink-900">{value}</div>
        <div className="mt-1 text-sm text-ink-500">{label}</div>
        <div className="mt-2">
          <Badge tone={tone}>
            {tone === 'red' ? 'da risolvere' : tone === 'amber' ? 'da controllare' : 'ok'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function SkuList({ title, skus, tone }: { title: string; skus: string[]; tone: BadgeTone }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink-800">{title}</span>
          <Badge tone={tone}>{skus.length}</Badge>
        </div>
        {skus.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {skus.slice(0, 30).map((s) => (
              <span key={s} className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                {s}
              </span>
            ))}
            {skus.length > 30 && <span className="text-xs text-ink-500">+{skus.length - 30}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function OptionRow({
  checked,
  onSelect,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        checked
          ? 'border-brand-accent bg-brand-soft/70'
          : 'border-ink-200 bg-white hover:bg-ink-50',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-brand-accent bg-brand-accent' : 'border-ink-300',
        )}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-ink-900">{title}</span>
        <span className="block text-sm text-ink-500">{description}</span>
      </span>
    </button>
  );
}

/** Mostra inline la scheda generata dal campione (titolo, descrizioni, bullet, meta). */
export function SampleOutput({ content }: { content: SampleCopy }) {
  const bullets = Array.isArray(content.bullets) ? content.bullets : [];
  return (
    <div className="space-y-4 rounded-lg border border-ink-200 bg-white p-4">
      {content.title && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Titolo</p>
          <p className="mt-0.5 text-base font-semibold text-ink-900">{content.title}</p>
        </div>
      )}
      {content.shortDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Descrizione breve
          </p>
          <p className="mt-0.5 text-sm text-ink-700">{content.shortDescription}</p>
        </div>
      )}
      {content.longDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Descrizione lunga
          </p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-ink-700">
            {content.longDescription}
          </p>
        </div>
      )}
      {bullets.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Punti chiave</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-ink-700">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {content.metaDescription && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Meta description
          </p>
          <p className="mt-0.5 text-sm text-ink-500">{content.metaDescription}</p>
        </div>
      )}
    </div>
  );
}

// Riepilogo completezza del campione (stato + attributi mancanti).
export function SampleCompleteness({ completeness }: { completeness: Completeness }) {
  const isPartial = completeness.status === 'partial' || completeness.status === 'insufficient';
  return (
    <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-700">Completezza campione</span>
        <Badge tone={COMPLETENESS_TONES[completeness.status]}>
          {COMPLETENESS_LABELS[completeness.status]}
        </Badge>
      </div>
      {isPartial && (
        <p className="text-sm text-amber-700">
          Generazione parziale: i dati mancanti non sono stati inventati.
        </p>
      )}
      {completeness.missingAttributes.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Attributi mancanti
          </p>
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

/**
 * Quanti crediti servono, quanti ce ne sono, e cosa fare se non bastano.
 *
 * Mostra e spiega: il modo comodo sarebbe spegnere il pulsante e basta, ma un
 * pulsante grigio non dice quanti crediti mancano né dove si comprano, e chi lo
 * incontra clicca tre volte prima di rinunciare.
 */
export function ControlloCrediti({ diritti }: { diritti: VerificaBatchResult | null }) {
  if (diritti === null) {
    return (
      <p className="flex items-center gap-2 text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Controllo i crediti…
      </p>
    );
  }

  // La verifica non è riuscita. Non si finge che vada bene — il pulsante resta
  // spento — ma nemmeno si inventa un numero.
  if (!diritti.ok) {
    return (
      <Avviso tono="errore">
        Non sono riuscito a controllare i crediti ({diritti.error}). Ricarica la pagina: avviare
        senza sapere se bastano vorrebbe dire fermarsi a metà catalogo.
      </Avviso>
    );
  }

  const { verifica, avvisoSoloImmagini } = diritti;

  if (!verifica.ok) {
    return (
      <Avviso tono="attenzione">
        <span className="block font-medium">{verifica.frase}</span>
        {verifica.mancano > 0 && (
          <Link
            href="/app/billing"
            className="mt-2 inline-flex items-center gap-1 font-medium text-brand-accent underline underline-offset-2"
          >
            Vai a Fatturazione <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </Avviso>
    );
  }

  return (
    <>
      <p className="flex items-start gap-2 text-ink-700">
        <Coins className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
        <span>{verifica.frase}</span>
      </p>
      {avvisoSoloImmagini && <Avviso tono="informazione">{avvisoSoloImmagini}</Avviso>}
    </>
  );
}

/**
 * Il titolo di un pezzo dentro uno stadio.
 *
 * Serve da quando gli undici passi sono diventati cinque stadi: dentro
 * «Carica» ci sono tre cose una sotto l'altra, e senza un titolo si legge un
 * muro. Il numero del vecchio passo NON compare — era proprio quel conto a far
 * sembrare il lavoro lungo.
 *
 * `attivo` marca il pezzo su cui si sta lavorando adesso: gli altri restano
 * leggibili ma non chiedono attenzione. Non li spegne e non li nasconde —
 * nasconderli vorrebbe dire rifare undici passi con un'altra faccia.
 */
export function Sezione({
  titolo,
  attivo = false,
  children,
}: {
  titolo: string;
  attivo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2
        className={cn(
          'flex items-center gap-2 text-xs font-semibold uppercase tracking-wide',
          attivo ? 'text-brand-accent' : 'text-ink-500',
        )}
      >
        {/* Un pallino, non un numero: dice «sei qui» senza dire «di undici». */}
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            attivo ? 'bg-brand-accent' : 'bg-ink-300',
          )}
        />
        {titolo}
      </h2>
      {children}
    </section>
  );
}
