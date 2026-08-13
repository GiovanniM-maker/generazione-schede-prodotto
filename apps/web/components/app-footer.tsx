import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import { datiTitolare } from '@/lib/legale';
import { getServerEnv } from '@/lib/env.server';

// ---------------------------------------------------------------------------
// Il piede dell'applicazione.
//
// Prima non c'era: dentro `/app` esistevano quattro link in tutto, la parola
// «supporto» non compariva mai, e privacy/termini/cookie erano raggiungibili
// solo dalla pagina pubblica — cioè uscendo. Chi si blocca a metà di un import
// non ha modo di chiedere niente a nessuno.
//
// L'indirizzo viene da `SUPPORT_EMAIL`, o da `LEGAL_EMAIL` se il primo manca.
// Se mancano entrambi il link non si finge: si dice che il contatto non è
// ancora configurato, invece di offrire un `mailto:` che non porta da nessuna
// parte.
// ---------------------------------------------------------------------------

export function AppFooter() {
  const env = getServerEnv();
  const email = env.SUPPORT_EMAIL ?? datiTitolare().email;

  return (
    <footer className="mt-12 border-t border-ink-200">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {/* Senza indirizzo, il piede tace.
            Diceva «Contatto di assistenza non ancora configurato», che è vero
            e per questo l'avevo scritto: meglio del silenzio, meglio di un
            `mailto:` che non porta da nessuna parte. Ma **tre revisioni su sei
            l'hanno classificato come guasto del prodotto** — e avevano
            ragione a leggerlo così: è un messaggio nostro, su una cosa che il
            cliente non può sistemare, in fondo a ogni schermata.
            Chi deve saperlo è chi gestisce il servizio, e infatti lo legge
            nella pagina «Servizio», dove ci sono le altre cose da sistemare. */}
        {email ? (
          <p className="inline-flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            Serve aiuto? Scrivi a{' '}
            <a
              href={`mailto:${email}?subject=${encodeURIComponent('Verificato — richiesta di assistenza')}`}
              className="-my-1 inline-flex items-center py-1.5 font-medium text-brand-accent underline underline-offset-2"
            >
              {email}
            </a>
          </p>
        ) : (
          <span />
        )}
        {/* `-my-1 py-1.5` porta l'area di tocco a 24px senza allargare la riga:
            un link di testo è alto quanto il testo, e con il dito non si prende. */}
        <nav className="-my-1 flex flex-wrap gap-x-4" aria-label="Informazioni legali">
          <Link href="/privacy" className="inline-flex items-center py-1.5 hover:text-ink-900">
            Privacy
          </Link>
          <Link href="/termini" className="inline-flex items-center py-1.5 hover:text-ink-900">
            Termini
          </Link>
          <Link href="/cookie" className="inline-flex items-center py-1.5 hover:text-ink-900">
            Cookie
          </Link>
        </nav>
      </div>
    </footer>
  );
}
