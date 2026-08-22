'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { descriviCampo } from '@app/core/interfaccia';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Un campo che sa dire cosa c'è che non va.
//
// I NUMERI DI PRIMA. `aria-invalid`, `aria-describedby` e `aria-errormessage`
// comparivano **zero volte** in tutto il prodotto; `required` quattro. Gli
// errori erano riquadri in cima alla pagina: su un modulo lungo dicono
// «qualcosa non va» senza dire DOVE, e chi usa un lettore di schermo non ha
// alcun legame fra il messaggio e il campo che lo ha causato.
//
// Questo componente tiene insieme le quattro parti — etichetta, controllo,
// aiuto, errore — e le collega. Il cablaggio vero (quale attributo, in quale
// ordine) sta in `@app/core/interfaccia`, dove si prova senza un browser.
//
// LA REGOLA CHE SEMBRA UN DETTAGLIO: quando ci sono sia l'aiuto sia l'errore,
// l'errore va annunciato PRIMA. Il lettore di schermo li legge nell'ordine
// scritto, e chi ha appena sbagliato vuole sapere cosa è andato storto prima di
// risentirsi spiegare come si compila il campo.
//
// E L'AIUTO NON SPARISCE quando arriva l'errore. Toglierlo è la tentazione
// naturale, perché fa spazio; ma è proprio nel momento dell'errore che
// l'istruzione serve.
// ---------------------------------------------------------------------------

export interface CampoProps {
  /** L'etichetta. Sempre visibile: un segnaposto non è un'etichetta. */
  etichetta: React.ReactNode;
  /** Il testo d'istruzione. Resta anche in presenza dell'errore. */
  aiuto?: React.ReactNode;
  /** Il messaggio d'errore. La sua presenza marca il campo come non valido. */
  errore?: string | null;
  obbligatorio?: boolean;
  /**
   * Il controllo, costruito con gli attributi che gli passiamo.
   *
   * È una funzione e non un figlio qualsiasi di proposito: così il campo non
   * deve indovinare quale nodo è il controllo, e non può sbagliare a cablarlo.
   */
  children: (attributi: ReturnType<typeof descriviCampo>['controllo']) => React.ReactNode;
  /** Un segno accanto all'etichetta: «salvato», un conteggio, un pulsante. */
  accanto?: React.ReactNode;
  className?: string;
  /** Da passare quando l'id serve anche fuori. Altrimenti se ne genera uno. */
  id?: string;
}

export function Campo({
  etichetta,
  aiuto,
  errore,
  obbligatorio,
  children,
  accanto,
  className,
  id,
}: CampoProps) {
  const generato = React.useId();
  const idCampo = id ?? generato;
  const d = descriviCampo({
    id: idCampo,
    aiuto: aiuto ? 'x' : null,
    errore,
    obbligatorio,
  });

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={idCampo} className="block text-sm font-medium text-ink-700">
          {etichetta}
          {/* «facoltativo» e non l'asterisco sull'obbligatorio: in un modulo in
              cui quasi tutto è obbligatorio, marcare l'eccezione è meno rumore
              — e l'asterisco non dice niente a chi non conosce la convenzione. */}
          {!obbligatorio && (
            <span className="ml-1.5 text-xs font-normal text-ink-500">facoltativo</span>
          )}
        </label>
        {accanto}
      </div>

      {children(d.controllo)}

      {/* L'errore per primo anche a schermo, non solo per il lettore: è quello
          che serve adesso, e metterlo sotto l'aiuto lo fa trovare dopo. */}
      {errore && (
        <p
          id={d.idErrore ?? undefined}
          className="flex items-start gap-1.5 text-xs text-red-700 motion-safe:animate-[comparsa_140ms_ease-out]"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{errore}</span>
        </p>
      )}
      {aiuto && (
        <p id={d.idAiuto ?? undefined} className="text-xs text-ink-500">
          {aiuto}
        </p>
      )}
    </div>
  );
}

/**
 * Le classi di un controllo che può essere in errore.
 *
 * Sta qui e non dentro `Input` perché la usano anche `select`, `textarea` e i
 * controlli scritti a mano: il bordo rosso non deve dipendere da quale
 * componente si è scelto.
 */
export function classiControllo(errore?: string | null): string {
  return cn(
    'transition-colors',
    errore
      ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/30'
      : 'focus-visible:border-brand-accent focus-visible:ring-brand-accent/40',
  );
}
