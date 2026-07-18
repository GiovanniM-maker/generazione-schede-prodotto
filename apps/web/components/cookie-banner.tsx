'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'cookie-consent-v1';

// Banner di consenso cookie. L'app usa solo cookie ESSENZIALI (sessione/auth),
// quindi il consenso è un'informativa con presa d'atto; se in futuro si
// aggiungono cookie non essenziali, gestire qui l'opt-in granulare.
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage non disponibile: non mostrare (non bloccare l'app).
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignora */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          Usiamo solo cookie tecnici essenziali per il funzionamento e
          l'autenticazione. Continuando accetti l'uso di questi cookie. Maggiori
          dettagli nella{' '}
          <Link href="/cookie" className="font-medium text-brand-accent underline underline-offset-2">
            Cookie Policy
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={accept}
          className="shrink-0 rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Ho capito
        </button>
      </div>
    </div>
  );
}
