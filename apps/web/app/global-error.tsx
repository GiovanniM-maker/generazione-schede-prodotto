'use client';

import { useEffect } from 'react';
import { registraErrore } from '@/lib/actions/servizio';

// L'ultima rete: qui arrivano gli errori che rompono anche il guscio
// dell'applicazione, quindi questa pagina deve portarsi il suo `<html>`.
// Nessuna dipendenza dal resto dell'interfaccia: se fosse rotta quella, questa
// pagina cadrebbe con lei.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    void registraErrore({
      messaggio: error.message || 'errore senza messaggio',
      origine: error.digest ? `globale, digest ${error.digest}` : 'app/global-error.tsx',
      percorso: typeof window !== 'undefined' ? window.location.pathname : undefined,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="it">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fbf8f3',
          color: '#17130f',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textAlign: 'center',
          padding: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            Si è verificato un errore
          </h1>
          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
            Qualcosa si è rotto prima che potessimo mostrarti la pagina. Abbiamo registrato
            l’accaduto.
          </p>
          <a
            href="/app"
            style={{
              display: 'inline-block',
              marginTop: '1.25rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              background: '#17130f',
              color: '#fff',
              textDecoration: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Torna ai tuoi lavori
          </a>
        </div>
      </body>
    </html>
  );
}
