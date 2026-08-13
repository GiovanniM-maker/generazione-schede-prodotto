import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Cosa vuol dire un colore.
//
// Il colore aveva perso il significato: il blu voleva dire settore *e* stato, il
// verde esito *e* tipo, e per la stessa idea — «l'hai fatto tu» — c'erano due
// viola diversi (questo file diceva `violet` e disegnava indigo, la tabella dei
// risultati usava il viola vero). Un colore che vuol dire due cose non ne dice
// nessuna.
//
//   gray   — classificazione, roba inerte: settore, tipo di attributo, «Sistema».
//   blue   — informativo, in cammino: gli stati intermedi di un lavoro.
//   green  — riuscito, attivo: completato, accettato, pubblicato, valido.
//   amber  — in corso, oppure da guardare.
//   red    — fallito o rifiutato.
//   violet — roba tua e non nostra: «Personalizzato», «Modificato».
//
// La regola sotto la regola: il colore marca quello che merita attenzione. Se
// ogni etichetta è colorata, nessuna lo è.
// ---------------------------------------------------------------------------

export type BadgeTone =
  | 'gray'
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'violet';

const tones: Record<BadgeTone, string> = {
  // Il nome resta `gray` perché è quello che si scrive nei punti d'uso, ma la
  // tinta è l'inchiostro caldo: questo tono non è un colore semantico come gli
  // altri cinque — è «nessuno stato», cioè il neutro della pagina. Dipinto col
  // grigio freddo di serie stonava con un fondo crema, ed era l'ultimo posto in
  // cui era rimasto.
  gray: 'bg-ink-100 text-ink-700 border-ink-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
};

export function Badge({
  tone = 'gray',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
