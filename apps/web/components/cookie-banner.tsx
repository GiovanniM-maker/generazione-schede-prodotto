'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'cookie-consent-v1';

// Banner di consenso cookie. L'app usa solo cookie ESSENZIALI (sessione/auth),
// quindi il consenso è un'informativa con presa d'atto; se in futuro si
// aggiungono cookie non essenziali, gestire qui l'opt-in granulare.
export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const riquadro = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage non disponibile: non mostrare (non bloccare l'app).
    }
  }, []);

  // ---------------------------------------------------------------------
  // Il banner si fa il proprio spazio in fondo alla pagina.
  //
  // È `fixed`, quindi non occupa posto nel flusso: arrivati in fondo si
  // appoggiava sopra il piede e copriva «Privacy · Termini · Cookie» —
  // compreso il collegamento alla Cookie Policy **che il banner stesso
  // cita**. Per leggerlo bisognava accettare, cioè decidere prima di poter
  // leggere.
  //
  // Si misura invece di indovinare: l'altezza cambia con la larghezza dello
  // schermo (a 390 px il testo va su quattro righe) e cambia in italiano più
  // che in altre lingue. `ResizeObserver` la ricalcola quando serve.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const el = riquadro.current;
    if (!visible || !el) return;

    const applica = () => {
      document.body.style.paddingBottom = `${el.getBoundingClientRect().height}px`;
    };
    applica();
    const osservatore = new ResizeObserver(applica);
    osservatore.observe(el);
    window.addEventListener('resize', applica);

    return () => {
      osservatore.disconnect();
      window.removeEventListener('resize', applica);
      document.body.style.paddingBottom = '';
    };
  }, [visible]);

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
    // `region` con un nome proprio: il banner e il fumetto della guida dicono
    // entrambi «Ho capito», e senza un'etichetta non c'è modo di distinguerli —
    // né per un lettore di schermo, né per un test.
    <div
      ref={riquadro}
      role="region"
      aria-label="Avviso cookie"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          Usiamo solo cookie tecnici essenziali per il funzionamento e
          l'autenticazione. Continuando accetti l'uso di questi cookie. Maggiori
          dettagli nella{' '}
          <Link href="/cookie" className="inline-block py-1 font-medium text-brand-accent underline underline-offset-2">
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
