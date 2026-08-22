'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Undo2, X, XCircle } from 'lucide-react';
import {
  CURVE,
  DURATE,
  aggiungiRiscontro,
  durataDi,
  type Riscontro,
  type TonoRiscontro,
} from '@app/core/interfaccia';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Dire che è successo qualcosa, e lasciare tornare indietro.
//
// IL BUCO CHE CHIUDE. In tutto il prodotto non esisteva **nessun** riscontro
// transitorio: un'azione che riusciva lasciava la pagina identica a com'era.
// Salvi, e non succede niente. Pubblichi un preset, e non succede niente. È la
// situazione che l'audit chiama «azioni che sembrano non aver prodotto alcun
// risultato», e qui era la regola, non l'eccezione.
//
// MA UN TOAST NON È SEMPRE LA RISPOSTA. Dove il risultato si vede sul posto —
// una riga che cambia stato, un campo che prende il bordo verde — il riscontro
// sul posto vince sempre: è più vicino a dove si sta guardando e non chiede di
// leggere. Il toast serve quando il risultato NON è visibile: è finito fuori
// schermo, o riguarda qualcosa che non è più in pagina.
//
// LA PARTE CHE CONTA DAVVERO è «Annulla». Un'azione reversibile con dieci
// secondi per ripensarci protegge più di una domanda «sei sicuro?», e costa un
// clic invece di due — perché intercetta anche l'errore di cui ci si accorge
// DOPO averlo fatto, che è la maggior parte.
// ---------------------------------------------------------------------------

export interface OpzioniRiscontro {
  tono?: TonoRiscontro;
  titolo: string;
  testo?: string;
  /** Se c'è, compare «Annulla» e il riscontro resta il doppio del tempo. */
  annulla?: () => void;
}

interface Voce extends Riscontro {
  annulla?: () => void;
}

interface Contesto {
  mostra: (o: OpzioniRiscontro) => string;
  chiudi: (id: string) => void;
}

const Ctx = React.createContext<Contesto | null>(null);

/**
 * Il gancio da usare nei componenti.
 *
 * Fuori dal fornitore non lancia: restituisce una versione che non fa niente.
 * È una scelta — un riscontro mancato non deve far cadere la pagina che stava
 * cercando di dire che era andato tutto bene.
 */
export function useRiscontro(): Contesto {
  const c = React.useContext(Ctx);
  return c ?? { mostra: () => '', chiudi: () => {} };
}

let contatore = 0;

export function FornitoreRiscontri({ children }: { children: React.ReactNode }) {
  const [voci, setVoci] = React.useState<Voce[]>([]);
  const [montato, setMontato] = React.useState(false);
  const timer = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  React.useEffect(() => setMontato(true), []);
  React.useEffect(() => {
    const t = timer.current;
    return () => {
      t.forEach((x) => clearTimeout(x));
      t.clear();
    };
  }, []);

  const chiudi = React.useCallback((id: string) => {
    const t = timer.current.get(id);
    if (t) clearTimeout(t);
    timer.current.delete(id);
    setVoci((v) => v.filter((x) => x.id !== id));
  }, []);

  const mostra = React.useCallback(
    (o: OpzioniRiscontro) => {
      const id = `r${++contatore}`;
      const tono = o.tono ?? 'riuscito';
      const annullabile = Boolean(o.annulla);
      const durataMs = durataDi({ tono, annullabile });
      const voce: Voce = {
        id,
        tono,
        titolo: o.titolo,
        testo: o.testo,
        durataMs,
        annullabile,
        annulla: o.annulla,
      };
      // La politica della pila — quanti ne restano, chi esce — sta in
      // `@app/core`, dove si prova senza montare niente.
      setVoci((v) => aggiungiRiscontro(v, voce) as Voce[]);
      if (durataMs !== null) {
        timer.current.set(
          id,
          setTimeout(() => chiudi(id), durataMs),
        );
      }
      return id;
    },
    [chiudi],
  );

  const valore = React.useMemo(() => ({ mostra, chiudi }), [mostra, chiudi]);

  return (
    <Ctx.Provider value={valore}>
      {children}
      {montato &&
        createPortal(
          <div
            // `status` e non `alert`: gli errori qui dentro sono già stati
            // annunciati dall'azione che li ha causati, e interrompere due
            // volte la stessa notizia è il modo di far spegnere le notifiche.
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-3 bottom-3 z-toast flex flex-col-reverse gap-2 pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(25rem,calc(100vw-2rem))]"
          >
            {voci.map((v) => (
              <VoceRiscontro key={v.id} voce={v} onChiudi={() => chiudi(v.id)} />
            ))}
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

const TONI: Record<TonoRiscontro, { icona: typeof Info; colore: string }> = {
  riuscito: { icona: CheckCircle2, colore: 'text-emerald-600' },
  errore: { icona: XCircle, colore: 'text-red-600' },
  attenzione: { icona: AlertTriangle, colore: 'text-amber-600' },
  informazione: { icona: Info, colore: 'text-ink-500' },
};

function VoceRiscontro({ voce, onChiudi }: { voce: Voce; onChiudi: () => void }) {
  const [entrato, setEntrato] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setEntrato(true), 20);
    return () => clearTimeout(t);
  }, []);
  const t = TONI[voce.tono];
  const Icona = t.icona;

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-3.5 shadow-xl motion-safe:transition-[opacity,transform]',
        entrato ? 'opacity-100' : 'translate-y-2 opacity-0',
      )}
      style={{ transitionDuration: `${DURATE.entrata}ms`, transitionTimingFunction: CURVE.uscita }}
    >
      <Icona className={cn('mt-0.5 h-4 w-4 shrink-0', t.colore)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">{voce.titolo}</p>
        {voce.testo && <p className="mt-0.5 text-sm text-ink-500">{voce.testo}</p>}
      </div>
      {voce.annulla && (
        <button
          type="button"
          onClick={() => {
            voce.annulla?.();
            onChiudi();
          }}
          className="-my-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-accent transition-colors hover:bg-brand-soft"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Annulla
        </button>
      )}
      <button
        type="button"
        onClick={onChiudi}
        aria-label="Chiudi l’avviso"
        className="-m-1 shrink-0 rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
