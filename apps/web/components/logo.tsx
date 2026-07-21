import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Marchio "Verificato": cartellino fustellato con la spunta. */
export function VerificatoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <path
        d="M4 7.5C4 5.6 5.6 4 7.5 4h13.2c1 0 1.9.4 2.6 1.1l12 12c1.4 1.4 1.4 3.6 0 5L23.1 35.3c-1.4 1.4-3.6 1.4-5 0l-12-12C5.4 22.6 5 21.7 5 20.7z"
        fill="currentColor"
      />
      <circle cx="12.5" cy="12.5" r="3.1" fill="#fff" />
      <path
        d="M17.5 22.5l3.6 3.6 7.4-7.8"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({
  href = '/',
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 font-extrabold tracking-tight text-gray-900',
        className,
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-brand-accent shadow-sm ring-1 ring-black/5">
        <VerificatoMark className="h-6 w-6" />
      </span>
      <span className="hidden text-base uppercase tracking-tight sm:inline">Verificato</span>
    </Link>
  );
}
