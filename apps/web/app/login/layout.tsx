import type { Metadata } from 'next';

// ---------------------------------------------------------------------------
// I metadati dell'accesso vivono qui, non nella pagina.
//
// `page.tsx` è un componente client (`'use client'`), e un componente client
// non può esportare `metadata`: Next lo ignora in silenzio. Senza questo
// guscio la pagina ereditava titolo e `canonical` della vetrina — cioè
// dichiarava ai motori di **essere** la vetrina.
//
// `robots: noindex` perché una pagina di accesso non ha niente da offrire a
// chi arriva da una ricerca: è un modulo con un campo. Che sia raggiungibile
// resta vero (`follow`), indicizzarla no.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Accedi o registrati',
  description:
    'Entra in Verificato con un codice a 6 cifre inviato via email. Nessuna password da ricordare: al primo accesso l’account si crea da sé.',
  alternates: { canonical: '/login' },
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
