import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // ---------------------------------------------------------------
      // La scala tipografica, ridefinita invece che riscritta ovunque.
      //
      // Il conteggio era questo: `text-sm` 298 volte e `text-xs` 198, cioè
      // **l'86% di tutto il testo del prodotto in due sole misure** — 14 px e
      // 12 px. `text-base` appena 25 volte. Non era una scala: era una taglia
      // sola con una variante più piccola, e 198 usi di 12 px sono un
      // problema di leggibilità prima ancora che di gerarchia.
      //
      // Cambiarli uno per uno voleva dire toccare cinquecento punti e
      // sbagliarne una parte. Ridefinire i due gradini li sposta tutti
      // insieme: `sm` diventa il corpo vero (15 px) e `xs` smette di essere
      // sotto la soglia della lettura comoda (13 px).
      //
      // `micro` resta a 11 px ed è l'UNICO posto in cui si scende: le
      // etichette di colonna maiuscole, che si guardano e non si leggono.
      // ---------------------------------------------------------------
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em' }], // 11px
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],                          // 13px (era 12)
        sm: ['0.9375rem', { lineHeight: '1.4375rem' }],                         // 15px (era 14)
        base: ['1rem', { lineHeight: '1.6rem' }],                               // 16px
      },
      // L'impilamento ha cinque piani e un nome ciascuno. Prima erano otto
      // numeri scelti a caso — 10, 20, 30, 40, 50, 60, 70, 100 — e il
      // prossimo pannello sarebbe stato il nono.
      zIndex: {
        sticky: '10',
        header: '20',
        overlay: '40',
        /** Guida a fumetti e chat d'aiuto: sopra le finestre, sotto i riscontri. */
        guida: '70',
        /**
         * I riscontri stanno sopra tutto il resto.
         *
         * Non è una preferenza: un errore deve poter comparire mentre è aperta
         * una finestra, durante la guida guidata, e sopra la barra agganciata
         * in fondo al wizard — che vive a 60. A 60 ci stava anche il riscontro,
         * e un messaggio d'errore nascosto dietro una barra è un messaggio che
         * non esiste.
         *
         * Sopra di lui resta solo il collegamento «salta al contenuto» (100),
         * che deve essere raggiungibile sempre.
         */
        toast: '80',
      },
      transitionDuration: {
        // I tempi veri stanno in `@app/core/interfaccia` e sono provati lì.
        // Questo è il solo gradino che manca a Tailwind fra 100 e 150.
        120: '120ms',
      },
      keyframes: {
        scintillio: {
          '0%': { backgroundPosition: '100% 0' },
          '100%': { backgroundPosition: '0 0' },
        },
        comparsa: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      colors: {
        // ---------------------------------------------------------------
        // L'inchiostro, caldo come il fondo.
        //
        // Il fondo del prodotto è crema `#fbf8f3` — caldo — e l'inchiostro
        // dichiarato dal marchio è `#17130f`, caldo anche lui. Ma a schermo
        // ogni singolo grigio era quello di serie di Tailwind, che tende al
        // blu: **641 usi di grigi freddi contro 54 dell'inchiostro di marca**,
        // e `brand.muted` — il grigio caldo già scritto qui sotto — usato
        // ZERO volte in tutto il prodotto.
        //
        // Il risultato era un fondo caldo con sopra un'interfaccia fredda:
        // una stonatura che non si nota guardando una schermata e si vede
        // benissimo affiancandone due.
        //
        // Questa scala è derivata dall'inchiostro del marchio. Ogni gradino
        // contrasta PIÙ del grigio freddo che sostituisce — il caso che conta
        // è `ink-500`, il colore di tutto il testo secondario: da 4,56:1
        // (gray-500, sul filo del minimo) a **5,40:1** sul crema, in 282
        // punti del prodotto. `identita-visiva.test.ts` ricalcola questi
        // numeri dal file: non sono un commento, sono un vincolo.
        // ---------------------------------------------------------------
        ink: {
          50: '#f6f2ea',  // fondo inerte      (era gray-50,  1,05:1)
          100: '#eee8dd', // superficie spenta (era gray-100, 1,15:1)
          200: '#ded6c9', // bordo normale     (era gray-200, 1,36:1)
          300: '#b5ac9f', // bordo marcato     (era gray-300, 2,12:1)
          400: '#8d8478', // solo decorazione  (era gray-400, 3,48:1)
          500: '#6e655a', // testo secondario  (= brand.muted, 5,40:1)
          600: '#5b5046', // testo di servizio (era gray-600, 7,39:1)
          700: '#443b31', // testo corrente    (era gray-700, 10,35:1)
          800: '#2b241d', // testo forte       (era gray-800, 14,44:1)
          900: '#17130f', // titoli            (= brand.DEFAULT, 17,44:1)
        },
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
