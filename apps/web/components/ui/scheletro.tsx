import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Aspettare senza far sparire la pagina.
//
// COSA C'ERA. `animate-spin` settantacinque volte, `animate-pulse` due, e due
// file `loading.tsx` identici che sostituiscono l'INTERA pagina con una rotella
// centrata. Chi naviga vede il layout sparire e poi ricomparire — ed è la cosa
// che fa sembrare lento un prodotto anche quando è veloce, perché il tempo
// percepito comincia quando lo schermo si svuota, non quando parte la richiesta.
//
// LA REGOLA CHE FA LA DIFFERENZA: lo scheletro deve avere lo stesso numero di
// righe e la stessa griglia del contenuto vero. Se ne ha meno, all'arrivo dei
// dati la pagina salta — e il salto si nota più della rotella che si voleva
// togliere.
// ---------------------------------------------------------------------------

export function Scheletro({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block rounded bg-ink-100 motion-safe:animate-[scintillio_1.4s_ease-in-out_infinite]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Lo scheletro di un elenco di righe.
 *
 * `righe` va tarato sul numero che di solito arriva davvero, non su un numero
 * tondo: è la sola cosa che decide se al caricamento la pagina resta ferma.
 */
export function ScheletroElenco({
  righe = 5,
  conFigura = true,
  className,
}: {
  righe?: number;
  /** La miniatura a sinistra, dove l'elenco vero ce l'ha. */
  conFigura?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('divide-y divide-ink-100', className)}
      role="status"
      aria-label="Caricamento in corso"
    >
      {Array.from({ length: righe }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {conFigura && <Scheletro className="h-8 w-8 shrink-0 rounded-lg" />}
          <div className="min-w-0 flex-1 space-y-2">
            {/* Larghezze diverse riga per riga: un elenco vero non ha tutti i
                nomi della stessa lunghezza, e uno scheletro perfettamente
                allineato si riconosce come finto in mezzo secondo. */}
            <Scheletro className="h-3" style={{ width: `${52 + ((i * 13) % 34)}%` }} />
            <Scheletro className="h-2.5 w-1/3" />
          </div>
          <Scheletro className="h-5 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lo stato vuoto.
//
// «Nessun elemento» non è uno stato vuoto: è una constatazione. Uno stato vuoto
// utile dice tre cose — cosa dovrebbe esserci, perché non c'è, e cosa si può
// fare — e la seconda è quella che manca sempre.
//
// C'è anche un caso in cui il vuoto è la NOTIZIA BUONA: nessuna scheda da
// rivedere vuol dire che il listino era completo. Lì il tono cambia: si dice
// che è andata bene, non si offre una scorciatoia per riempire il vuoto.
// ---------------------------------------------------------------------------

export function StatoVuoto({
  icona: Icona,
  titolo,
  children,
  azione,
  tono = 'neutro',
  className,
}: {
  icona: React.ComponentType<{ className?: string }>;
  titolo: string;
  children?: React.ReactNode;
  azione?: React.ReactNode;
  /** `riuscito` quando il vuoto è la notizia buona. */
  tono?: 'neutro' | 'riuscito';
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center gap-3 px-6 py-14 text-center', className)}
    >
      <span
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-xl',
          tono === 'riuscito' ? 'bg-emerald-50 text-emerald-600' : 'bg-ink-100 text-ink-500',
        )}
      >
        <Icona className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-ink-900">{titolo}</h3>
        {children && <p className="mx-auto max-w-sm text-sm text-ink-500">{children}</p>}
      </div>
      {azione}
    </div>
  );
}
