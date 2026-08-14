import Link from 'next/link';
import { Coins, Clock, MessageSquare, ArrowRight } from 'lucide-react';
import {
  creditiInScadenza,
  dataBreve,
  giorniDa,
  NOME_FONTE,
  pianoAttuale,
  riepilogoAssistente,
  type Diritti,
} from '@app/core';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Il saldo smette di essere un numero.
//
// C'era una cifra sola, grande, senza niente intorno: «60 crediti». Vera, e
// inutile per le uniche due domande che uno si fa davvero — *da dove vengono* e
// *quando se ne vanno*. Con i lotti la risposta esiste, e nasconderla dietro il
// totale sarebbe una scelta a nostro favore: i crediti che scadono senza che
// nessuno se ne accorga sono soldi incassati e servizio non erogato.
//
// L'elenco è nell'ordine in cui verranno consumati. Non è una comodità: è la
// stessa cosa che dice il database, e vederla scritta permette di controllarla.
// ---------------------------------------------------------------------------

export function QuadroCrediti({ diritti }: { diritti: Diritti }) {
  const piano = pianoAttuale(diritti);
  const scadenza = creditiInScadenza(diritti, 30);
  const assistente = riepilogoAssistente(diritti.assistente);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink-500">Saldo disponibile</p>
              <p className="mt-1 text-3xl font-bold text-ink-900">
                {diritti.saldo}{' '}
                <span className="text-base font-normal text-ink-500">crediti</span>
              </p>
              <p className="mt-2 text-sm text-ink-600">
                <span className="font-medium text-ink-800">{piano.etichetta}.</span>{' '}
                {piano.dettaglio}
              </p>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
              <Coins className="h-6 w-6" aria-hidden="true" />
            </span>
          </div>

          {diritti.lotti.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Da dove vengono, e in che ordine si consumano
              </h3>
              <ul className="mt-2 divide-y divide-ink-100">
                {diritti.lotti.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge tone="gray">{NOME_FONTE[l.fonte]}</Badge>
                      {l.scadeIl ? (
                        <span className="text-ink-600">
                          scade il {dataBreve(l.scadeIl)}
                          <span className="text-ink-500">
                            {' '}
                            · fra {giorniDa(diritti.adesso, l.scadeIl)} giorni
                          </span>
                        </span>
                      ) : (
                        <span className="text-ink-500">non scade</span>
                      )}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums text-ink-900">
                      {l.rimanenti}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Il saldo è zero e non c'è nessun lotto: si dice, invece di
              mostrare una tabella vuota sotto un numero grande. */}
          {diritti.lotti.length === 0 && (
            <p className="text-sm text-ink-500">
              Non hai crediti. Scegli un pacchetto qui sotto per cominciare.
            </p>
          )}
        </CardContent>
      </Card>

      {scadenza && (
        <Avviso tono="attenzione">
          <span className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{scadenza.frase}</span>
          </span>
        </Avviso>
      )}

      {assistente && (
        <Card>
          <CardContent className="flex items-start gap-3 p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-600">
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="text-sm">
              <p className="font-medium text-ink-900">L’assistente è compreso</p>
              <p className="mt-1 text-ink-600">{assistente.frase}</p>
              <p className="mt-1 text-ink-500">
                La dotazione è cinque richieste per ogni scheda generata nel ciclo, con un minimo
                di cento. Si azzera il {dataBreve(diritti.assistente!.cicloFinisceIl)}, e oltre la
                dotazione serve un credito ogni cinque richieste.
              </p>
              {assistente.aPagamento && diritti.assistente!.creditiAddebitati > 0 && (
                <p className="mt-1 text-ink-600">
                  Crediti addebitati in questo ciclo per l’assistente:{' '}
                  <span className="font-medium tabular-nums">
                    {diritti.assistente!.creditiAddebitati}
                  </span>
                  .
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {piano.chiave === 'omaggio' && (
        <p className="text-sm text-ink-500">
          Quando il periodo in omaggio finisce non succede niente di brusco: i crediti che hai
          restano tuoi e continui a usarli.{' '}
          <Link href="#pacchetti" className="underline underline-offset-2">
            Guarda i pacchetti
          </Link>{' '}
          <ArrowRight className="inline h-3.5 w-3.5" aria-hidden="true" />
        </p>
      )}
    </div>
  );
}
