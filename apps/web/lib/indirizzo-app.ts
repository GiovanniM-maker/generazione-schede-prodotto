// ---------------------------------------------------------------------------
// Dove vive il prodotto, secondo il prodotto stesso.
//
// Serve a due cose che devono per forza dire lo stesso indirizzo: i
// collegamenti dentro le email di notifica, e gli indirizzi assoluti dei
// metadati — `og:url`, `canonical`, l'immagine dell'anteprima. Se divergono,
// un'anteprima punta a un dominio e il pulsante dell'email a un altro, e nessun
// test se ne accorge perché ciascuno dei due, da solo, è coerente.
//
// La barra finale si toglie sempre: `https://sito.it/` più `/app` fa
// `https://sito.it//app`, che funziona quasi ovunque e rompe qualcosa da
// qualche parte.
// ---------------------------------------------------------------------------

const RIPIEGO = 'https://generazione-schede-prodotto-web-iota.vercel.app';

export function indirizzoApp(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || RIPIEGO).replace(/\/$/, '');
}
