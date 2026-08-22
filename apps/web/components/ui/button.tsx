import * as React from 'react';
import { aspettoComando } from '@app/core/comandi';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-accent text-white hover:bg-brand-accentHover focus-visible:ring-brand-accent shadow-sm',
  secondary:
    'bg-brand text-white hover:bg-brand/90 focus-visible:ring-brand shadow-sm',
  outline:
    'border border-ink-300 bg-white text-ink-800 hover:bg-ink-50 focus-visible:ring-ink-400',
  ghost: 'text-ink-700 hover:bg-ink-100 focus-visible:ring-ink-400',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-sm',
};

// Le tre misure hanno una regola, che prima non c'era: convivevano senza
// logica — «Nuovo preset» era il comando più piccolo dello schermo pur essendo
// il motivo per cui si è su quella pagina, e nella stessa barra dei risultati
// si contavano cinque trattamenti diversi.
//
//   lg — l'unica azione che è il punto dello schermo: «Genera», «Vai ai
//        risultati», il richiamo della landing. Mai due nella stessa vista.
//   md — la misura normale. Comandi all'altezza del titolo di pagina, e tutto
//        quello che sta dentro schede e moduli.
//   sm — solo nelle righe che si ripetono: tabelle, elenchi, barre di una
//        singola scheda. Fuori da lì, un comando piccolo dice «conto poco».
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /**
   * Il comando sta lavorando.
   *
   * Prima la rotella si infilava a mano nel figlio, in decine di punti, e ogni
   * volta l'etichetta spariva: il pulsante si restringeva e tutta la barra
   * saltava di lato. Qui l'etichetta RESTA e la rotella le si mette accanto,
   * così la misura non cambia. Il comando è anche spento, perché un secondo
   * clic manderebbe la stessa richiesta due volte.
   */
  loading?: boolean;
  /**
   * Il comando non si può usare, e QUESTO è il motivo.
   *
   * Non è un `disabled` con una spiegazione accanto: è un'altra cosa. Un
   * elemento `disabled` non prende il fuoco, quindi con la tastiera lo si salta
   * — non si scopre nemmeno che esiste, e il motivo per cui è spento non lo si
   * può leggere. Qui il comando resta RAGGIUNGIBILE (`aria-disabled`), porta il
   * motivo dentro il proprio nome, e premerlo non fa niente.
   *
   * `disabled` vero resta giusto per una cosa sola: mentre la richiesta è in
   * volo, dove dura un istante e serve a non mandarla due volte. Per quello
   * c'è `loading`.
   *
   * Il motivo si scrive per chi legge: «Serve prima: il nome del lavoro», non
   * «Requisiti non soddisfatti».
   */
  nonDisponibile?: string | null;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  // `type="button"` predefinito, e non è un dettaglio.
  //
  // In HTML un `<button>` dentro un `<form>` senza `type` vale `submit`. Finché
  // nell'applicazione non c'era un solo form la cosa non si notava; ora che i
  // moduli sono form veri, «Annulla» accanto a «Salva» invierebbe il modulo
  // invece di chiuderlo — e lo farebbe in silenzio, perché a schermo i due
  // pulsanti sono identici.
  //
  // Chi vuole inviare lo dice: `type="submit"`.
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      type = 'button',
      loading,
      nonDisponibile,
      children,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
    // Le tre situazioni che stavano sotto la stessa parola `disabled` — sta
    // lavorando, non ancora, non disponibile — e cosa comporta ciascuna. La
    // decisione sta in `@app/core/comandi`, dove si prova esaustivamente.
    const aspetto = aspettoComando({ lavora: loading, motivo: nonDisponibile });
    return (
      <button
        ref={ref}
        type={type}
        // `disabled` vero SOLO mentre lavora: dura un istante. Per il resto
        // `aria-disabled`, che lascia il comando raggiungibile con Tab — un
        // comando che non si incontra è una funzione nascosta, non spenta.
        disabled={disabled || aspetto.spentoDavvero}
        aria-disabled={aspetto.dichiaratoSpento || undefined}
        // `preventDefault` e non semplicemente «nessun gestore»: senza
        // `disabled` vero, un `type="submit"` dentro un form invierebbe lo
        // stesso il modulo — spento a vedersi e attivo nei fatti.
        onClick={aspetto.ignoraClic ? (e) => e.preventDefault() : onClick}
        // Chi ascolta deve sapere che è partito qualcosa: senza, il comando
        // diventa muto e spento, e sembra rotto invece che occupato.
        aria-busy={loading || undefined}
        className={cn(
          // `whitespace-nowrap`: l'etichetta di un comando non va a capo.
          //
          // Le tre misure qui sotto fissano l'ALTEZZA (h-8, h-10, h-11), quindi
          // una seconda riga di testo non allarga la pillola: le esce sopra e
          // sotto. È successo con «Accetta selezionati (1)» a 360 px — bianco
          // su fondo crema, illeggibile, e il pulsante misurava 32 px con
          // dentro 46 px di testo.
          //
          // Non va a capo dentro; a mandare a capo è il contenitore, che negli
          // ingombri stretti è sempre un `flex-wrap`.
          // `active:scale-[.97]` è il dettaglio più economico dell'intero
          // audit e il più sentito: su telefono il passaggio del mouse non
          // esiste, quindi senza questo TOCCARE UN COMANDO NON PRODUCE NESSUN
          // SEGNALE finché la risposta non arriva. Su una rete lenta sono
          // secondi in cui non si sa se il tocco è stato preso.
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[color,background-color,border-color,transform] duration-120 active:scale-[.97] active:duration-[60ms] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          // Sbiadito come uno spento, ma NON `pointer-events-none`: il
          // puntatore ci deve poter passare sopra, altrimenti il suggerimento
          // che spiega perché non si può usare non comparirebbe proprio nel
          // caso in cui serve. E niente `active:scale`: non succede niente,
          // fingere una pressione sarebbe una bugia.
          aspetto.dichiaratoSpento && 'cursor-not-allowed opacity-50 active:scale-100',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
        )}
        {children}
        {/* Il motivo entra nel NOME del comando, non in una descrizione: le
            descrizioni sono facoltative e molti lettori di schermo le saltano,
            mentre il nome viene letto sempre. Il testo visibile resta il primo,
            quindi chi comanda a voce continua a dire quello che legge. */}
        {aspetto.aggiuntaAlNome !== '' && (
          <span className="sr-only"> — {aspetto.aggiuntaAlNome}</span>
        )}
      </button>
    );
  },
);
Button.displayName = 'Button';
