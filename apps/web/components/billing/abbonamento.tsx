'use client';

import { useState } from 'react';
import { Loader2, Repeat } from 'lucide-react';
import { dataBreve, formattaPrezzo, prezzoPerCredito, type Diritti } from '@app/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { PurchaseButton } from '@/components/purchase-button';

// ---------------------------------------------------------------------------
// L'abbonamento, e il modo di uscirne.
//
// I due riquadri sono uno solo, in due stati: chi non è abbonato vede l'offerta,
// chi lo è vede la sua situazione e il pulsante per gestirla. Quel pulsante non
// è un di più — un abbonamento che si sottoscrive in due clic e si disdice
// scrivendo un'email non è un abbonamento, è una trappola.
//
// Cosa NON c'è, di proposito: nessun conto alla rovescia, nessun «risparmi il
// 34%», nessuna colonna «consigliato». Il confronto col pacchetto lo fa il
// prezzo per scheda, che è già scritto su tutti e due.
// ---------------------------------------------------------------------------

/** Apre il pannello di Stripe: disdetta, carta, dati, fatture. */
function GestisciAbbonamento() {
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

export function Abbonamento({ diritti, isOwner }: { diritti: Diritti; isOwner: boolean }) {
  const attivo = diritti.abbonamento;
  const offerta = diritti.offertaAbbonamento;

  // Abbonato: la situazione, e la via d'uscita.
  if (attivo && ['trialing', 'active', 'past_due'].includes(attivo.stato)) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-sm">
            <p className="flex items-center gap-2 font-medium text-ink-900">
              <Repeat className="h-4 w-4 text-ink-400" aria-hidden="true" />
              Abbonamento attivo
            </p>
            <p className="mt-1 text-ink-600">
              {attivo.creditiMensili} crediti al mese, che scadono a fine ciclo.
              {attivo.rinnovaIl && !attivo.disdettoAFineCiclo && (
                <> Prossimo rinnovo il {dataBreve(attivo.rinnovaIl)}.</>
              )}
            </p>
            {attivo.disdettoAFineCiclo && (
              <p className="mt-1 font-medium text-ink-800">
                Disdetto: resta attivo fino al {dataBreve(attivo.rinnovaIl)}, poi non si rinnova.
              </p>
            )}
            {attivo.stato === 'past_due' && (
              <p className="mt-2">
                <Avviso tono="attenzione">
                  L’ultimo pagamento non è andato a buon fine. Il servizio resta attivo mentre
                  Stripe riprova: aggiorna la carta dalla gestione qui accanto.
                </Avviso>
              </p>
            )}
          </div>
          {isOwner && <GestisciAbbonamento />}
        </CardContent>
      </Card>
    );
  }

  // Non abbonato e nessuna offerta a listino: non si dice niente. Un riquadro
  // «presto disponibile» è una promessa che non abbiamo motivo di fare.
  if (!offerta || offerta.prezzoCent == null) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="flex items-center gap-2 font-medium text-ink-900">
            <Repeat className="h-4 w-4 text-ink-400" aria-hidden="true" />
            {offerta.nome}
          </p>
          <p className="mt-1 text-ink-600">
            <span className="text-2xl font-bold text-ink-900">
              {formattaPrezzo(offerta.prezzoCent, offerta.valuta)}
            </span>{' '}
            al mese · {offerta.crediti} crediti ogni mese
            {prezzoPerCredito(offerta.prezzoCent, offerta.crediti, offerta.valuta) && (
              <> · {prezzoPerCredito(offerta.prezzoCent, offerta.crediti, offerta.valuta)} a scheda</>
            )}
          </p>
          <p className="mt-1 text-ink-500">
            IVA esclusa. I crediti del mese scadono a fine ciclo e non si sommano: se ne generi
            meno di {offerta.crediti} conviene il pacchetto. Si disdice quando vuoi, dal prodotto.
          </p>
        </div>
        {isOwner ? (
          <div className="sm:w-48 sm:shrink-0">
            <PurchaseButton packKey={offerta.chiave} label="Abbonati" />
          </div>
        ) : (
          <p className="text-sm text-ink-500 sm:w-48 sm:shrink-0">
            L’abbonamento lo attiva il proprietario dell’organizzazione.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
