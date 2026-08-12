import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { CookieBanner } from '@/components/cookie-banner';

// Il carattere del prodotto.
//
// In `globals.css` c'era `font-feature-settings: 'cv11', 'ss01'` — le varianti
// stilistiche di Inter — ma Inter non veniva mai caricato: niente `@font-face`,
// niente `next/font`. Tutto rendeva col carattere di sistema, e quella riga non
// faceva assolutamente niente. Chiedeva le forme di un carattere assente.
//
// `next/font` scarica i file una volta sola in fase di compilazione e li serve
// dal nostro dominio: nessuna richiesta a Google dal browser di chi usa il
// prodotto. Non è un dettaglio di prestazioni, è quello che ci permette di
// scrivere nella cookie policy che usiamo solo cookie tecnici.
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Verificato — Schede prodotto generate e verificate',
  description:
    'Trasforma il tuo catalogo moda in schede prodotto pronte da pubblicare. Carica CSV o Excel, conferma i dati e genera in massa descrizioni professionali coerenti con il tuo brand.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={inter.variable}>
      <body>
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
