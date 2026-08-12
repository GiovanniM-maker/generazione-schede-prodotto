import { ImageResponse } from 'next/og';

// ---------------------------------------------------------------------------
// L'immagine che si vede quando il link viene incollato da qualche parte.
//
// Non è decorazione: senza, WhatsApp e LinkedIn mostrano un rettangolo grigio
// col dominio, e il collegamento sembra uno dei tanti che nessuno apre.
//
// È **generata**, non un file caricato. Un PNG in `public/` sarebbe più
// semplice e più fragile: cambia il nome del prodotto o il rosso del marchio e
// resta lì, identico, per sempre — perché nessuno ricorda che esiste. Qui il
// colore e le parole vengono dallo stesso posto da cui vengono nella pagina, e
// se cambiano cambia anche l'anteprima.
//
// 1200×630 è la misura che tutte le piattaforme ritagliano bene. Niente
// caratteri scaricati: `next/og` dovrebbe andarseli a prendere in fase di
// compilazione, e una compilazione che dipende dalla rete è una compilazione
// che prima o poi fallisce senza motivo. Il carattere di sistema, a questa
// dimensione, non si distingue.
// ---------------------------------------------------------------------------

export const alt = 'Verificato — schede prodotto fedeli ai tuoi dati';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Gli stessi valori di `tailwind.config.ts`: marchio, accento, crema. */
const INCHIOSTRO = '#17130f';
const ACCENTO = '#c22b27';
const CREMA = '#fbf8f3';
const GRIGIO = '#6e655a';

export default function Anteprima() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: CREMA,
          padding: 72,
          // La striscia rossa in alto è l'unico elemento di marchio: basta a
          // far riconoscere il mittente in un elenco di anteprime tutte uguali.
          borderTop: `16px solid ${ACCENTO}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              fontSize: 30,
              fontWeight: 600,
              color: ACCENTO,
              letterSpacing: -0.5,
            }}
          >
            Verificato
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 62,
              lineHeight: 1.12,
              fontWeight: 700,
              color: INCHIOSTRO,
              letterSpacing: -1.5,
              maxWidth: 940,
            }}
          >
            Da foto ed Excel a schede prodotto pronte da pubblicare
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 28,
              lineHeight: 1.4,
              color: GRIGIO,
              maxWidth: 880,
            }}
          >
            Descrizioni fedeli ai dati — mai inventate. Export per Shopify,
            WooCommerce e PrestaShop, in 6 lingue.
          </div>
        </div>

        {/* Una riga sola, separatori dentro il testo.
            Con tre `<span>` affiancati e `gap` la spaziatura non veniva
            applicata e le parole si incollavano ai puntini: qui non c'è niente
            da far combaciare. */}
        <div style={{ display: 'flex', fontSize: 25, color: INCHIOSTRO }}>
          Nessuna caratteristica inventata · Controllo prima dell’export · Nessun
          abbonamento
        </div>
      </div>
    ),
    size,
  );
}
