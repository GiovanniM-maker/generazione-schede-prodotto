'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
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

    document.addEventListener('keydown', onKeyDown);
    // Il fuoco entra: sul primo comando se c'è, altrimenti sul riquadro.
    const dentro = riquadro.current?.querySelector<HTMLElement>(FUOCABILI);
    (dentro ?? riquadro.current)?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
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
          'max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl focus:outline-none',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 id={titoloId} className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
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
      <p className="text-sm text-gray-600">{message}</p>
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
