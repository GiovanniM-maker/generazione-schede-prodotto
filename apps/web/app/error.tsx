'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--background)] px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-red-500">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          Si è verificato un errore
        </h1>
        <p className="mt-1 max-w-md text-sm text-gray-500">
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
