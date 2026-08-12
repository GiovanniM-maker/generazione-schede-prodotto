import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-accent text-white hover:bg-brand-accentHover focus-visible:ring-brand-accent shadow-sm',
  secondary:
    'bg-brand text-white hover:bg-brand/90 focus-visible:ring-brand shadow-sm',
  outline:
    'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 focus-visible:ring-gray-400',
  ghost: 'text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-sm',
};

// Le tre misure hanno una regola, che prima non c'era: convivevano senza
// logica — «Nuovo preset» era il comando più piccolo dello schermo pur essendo
// il motivo per cui si è su quella pagina, e nella stessa barra dei risultati
// si contavano cinque trattamenti diversi.
//
//   lg — l'unica azione che è il punto dello schermo: «Genera», «Vai ai
//        risultati», il richiamo della landing. Mai due nella stessa vista.
//   md — la misura normale. Comandi all'altezza del titolo di pagina, e tutto
//        quello che sta dentro schede e moduli.
//   sm — solo nelle righe che si ripetono: tabelle, elenchi, barre di una
//        singola scheda. Fuori da lì, un comando piccolo dice «conto poco».
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
