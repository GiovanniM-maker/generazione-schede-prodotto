import Link from 'next/link';
import { CreditCard, LogOut, Coins } from 'lucide-react';
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
                <CreditCard className="h-4 w-4" />
                <span className="hidden sm:inline">Fatturazione</span>
              </Button>
            </Link>

            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Esci</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
