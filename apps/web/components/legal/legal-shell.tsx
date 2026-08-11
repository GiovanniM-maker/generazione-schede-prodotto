import Link from 'next/link';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { datiTitolare } from '@/lib/legale';

// Contenitore delle pagine legali.
//
// Se i dati del titolare non sono configurati, lo dice in cima con un avviso
// che non si può non vedere. Prima le pagine erano pubbliche con
// «[Ragione sociale]» dentro il testo e l'aria di documenti veri: chi le
// leggeva non aveva modo di capire che erano bozze.
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 py-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Torna alla home
        </Link>
        <h1 className="text-3xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-1 text-sm text-gray-500">Ultimo aggiornamento: {updated}</p>
        {!datiTitolare().completo && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Documento non ancora valido.</strong> I dati del titolare del
              trattamento non sono stati configurati: questo testo è una bozza e non
              ha valore fino al completamento.
            </span>
          </div>
        )}
        <div className="prose prose-sm mt-8 max-w-none text-gray-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_li]:my-1 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
        <div className="mt-10 flex flex-wrap gap-4 border-t border-gray-200 pt-6 text-sm text-gray-500">
          <Link href="/privacy" className="inline-flex items-center -my-2 py-2 hover:text-gray-900">Privacy</Link>
          <Link href="/termini" className="inline-flex items-center -my-2 py-2 hover:text-gray-900">Termini</Link>
          <Link href="/cookie" className="inline-flex items-center -my-2 py-2 hover:text-gray-900">Cookie</Link>
        </div>
      </div>
    </div>
  );
}
