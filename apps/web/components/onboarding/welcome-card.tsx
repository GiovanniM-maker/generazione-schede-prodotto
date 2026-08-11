'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Sparkles, Settings2, PackageOpen, ArrowRight } from 'lucide-react';

// Card di benvenuto (prima visita): spiega il percorso in 3 mosse. Si chiude
// e non torna più (localStorage).
//
// `pronto` dice se il catalogo è già configurato. Serve perché questa card
// offriva sempre «Inizia: nuovo batch» mentre dieci centimetri sotto un'altra
// card diceva «Termina la configurazione per poter creare i tuoi batch»: due
// affermazioni opposte nella stessa schermata.
export function WelcomeCard({ pronto }: { pronto: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('welcome.dashboard.v1') !== '1') setVisible(true);
    } catch {
      /* storage non disponibile: niente card */
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem('welcome.dashboard.v1', '1');
    } catch {
      /* ignora */
    }
  }

  if (!visible) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-brand-accent/30 bg-gradient-to-br from-brand-soft/60 to-white p-5">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Chiudi il benvenuto"
        className="absolute right-3 top-3 rounded p-1 text-gray-400 hover:text-gray-700"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand-accent" />
        <p className="font-semibold text-gray-900">Benvenuto! In 3 mosse hai le tue schede prodotto</p>
      </div>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        <li className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white p-3">
          <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
          <span className="text-sm text-gray-700">
            <b className="text-gray-900">1. Prepara il preset</b>
            <br />
            Categorie e dati della scheda. Puoi farlo a chat con il Copilot.
          </span>
        </li>
        <li className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white p-3">
          <PackageOpen className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
          <span className="text-sm text-gray-700">
            <b className="text-gray-900">2. Crea un batch</b>
            <br />
            Carica foto e/o Excel: il wizard ti guida passo per passo, con fumetti e una chat di aiuto.
          </span>
        </li>
        <li className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white p-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
          <span className="text-sm text-gray-700">
            <b className="text-gray-900">3. Campione gratis, poi genera</b>
            <br />
            Vedi una scheda di prova senza spendere, poi avvii tutto il lotto.
          </span>
        </li>
      </ol>
      {/* Prima il preset, poi il batch: l'ordine dei pulsanti segue l'ordine
          reale delle cose, così non si propone un passo che non è ancora
          possibile fare. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/app/settings/presets"
          className={
            pronto
              ? 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'
              : 'inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3.5 py-2 text-sm font-medium text-white hover:brightness-110'
          }
        >
          <Settings2 className="h-4 w-4" />
          {pronto ? 'Gestisci il preset' : 'Comincia: configura il preset'}
          {!pronto && <ArrowRight className="h-4 w-4" />}
        </Link>
        {pronto && (
          <Link
            href="/app/batches/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3.5 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            Inizia: nuovo batch <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
