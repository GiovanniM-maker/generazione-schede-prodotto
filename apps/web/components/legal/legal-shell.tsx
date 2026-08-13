import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { datiTitolare } from '@/lib/legale';
import { Avviso } from '@/components/ui/avviso';

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
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 py-2 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Torna alla home
        </Link>
        <h1 className="text-3xl font-semibold text-ink-900">{title}</h1>
        <p className="mt-1 text-sm text-ink-500">Ultimo aggiornamento: {updated}</p>
        {!datiTitolare().completo && (
          <Avviso tono="attenzione" className="mt-6">
            <strong>Documento non ancora valido.</strong> I dati del titolare del
            trattamento non sono stati configurati: questo testo è una bozza e non
            ha valore fino al completamento.
          </Avviso>
        )}
        <div className="prose prose-sm mt-8 max-w-none text-ink-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900 [&_li]:my-1 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
        <div className="mt-10 flex flex-wrap gap-4 border-t border-ink-200 pt-6 text-sm text-ink-500">
          <Link href="/privacy" className="inline-flex items-center -my-2 py-2 hover:text-ink-900">Privacy</Link>
          <Link href="/termini" className="inline-flex items-center -my-2 py-2 hover:text-ink-900">Termini</Link>
          <Link href="/cookie" className="inline-flex items-center -my-2 py-2 hover:text-ink-900">Cookie</Link>
        </div>
      </div>
    </div>
  );
}
