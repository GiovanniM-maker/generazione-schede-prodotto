'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avviso } from '@/components/ui/avviso';

// ---------------------------------------------------------------------------
// Una modale che è davvero modale.
//
// Era un riquadro sopra la pagina, e niente di più: nessun `role="dialog"`,
// il fuoco restava sul pulsante che l'aveva aperta, e continuando con Tab si
// usciva dal riquadro e si finiva a girare nella pagina sotto — che nel
// frattempo era coperta e inutilizzabile. Chi non vede lo schermo si ritrovava
// a navigare qualcosa che non c'era più. Esc, quello sì, funzionava.
//
// Tre cose fanno la differenza, e sono tutte qui:
//
//   1. il fuoco **entra** quando la modale si apre;
//   2. il fuoco **resta dentro** finché è aperta (Tab e Shift+Tab girano);
//   3. il fuoco **torna** dove stava quando si chiude.
//
// La terza è quella che si dimentica sempre, ed è quella che si sente di più:
// senza, dopo aver chiuso una modale si riparte dall'inizio della pagina.
//
// Ne mancava una quarta, e si vedeva solo col dito: la pagina sotto
// **scorreva**. Una rotellata, o una passata di pollice sulla velatura, e il
// contenuto coperto scivolava via di 1200 px — così chiudendo la modale ci si
// ritrovava in un punto della pagina che non si era scelto. `document.body`
// aveva `overflow: visible` anche con un `[role=dialog]` aperto.
// ---------------------------------------------------------------------------

/** Gli elementi che possono ricevere il fuoco, in ordine di documento. */
const FUOCABILI =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  errore,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  /**
   * L'errore dell'azione lanciata DA QUESTA modale.
   *
   * Senza, finiva nel corpo della pagina: la modale è `fixed inset-0`, quindi
   * il messaggio veniva disegnato **dietro la velatura**. Misurato: premendo
   * «Crea» senza nome, la modale resta aperta, l'avviso «Il nome è
   * obbligatorio» esiste con `role="alert"` — e nel suo punto centrale
   * l'elemento davanti è il velo della modale. Chi guarda non vede succedere
   * niente, e ripreme.
   *
   * Il lettore di schermo lo annunciava lo stesso: è uno di quei casi in cui
   * chi non vede lo schermo era informato meglio di chi lo vede.
   */
  errore?: string | null;
}) {
  const riquadro = React.useRef<HTMLDivElement>(null);
  const titoloId = React.useId();
  // `onClose` è quasi sempre una funzione scritta al volo nel punto in cui la
  // modale viene usata, quindi cambia identità a ogni render del genitore. Se
  // l'effetto dipendesse da lei, la pulizia rimetterebbe il fuoco sul pulsante
  // di apertura mentre la modale è ancora aperta — a ogni battuta.
  const chiudi = React.useRef(onClose);
  chiudi.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    // Dove eravamo prima: ci si torna alla chiusura.
    const prima = document.activeElement as HTMLElement | null;

    function fuocabili(): HTMLElement[] {
      return Array.from(riquadro.current?.querySelectorAll<HTMLElement>(FUOCABILI) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        chiudi.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = fuocabili();
      if (el.length === 0) {
        e.preventDefault();
        return;
      }
      const primo = el[0]!;
      const ultimo = el[el.length - 1]!;
      const attivo = document.activeElement;
      // Il giro si chiude su sé stesso: dall'ultimo si torna al primo e
      // viceversa, invece di scivolare nella pagina coperta.
      if (e.shiftKey && (attivo === primo || !riquadro.current?.contains(attivo))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && attivo === ultimo) {
        e.preventDefault();
        primo.focus();
      }
    }

    // La pagina sotto si ferma finché la modale è aperta.
    //
    // Su desktop, togliere lo scorrimento fa sparire la barra di scorrimento e
    // il contenuto salta a destra della sua larghezza: si compensa con un
    // padding pari a quella. Sul telefono la barra non occupa spazio, la
    // differenza è zero e non si aggiunge niente.
    const scorrimentoPrima = document.body.style.overflow;
    const paddingPrima = document.body.style.paddingRight;
    const larghezzaBarra = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (larghezzaBarra > 0) {
      const attuale = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${attuale + larghezzaBarra}px`;
    }

    document.addEventListener('keydown', onKeyDown);
    // Il fuoco entra: sul primo comando se c'è, altrimenti sul riquadro.
    const dentro = riquadro.current?.querySelector<HTMLElement>(FUOCABILI);
    (dentro ?? riquadro.current)?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = scorrimentoPrima;
      document.body.style.paddingRight = paddingPrima;
      prima?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={riquadro}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titoloId}
        tabIndex={-1}
        className={cn(
          'max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-200 bg-white shadow-xl focus:outline-none',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-4">
          <h2 id={titoloId} className="text-base font-semibold text-ink-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 rounded-md p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-600"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {errore && <Avviso tono="errore">{errore}</Avviso>}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Dialog di conferma per azioni distruttive. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Conferma',
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} className="max-w-md">
      <p className="text-sm text-ink-600">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Annulla
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
          {busy ? 'Attendere…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
