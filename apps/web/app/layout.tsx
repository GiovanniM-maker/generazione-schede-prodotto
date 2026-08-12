import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { CookieBanner } from '@/components/cookie-banner';
import { indirizzoApp } from '@/lib/indirizzo-app';

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

// ---------------------------------------------------------------------------
// Come si presenta un collegamento al prodotto, fuori dal prodotto.
//
// Non c'era niente: zero `og:`, zero `twitter:`, zero `canonical`. Incollato su
// WhatsApp o LinkedIn, l'indirizzo restava un indirizzo nudo — nessun titolo,
// nessuna immagine, nessuna frase. Chi lo riceveva doveva fidarsi di un link e
// basta, che è il momento peggiore per chiedere fiducia.
//
// E la descrizione per i motori di ricerca prometteva ancora **solo moda**,
// scritta quando il prodotto era solo per la moda. Oggi vende soprattutto al
// food: chi cercava «schede prodotto alimentari» leggeva di un catalogo di
// vestiti e andava altrove.
//
// `metadataBase` è la radice degli indirizzi assoluti: senza, Next costruisce
// `og:image` relativo e nessuno lo scarica. L'indirizzo viene da
// `lib/indirizzo-app`, lo stesso che usano i collegamenti nelle email.
// ---------------------------------------------------------------------------

const DESCRIZIONE =
  'Carica listini in Excel, foto di etichette o link di prodotto: l’AI scrive ' +
  'titoli, descrizioni e bullet fedeli ai dati — mai inventati — e li esporta ' +
  'per Shopify, WooCommerce e PrestaShop, in 6 lingue.';

export const metadata: Metadata = {
  metadataBase: new URL(indirizzoApp()),
  title: {
    // Le pagine interne dichiarano solo il proprio nome («Privacy Policy») e
    // il marchio glielo aggiunge questo modello: prima uscivano senza.
    default: 'Verificato — Schede prodotto fedeli ai tuoi dati',
    template: '%s — Verificato',
  },
  description: DESCRIZIONE,
  applicationName: 'Verificato',
  // NIENTE `alternates.canonical` qui.
  //
  // I metadati del guscio si ereditano: messo qui, `canonical: '/'` finiva su
  // OGNI pagina pubblica — `/privacy`, `/termini`, `/cookie`, `/login` — e
  // dichiarava ai motori che quelle pagine *sono* la vetrina. È il modo più
  // rapido di far sparire dall'indice tre documenti legali, e non se ne
  // accorge nessuno perché a schermo non cambia niente. Ogni pagina dichiara
  // il proprio.
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    siteName: 'Verificato',
    title: 'Verificato — Schede prodotto fedeli ai tuoi dati',
    description: DESCRIZIONE,
    url: '/',
  },
  twitter: {
    // «summary_large_image» e non «summary»: la seconda mostra un quadratino
    // accanto al testo, e con un'immagine 1200×630 esce ritagliata al centro.
    card: 'summary_large_image',
    title: 'Verificato — Schede prodotto fedeli ai tuoi dati',
    description: DESCRIZIONE,
  },
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
