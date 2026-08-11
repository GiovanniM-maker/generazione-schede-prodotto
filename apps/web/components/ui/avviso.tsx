import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Dire com'è andata, anche a chi non guarda lo schermo.
//
// C'erano 55 riquadri di riscontro in tutto il prodotto e **nessuno** era una
// regione viva: né `aria-live`, né `role="status"`, né `role="alert"`. Chi usa
// un lettore di schermo premeva «Salva» e non sapeva più niente — né che era
// andata bene, né che era andata male. Il riquadro compariva, muto.
//
// La differenza fra i due ruoli non è una sfumatura:
//
//   `alert`  interrompe. È per gli errori: qualcosa non è successo, e finché
//            non lo si sa si continua a credere il contrario.
//   `status` aspetta il suo turno. È per le conferme e le informazioni: dirle
//            subito interromperebbe la lettura per una buona notizia.
//
// C'era anche un problema più banale: lo stesso riquadro rosso era scritto a
// mano in trenta punti con quattro spaziature diverse.
// ---------------------------------------------------------------------------

export type TonoAvviso = 'errore' | 'riuscito' | 'attenzione' | 'informazione';

const TONI: Record<
  TonoAvviso,
  { classi: string; icona: typeof Info; ruolo: 'alert' | 'status' }
> = {
  errore: {
    classi: 'border-red-200 bg-red-50 text-red-700',
    icona: XCircle,
    ruolo: 'alert',
  },
  riuscito: {
    classi: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    icona: CheckCircle2,
    ruolo: 'status',
  },
  attenzione: {
    classi: 'border-amber-200 bg-amber-50 text-amber-900',
    icona: AlertTriangle,
    ruolo: 'status',
  },
  informazione: {
    classi: 'border-gray-200 bg-gray-50 text-gray-700',
    icona: Info,
    ruolo: 'status',
  },
};

export interface AvvisoProps extends React.HTMLAttributes<HTMLDivElement> {
  tono?: TonoAvviso;
  /** Toglie l'icona dove il riquadro ne ha già una sua. */
  senzaIcona?: boolean;
}

export function Avviso({
  tono = 'informazione',
  senzaIcona,
  className,
  children,
  ...props
}: AvvisoProps) {
  const t = TONI[tono];
  const Icona = t.icona;
  return (
    <div
      role={t.ruolo}
      // `alert` è già assertivo di suo; sugli altri il livello va detto.
      aria-live={t.ruolo === 'alert' ? undefined : 'polite'}
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-sm',
        t.classi,
        className,
      )}
      {...props}
    >
      {!senzaIcona && <Icona className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
