import { cn } from '@/lib/utils';

/**
 * Le classi di un controllo che può essere in errore.
 *
 * Sta in un file suo, e non dentro `campo.tsx`, per una ragione precisa:
 * `campo.tsx` è `'use client'`, e importare una funzione da un modulo client
 * dentro `Input` trascinerebbe al browser anche i punti in cui il campo è
 * disegnato dal server. È una funzione pura: non ha bisogno di stare di là.
 *
 * La usano `Input`, `Select`, `Textarea` e i controlli scritti a mano: il
 * bordo rosso non deve dipendere da quale componente si è scelto.
 */
export function classiControllo(errore?: string | null): string {
  return cn(
    'transition-colors',
    errore
      ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/30'
      : 'focus-visible:border-brand-accent focus-visible:ring-brand-accent/40',
  );
}
