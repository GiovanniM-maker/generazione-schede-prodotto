'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// L'unico pezzo interattivo del riquadro dell'abbonamento, e sta in un file suo.
//
// Non è organizzazione del codice: è una necessità. Il riquadro legge
// `@app/core`, e `@app/core` esporta anche `hash.ts`, che importa
// `node:crypto`. In un componente server non succede niente; marcando client lo
// stesso file, webpack prova a mettere `node:crypto` nel pacchetto del browser
// e la build si ferma:
//
//     Module build failed: UnhandledSchemeError:
//     Reading from "node:crypto" is not handled by plugins
//
// Né `tsc` né i test unitari lo vedono — lo vede solo `next build`. Tenere il
// «client» ridotto al pulsante lascia il resto dove deve stare: sul server.
// ---------------------------------------------------------------------------

/** Apre il pannello di Stripe: disdetta, carta, dati, fatture. */
export function GestisciAbbonamento() {
  const [attesa, setAttesa] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function apri() {
    setAttesa(true);
    setErrore(null);
    try {
      const r = await fetch('/api/stripe/portal', { method: 'POST' });
      const body = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !body.url) throw new Error(body.error ?? 'Non riesco ad aprire la gestione.');
      window.location.href = body.url;
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Errore');
      setAttesa(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={apri} disabled={attesa}>
        {attesa ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Gestisci l’abbonamento'}
      </Button>
      {errore && (
        <p className="text-xs text-red-600" role="alert">
          {errore}
        </p>
      )}
    </div>
  );
}
