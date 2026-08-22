'use client';

import { useState } from 'react';
import { Gauge, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { misuraViaggio, type EsitoSonda } from '@/lib/actions/diagnostica';

// ---------------------------------------------------------------------------
// Il pannello della sonda.
//
// Esiste per una ragione sola: il numero che misura si può leggere soltanto da
// dentro l'applicazione, mentre gira. Da fuori — dal database, dal codice, da
// qualunque strumento — quel viaggio non lo vede nessuno.
//
// Non mostra una barra colorata con «tutto ok»: mostra i millisecondi e dice
// cosa farne. Un cruscotto che dice «buono» senza dire quanto non permette di
// decidere niente.
// ---------------------------------------------------------------------------

const TONO: Record<string, 'riuscito' | 'attenzione' | 'errore'> = {
  vicino: 'riuscito',
  'stesso-continente': 'attenzione',
  lontano: 'errore',
};

export function DiagnosticaLatenza() {
  const [esito, setEsito] = useState<EsitoSonda | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  async function misura() {
    setInCorso(true);
    setErrore(null);
    try {
      const res = await misuraViaggio();
      if (res.ok) setEsito(res.data);
      else setErrore(res.error);
    } catch {
      setErrore('La misura non è riuscita: riprova fra poco.');
    } finally {
      setInCorso(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-ink-900">
              <Gauge className="h-4 w-4 text-ink-500" />
              <h2 className="text-base font-medium">Distanza dal database</h2>
            </div>
            <p className="mt-1 max-w-prose text-sm text-ink-500">
              Misura quanto ci mette una richiesta ad arrivare a Supabase e tornare indietro. È
              il tempo che ogni pagina paga più volte, e non si può leggere da nessun&apos;altra
              parte: il database registra solo quanto ci mette a rispondere, non il viaggio.
            </p>
          </div>
          <Button onClick={() => void misura()} disabled={inCorso} className="shrink-0">
            {inCorso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
            {inCorso ? 'Misuro…' : 'Misura'}
          </Button>
        </div>

        {errore && <Avviso tono="errore">{errore}</Avviso>}

        {esito && (
          <div className="space-y-3">
            <Avviso tono={TONO[esito.giudizio.distanza] ?? 'attenzione'}>
              <div className="space-y-1">
                <div className="font-medium">{esito.giudizio.titolo}</div>
                <div className="text-sm">{esito.giudizio.spiegazione}</div>
              </div>
            </Avviso>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-ink-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-ink-500">Database</div>
                <div className="mt-0.5 text-2xl font-medium tabular-nums text-ink-900">
                  {esito.database.minimo} ms
                </div>
                <div className="mt-1 text-xs text-ink-500">
                  giri: {esito.database.giri.join(' · ')} ms
                </div>
              </div>
              <div className="rounded-lg border border-ink-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-ink-500">
                  Validazione del token
                </div>
                <div className="mt-0.5 text-2xl font-medium tabular-nums text-ink-900">
                  {esito.autenticazione.minimo} ms
                </div>
                <div className="mt-1 text-xs text-ink-500">
                  pagata due volte per navigazione: middleware e pagina
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
              <span>
                Funzioni: <span className="font-mono text-ink-700">{esito.regione ?? 'in locale'}</span>
              </span>
              <span>
                Database: <span className="font-mono text-ink-700">{esito.regioneDatabase}</span>
              </span>
              {/* Il primo giro si mostra ma non conta: paga l'apertura della
                  connessione, e chi lo confronta con gli altri si spaventa
                  per niente. Meglio dirlo che nasconderlo. */}
              <span>
                Primo giro <span className="font-mono text-ink-700">{esito.database.primo} ms</span>:
                include l&apos;apertura della connessione, non conta
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
