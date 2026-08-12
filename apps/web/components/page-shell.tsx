import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Dove sta il titolo di una pagina.
//
// Dentro lo stesso guscio convivevano cinque larghezze diverse, scelte una per
// volta: camminando nel flusso di un batch — `new` (768) → `input` (1152) →
// `sample` (768) → `results` (1152) — il titolo saltava di lato di quasi 200 px
// a ogni «Avanti». Non è un dettaglio estetico: il punto dove si guarda cambia
// posto mentre si sta leggendo.
//
// Le larghezze restano due, ma dichiarate e con un motivo:
//
//   `larga`  — tutta la misura del guscio. Per le pagine che mostrano tabelle:
//              lì lo spazio orizzontale è il contenuto.
//   `stretta`— per le pagine che si leggono e si compilano, dove una riga
//              lunga il doppio si legge la metà.
//
// **Tutto il flusso di un batch usa `larga`**, comprese le pagine di modulo:
// dentro, le singole schede si stringono da sole. Così il titolo sta sempre
// nello stesso punto dall'inizio alla fine del lavoro.
// ---------------------------------------------------------------------------

const LARGHEZZE = {
  larga: '',
  stretta: 'mx-auto max-w-3xl',
} as const;

export interface PageShellProps {
  title: string;
  /** Una riga sotto il titolo: cosa si fa qui, o di quale batch si tratta. */
  subtitle?: React.ReactNode;
  /** Comandi allineati al titolo (esporta, ri-analizza…). */
  actions?: React.ReactNode;
  larghezza?: keyof typeof LARGHEZZE;
  className?: string;
  children: React.ReactNode;
}

export function PageShell({
  title,
  subtitle,
  actions,
  larghezza = 'larga',
  className,
  children,
}: PageShellProps) {
  return (
    <div className={cn(LARGHEZZE[larghezza], className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}
