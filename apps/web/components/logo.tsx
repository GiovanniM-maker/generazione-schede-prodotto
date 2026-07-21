import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

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
        'inline-flex items-center gap-2 font-semibold text-gray-900',
        className,
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-accent to-violet-600 text-white shadow-sm">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="hidden text-base tracking-tight sm:inline">Schede&nbsp;AI</span>
    </Link>
  );
}
