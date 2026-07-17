import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Schede Prodotto Moda — Generatore AI',
  description:
    'Trasforma il tuo catalogo moda in schede prodotto pronte da pubblicare. Carica CSV o Excel, conferma i dati e genera in massa descrizioni professionali coerenti con il tuo brand.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
