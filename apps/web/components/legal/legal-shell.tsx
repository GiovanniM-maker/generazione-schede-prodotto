import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// Contenitore leggibile per le pagine legali. I contenuti sono una BOZZA
// operativa da far validare legalmente prima del lancio.
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
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Torna alla home
        </Link>
        <h1 className="text-3xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-1 text-sm text-gray-400">Ultimo aggiornamento: {updated}</p>
        <div className="prose prose-sm mt-8 max-w-none text-gray-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_li]:my-1 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
        <div className="mt-10 flex flex-wrap gap-4 border-t border-gray-200 pt-6 text-sm text-gray-500">
          <Link href="/privacy" className="hover:text-gray-900">Privacy</Link>
          <Link href="/termini" className="hover:text-gray-900">Termini</Link>
          <Link href="/cookie" className="hover:text-gray-900">Cookie</Link>
        </div>
      </div>
    </div>
  );
}
