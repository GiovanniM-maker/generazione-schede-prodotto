import * as React from 'react';
import { cn } from '@/lib/utils';
import { classiControllo } from '@/components/ui/classi-controllo';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { errore?: string | null }
>(({ className, errore, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        classiControllo(errore),
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';
