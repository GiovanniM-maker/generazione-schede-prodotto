import type { Metadata } from 'next';
import './globals.css';
import { CookieBanner } from '@/components/cookie-banner';

export const metadata: Metadata = {
  title: 'Schede AI — Schede prodotto generate e verificate',
  description:
    'Trasforma il tuo catalogo moda in schede prodotto pronte da pubblicare. Carica CSV o Excel, conferma i dati e genera in massa descrizioni professionali coerenti con il tuo brand.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
