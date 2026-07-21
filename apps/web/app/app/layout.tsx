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
      <header className="sticky top-0 z-20 border-b border-white/10 bg-brand text-white shadow-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <Logo href="/app" className="shrink-0 text-white" />

          <div className="flex items-center gap-1 sm:gap-3">
            <Link href="/app">
              <Button variant="ghost" size="sm" className="text-gray-200 hover:bg-white/10 hover:text-white">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Dashboard</span>
              </Button>
            </Link>

            <Link href="/app/settings/presets">
              <Button variant="ghost" size="sm" className="text-gray-200 hover:bg-white/10 hover:text-white">
                <Settings className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Configurazione</span>
              </Button>
            </Link>

            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-1.5 text-sm font-medium text-white sm:px-3"
              title="Crediti disponibili"
            >
              <Coins className="h-4 w-4 text-amber-500" />
              {credits}
              <span className="hidden text-gray-400 sm:inline">crediti</span>
            </span>

            <Link href="/app/billing">
              <Button variant="ghost" size="sm" className="text-gray-200 hover:bg-white/10 hover:text-white">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Fatturazione</span>
              </Button>
            </Link>

            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit" className="border-white/25 bg-transparent text-white hover:bg-white/10">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Esci</span>
              </Button>
            </form>
          </div>
        </div>

      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
