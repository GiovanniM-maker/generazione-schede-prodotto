import Link from 'next/link';
import {
  CreditCard,
  LogOut,
  Coins,
  LayoutDashboard,
  Settings,
  Inbox,
} from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { contestoApp } from '@/lib/contesto';
import { signOut } from '@/lib/actions/auth';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { AppFooter } from '@/components/app-footer';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Una chiamata sola invece di tre in fila. Erano già «in parallelo» le ultime
  // due, ma potevano partire solo dopo aver saputo l'organizzazione: la fila
  // restava lunga tre.
  const contesto = await contestoApp(user.id);
  const credits = contesto?.credits ?? 0;
  const openDoubts = contesto?.openDoubts ?? 0;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Dieci tappe di Tab prima di arrivare al contenuto, e quarantatré per
          l'ultima azione dei risultati con tre soli prodotti. Chi naviga da
          tastiera rifaceva l'intera intestazione a ogni pagina. Il
          collegamento è invisibile finché non riceve il fuoco: allora
          compare. */}
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow-lg focus:ring-2 focus:ring-brand-accent"
      >
        Salta al contenuto
      </a>
      {/* Le etichette compaiono da `lg`, non da `sm`.
          Con le parole accanto alle icone la barra vuole 928px, ma comparivano
          già a 640: fra 640 e 928 il documento scorreva di lato fino a 288px e
          «Esci» finiva fuori schermo. È la fascia del tablet in verticale E
          dello zoom al 200% su 1440 — cioè di chi ha bisogno di ingrandire.
          I test provavano 390 e 1440: il buco stava esattamente in mezzo. */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-brand text-white shadow-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-2 sm:gap-4 sm:px-6">
          <Logo href="/app" className="shrink-0 text-white" />

          <div className="flex items-center gap-1 sm:gap-3">
            <Link href="/app">
              <Button variant="ghost" size="sm" className="text-gray-200 hover:bg-white/10 hover:text-white">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Dashboard</span>
              </Button>
            </Link>

            <Link href="/app/settings/presets">
              <Button variant="ghost" size="sm" className="text-gray-200 hover:bg-white/10 hover:text-white">
                <Settings className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Configurazione</span>
              </Button>
            </Link>

            <Link href="/app/inbox" className="relative">
              <Button variant="ghost" size="sm" className="text-gray-200 hover:bg-white/10 hover:text-white">
                <Inbox className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Dubbi</span>
              </Button>
              {openDoubts > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                  {openDoubts > 99 ? '99+' : openDoubts}
                </span>
              )}
            </Link>

            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-1.5 text-sm font-medium text-white sm:px-3"
              title="Crediti disponibili"
            >
              <Coins className="h-4 w-4 text-amber-500" />
              {credits}
              <span className="hidden text-gray-500 lg:inline">crediti</span>
            </span>

            <Link href="/app/billing">
              <Button variant="ghost" size="sm" className="text-gray-200 hover:bg-white/10 hover:text-white">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Fatturazione</span>
              </Button>
            </Link>

            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit" className="border-white/25 bg-transparent text-white hover:bg-white/10">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Esci</span>
              </Button>
            </form>
          </div>
        </div>

      </header>

      <main id="contenuto" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 focus:outline-none">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
