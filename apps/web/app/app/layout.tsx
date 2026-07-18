import Link from 'next/link';
import {
  CreditCard,
  LogOut,
  Coins,
  LayoutDashboard,
  Settings,
} from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { getCreditBalance } from '@/lib/credits';
import { signOut } from '@/lib/actions/auth';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  const credits = org ? await getCreditBalance(org.organizationId) : 0;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo href="/app" />

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/app">
              <Button variant="ghost" size="sm">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Dashboard</span>
              </Button>
            </Link>

            <Link href="/app/settings/presets">
              <Button variant="ghost" size="sm">
                <Settings className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Configurazione</span>
              </Button>
            </Link>

            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700"
              title="Crediti disponibili"
            >
              <Coins className="h-4 w-4 text-amber-500" />
              {credits}
              <span className="hidden text-gray-400 sm:inline">crediti</span>
            </span>

            <Link href="/app/billing">
              <Button variant="ghost" size="sm">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Fatturazione</span>
              </Button>
            </Link>

            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Esci</span>
              </Button>
            </form>
          </div>
        </div>

        <nav className="border-t border-gray-100 bg-gray-50/60">
          <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2 text-sm sm:px-6">
            <span className="mr-2 whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-gray-400">
              Configurazione catalogo
            </span>
            {[
              { href: '/app/settings/presets', label: 'Preset' },
              { href: '/app/settings/categories', label: 'Categorie' },
              { href: '/app/settings/attributes', label: 'Attributi' },
              { href: '/app/settings/sectors', label: 'Settori' },
              { href: '/app/settings/integrations', label: 'Integrazioni' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
