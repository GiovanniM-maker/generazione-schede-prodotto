'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { registraErrore } from '@/lib/actions/servizio';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // La raccolta degli errori in produzione non esisteva: un errore arrivava a
  // schermo, l'utente ricaricava, e non ne restava traccia da nessuna parte.
  // Adesso finisce dove finiscono già gli altri guasti, e si vede nello stato
  // del servizio. Se anche questa scrittura fallisce non si fa niente: siamo
  // dentro la schermata d'errore, non c'è un posto più in basso dove cadere.
  useEffect(() => {
    console.error(error);
    void registraErrore({
      messaggio: error.message || 'errore senza messaggio',
      origine: error.digest ? `digest ${error.digest}` : 'app/error.tsx',
      percorso: typeof window !== 'undefined' ? window.location.pathname : undefined,
    }).catch(() => {});
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--background)] px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-red-500">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <div>
        <h1 className="text-xl font-semibold text-ink-900">
          Si è verificato un errore
        </h1>
        <p className="mt-1 max-w-md text-sm text-ink-500">
          Qualcosa non ha funzionato. Puoi riprovare oppure tornare alla home.
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={reset}>Riprova</Button>
        <Link href="/app">
          <Button variant="outline">Vai alla dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
