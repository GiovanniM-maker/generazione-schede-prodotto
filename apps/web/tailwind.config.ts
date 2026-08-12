import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Tema "Verificato": rosso brand + neutri caldi. Il rosso è per i
        // momenti di brand/azione; gli stati (ok/avviso/errore) restano semantici.
        //
        // `accent` era `#e5322d`: bianco sopra faceva **4,35:1**, sotto il
        // minimo di 4,5:1 — e lo stesso rosso su bianco, usato per i
        // collegamenti, faceva lo stesso numero. Riguardava tutte le azioni
        // del percorso di acquisizione: «Prova gratis», «Prova con 3
        // prodotti», «Invia codice di accesso», «Verifica e accedi». Cioè
        // proprio i punti in cui non ci si può permettere che qualcuno non
        // legga.
        //
        // Ora `accent` è il rosso che passa (5,72:1) e `accentHover` quello
        // ancora più scuro (7,45:1), così il passaggio del mouse resta
        // percepibile invece di appiattirsi. Stessa tinta, stessa identità:
        // cambia la luminosità, non il colore. I numeri sono verificati da
        // `identita-visiva.test.ts`, che li ricalcola dal file.
        brand: {
          DEFAULT: '#17130f',
          muted: '#6e655a',
          accent: '#c22b27',
          accentHover: '#a32320',
          soft: '#fbe7e4',
        },
      },
    },
  },
  plugins: [],
};
export default config;
