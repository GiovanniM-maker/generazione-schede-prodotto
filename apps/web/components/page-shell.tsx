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
// Le larghezze sono tre, dichiarate e con un motivo:
//
//   `larga`  — tutta la misura del guscio (1152). Per la maggior parte delle
//              pagine.
//   `stretta`— per le pagine che si leggono e si compilano, dove una riga
//              lunga il doppio si legge la metà.
//   `piena`  — il guscio si allarga fino a 1600. Solo per le pagine in cui i
//              dati SONO il contenuto.
//
// **Tutto il flusso di un batch usa almeno `larga`**, comprese le pagine di
// modulo: dentro, le singole schede si stringono da sole. Così il titolo sta
// sempre nello stesso punto dall'inizio alla fine del lavoro.
//
// `piena` non si mette da sé: mette `data-larghezza="piena"` e il guscio
// dell'app se ne accorge con `:has()`, allargando **anche l'intestazione**. È
// l'unico modo per non ritrovarsi col logo allineato a 1152 e la tabella a
// 1600 — due colonne di lettura invece di una.
//
// Serviva perché la tabella dei risultati vuole 1314 px e ne riceveva 1102:
// scorreva di lato di 212 px **a qualsiasi larghezza di schermo**, da 1280 a
// 2560. Su un monitor da 2560 restavano 1408 px di margine vuoto ai lati di una
// tabella che scorreva.
// ---------------------------------------------------------------------------

const LARGHEZZE = {
  larga: '',
  stretta: 'mx-auto max-w-3xl',
  piena: '',
} as const;

export interface PageShellProps {
  title: string;
  /**
   * Etichette che stanno *accanto* al titolo, non sotto: il settore di una
   * categoria, «Sistema», «Personalizzato v3».
   *
   * Senza questo, le tre pagine di dettaglio non potevano usare il guscio — il
   * loro titolo non è una stringa, è una stringa con dei distintivi in fila. E
   * tre pagine fuori dal guscio vogliono dire che il guscio non è una regola,
   * è una preferenza.
   */
  badges?: React.ReactNode;
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
  badges,
  subtitle,
  actions,
  larghezza = 'larga',
  className,
  children,
}: PageShellProps) {
  return (
    <div
      className={cn(LARGHEZZE[larghezza], className)}
      data-larghezza={larghezza === 'piena' ? 'piena' : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink-900">{title}</h1>
            {badges}
          </div>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}
