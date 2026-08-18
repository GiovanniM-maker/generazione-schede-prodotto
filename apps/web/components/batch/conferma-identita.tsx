'use client';

import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import {
  confermaIdentita,
  listaConfermeIdentita,
  type RigaDaConfermare,
} from '@/lib/actions/batch-wizard';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// La coda di conferma dell'identità.
//
// Ci finiscono i codici su cui i segnali non bastavano: lo stesso codice presso
// due produttori, due candidati che si equivalgono. Per quei codici NON è stato
// scritto nessun campo — è la regola che impedisce una scheda in cui ogni dato
// è sbagliato pur essendo stato letto benissimo, e questa schermata è il modo
// di uscirne.
//
// È pensata per essere scorsa in fretta su molti prodotti in fila: un codice
// alla volta, i candidati affiancati, e per ciascuno le quattro cose che
// servono a riconoscerlo — foto, titolo, marca, dominio. Il prezzo aiuta a
// scartare i ricambi e gli accessori, che sono il motivo più comune per cui un
// codice trova più di una pagina.
// ---------------------------------------------------------------------------

const ETICHETTA_LIVELLO: Record<string, { testo: string; tono: 'green' | 'blue' | 'gray' }> = {
  produttore: { testo: 'sito del produttore', tono: 'green' },
  fornitore: { testo: 'fornitore indicato', tono: 'green' },
  'terza-parte': { testo: 'terza parte', tono: 'gray' },
  sconosciuto: { testo: 'terza parte', tono: 'gray' },
};

export function ConfermaIdentita({
  batchId,
  onFinito,
}: {
  batchId: string;
  onFinito: () => void;
}) {
  const [righe, setRighe] = useState<RigaDaConfermare[] | null>(null);
  const [indice, setIndice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [confermati, setConfermati] = useState(0);
  const [scartati, setScartati] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const res = await listaConfermeIdentita({ batchId }).catch(() => null);
      if (!vivo) return;
      setRighe(res && res.ok ? res.data : []);
    })();
    return () => {
      vivo = false;
    };
  }, [batchId]);

  if (righe === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carico i codici da confermare…
      </div>
    );
  }

  const riga = righe[indice];
  if (!riga) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm text-ink-700">
            {confermati + scartati === 0
              ? 'Non c’è niente da confermare: tutti i codici sono stati agganciati senza ambiguità.'
              : `Fatto: ${confermati} ${confermati === 1 ? 'confermato' : 'confermati'}${
                  scartati > 0 ? `, ${scartati} ${scartati === 1 ? 'scartato' : 'scartati'}` : ''
                }.`}
          </p>
          <div className="flex justify-end">
            <Button onClick={onFinito}>Continua</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function decidi(scelta: { url?: string; scarta?: boolean }) {
    if (!riga) return;
    setBusy(true);
    setErrore(null);
    try {
      const res = await confermaIdentita({ batchId, risoluzioneId: riga.id, ...scelta });
      if (!res.ok) {
        setErrore(res.error);
        return;
      }
      if (res.data.importato) setConfermati((n) => n + 1);
      else setScartati((n) => n + 1);
      setIndice((i) => i + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-ink-900">Quale prodotto è?</h3>
          <p className="text-sm text-ink-500">
            {righe.length - indice} {righe.length - indice === 1 ? 'codice' : 'codici'} da confermare.
            Per questi non è stato scritto nessun dato: prima si decide qual è la pagina giusta.
          </p>
        </div>
        <span className="shrink-0 text-sm text-ink-500">
          {indice + 1} di {righe.length}
        </span>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-lg font-medium text-ink-900">{riga.codice}</span>
            {riga.marca && <span className="text-sm text-ink-600">{riga.marca}</span>}
            {riga.quantiSku > 1 && (
              <Badge tone="gray">
                {riga.quantiSku} varianti dipendono da questa scelta
              </Badge>
            )}
          </div>
          {riga.motivo && <p className="text-sm text-ink-600">{riga.motivo}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            {riga.candidati.map((c) => {
              const liv = ETICHETTA_LIVELLO[c.livello] ?? ETICHETTA_LIVELLO['terza-parte']!;
              return (
                <div
                  key={c.url}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border p-3',
                    c.livello === 'produttore' || c.livello === 'fornitore'
                      ? 'border-ink-200 bg-white'
                      : 'border-ink-200 bg-ink-50',
                  )}
                >
                  {c.immagine ? (
                    /* Immagine ospitata da un sito di terzi: next/image
                       richiederebbe di dichiarare l'host, e qui l'host è
                       diverso per ogni candidato — è il punto della ricerca. */
                    <img
                      src={c.immagine}
                      alt={c.titolo ?? 'Immagine del candidato'}
                      className="h-32 w-full rounded-lg object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-32 w-full items-center justify-center rounded-lg bg-ink-100 text-xs text-ink-500">
                      nessuna immagine
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink-900">{c.titolo ?? '(senza titolo)'}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-600">
                      {c.marca && <span>{c.marca}</span>}
                      {c.prezzo && <span className="tabular-nums">{c.prezzo}</span>}
                      <Badge tone={liv.tono}>{liv.testo}</Badge>
                    </div>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-brand-accent underline underline-offset-2"
                    >
                      {c.dominio} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <Button
                    size="sm"
                    className="mt-auto"
                    disabled={busy}
                    onClick={() => void decidi({ url: c.url })}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    È questo
                  </Button>
                </div>
              );
            })}
          </div>

          {errore && <Avviso tono="errore">{errore}</Avviso>}

          <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
            {/* Scartare è una risposta, non una rinuncia: un codice che non
                trova la sua pagina è un'informazione, e resta scritta nel
                registro insieme al motivo. */}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decidi({ scarta: true })}>
              <X className="h-4 w-4" />
              Nessuno di questi
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onFinito}>
              Rimanda e continua
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-ink-500">
        Quello che rimandi resta in coda: lo ritrovi riaprendo questa lavorazione.
      </p>
    </div>
  );
}
