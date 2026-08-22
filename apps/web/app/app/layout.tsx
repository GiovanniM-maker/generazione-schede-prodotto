import Link from 'next/link';
import {
  Activity,
  CreditCard,
  LogOut,
  Coins,
  LayoutDashboard,
  Settings,
  Inbox,
  PackageOpen,
} from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { contestoApp } from '@/lib/contesto';
import { sonoAmministratore } from '@/lib/actions/servizio';
import { signOut } from '@/lib/actions/auth';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { AppFooter } from '@/components/app-footer';
import { FornitoreRiscontri } from '@/components/ui/riscontro';

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
  // Non costa un giro in più: la sessione è già letta e l'elenco è una
  // variabile d'ambiente.
  const amministratore = await sonoAmministratore();
  const credits = contesto?.credits ?? 0;
  const openDoubts = contesto?.openDoubts ?? 0;

  // `group` sulla radice: serve alle due fasce qui sotto — intestazione e
  // contenuto — per accorgersi che la pagina dentro `main` ha chiesto la
  // larghezza piena. Il selettore è `:has()`, quindi la richiesta parte dal
  // contenuto: questo file non deve sapere QUALI pagine sono fatte di dati.
  // E si allargano insieme, altrimenti il logo resterebbe allineato a 1152 e
  // la tabella a 1600 — due colonne di lettura invece di una.
  return (
    // I riscontri transitori vivono qui, attorno a tutto: sono agganciati in
    // fondo allo schermo e devono sopravvivere al cambio di pagina — un
    // «salvato» che sparisce perché nel frattempo si è navigato altrove è un
    // riscontro che non è mai esistito.
    <FornitoreRiscontri>
    <div className="group min-h-screen bg-[var(--background)]">
      {/* Dieci tappe di Tab prima di arrivare al contenuto, e quarantatré per
          l'ultima azione dei risultati con tre soli prodotti. Chi naviga da
          tastiera rifaceva l'intera intestazione a ogni pagina. Il
          collegamento è invisibile finché non riceve il fuoco: allora
          compare. */}
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-900 focus:shadow-lg focus:ring-2 focus:ring-brand-accent"
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
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-2 motion-safe:transition-[max-width] sm:gap-4 sm:px-6 group-has-[[data-larghezza=piena]]:max-w-[1600px]">
          <Logo href="/app" className="shrink-0 text-white" />

          {/* `min-w-0` e `justify-end`: sotto i 328px sei comandi da 40px più la
              pillola dei crediti non ci stanno, e «Esci» restava tagliato sul
              bordo destro. Il gruppo ora si comprime invece di spingere fuori la
              pagina. */}
          <div className="flex min-w-0 items-center justify-end gap-0.5 sm:gap-3">
            {/* Sotto i 360px questo comando sparisce.
                Con l'aggiunta di «Lavori» i sette comandi non ci stanno più: a
                320 il gruppo partiva da 9px e finiva sopra il logo, che è
                cliccabile e porta anche lui alla dashboard. Fra due
                collegamenti che vanno nello stesso posto, quello che si toglie
                è il doppione — non il marchio. Sopra i 360 tornano entrambi. */}
            <Link href="/app" className="hidden min-[360px]:block">
              <Button variant="ghost" size="sm" className="text-ink-200 hover:bg-white/10 hover:text-white">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Dashboard</span>
              </Button>
            </Link>

            {/* «Tutti i lavori» esisteva ma non era raggiungibile: l'unico
                collegamento stava sulla dashboard, e compariva solo sopra i
                dieci batch. Sotto i dieci si arrivava alla pagina soltanto
                scrivendo l'indirizzo — cioè mai. Qui c'è da ogni schermata. */}
            <Link href="/app/batches">
              <Button variant="ghost" size="sm" className="text-ink-200 hover:bg-white/10 hover:text-white">
                <PackageOpen className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Lavori</span>
              </Button>
            </Link>

            <Link href="/app/settings/presets">
              <Button variant="ghost" size="sm" className="text-ink-200 hover:bg-white/10 hover:text-white">
                <Settings className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Configurazione</span>
              </Button>
            </Link>

            <Link href="/app/inbox" className="relative">
              <Button variant="ghost" size="sm" className="text-ink-200 hover:bg-white/10 hover:text-white">
                <Inbox className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Dubbi</span>
              </Button>
              {openDoubts > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                  {openDoubts > 99 ? '99+' : openDoubts}
                </span>
              )}
            </Link>

            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-1.5 text-sm font-medium text-white sm:px-3">
              <Coins className="h-4 w-4 text-amber-500" />
              {credits}
              {/* `ink-300` e non `ink-500`: qui il fondo è scuro (`bg-brand`),
                  e la scala va letta al contrario. Il 500 caldo su questo
                  fondo sta sotto il 3:1. */}
              {/* Sotto `lg` la parola spariva del tutto e restava un numero
                  accanto a una monetina: `sr-only` la toglie dagli occhi ma la
                  lascia a chi ascolta. È lo stesso trattamento di «Dubbi» qui
                  sopra. Prima la dava un `title`, che su un dito non compare. */}
              <span className="sr-only text-ink-300 lg:not-sr-only">crediti</span>
            </span>

            <Link href="/app/billing">
              <Button variant="ghost" size="sm" className="text-ink-200 hover:bg-white/10 hover:text-white">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Fatturazione</span>
              </Button>
            </Link>

            {/* Compare solo a chi è in `ADMIN_EMAILS`: per tutti gli altri la
                pagina non esiste, e nemmeno il collegamento. */}
            {amministratore && (
              <Link href="/app/admin">
                <Button variant="ghost" size="sm" className="text-ink-200 hover:bg-white/10 hover:text-white">
                  <Activity className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only lg:not-sr-only">Servizio</span>
                </Button>
              </Link>
            )}

            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit" className="border-white/25 bg-transparent text-white hover:bg-white/10">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Esci</span>
              </Button>
            </form>
          </div>
        </div>

      </header>

      <main
        id="contenuto"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-8 motion-safe:transition-[max-width] focus:outline-none sm:px-6 group-has-[[data-larghezza=piena]]:max-w-[1600px]"
      >
        {children}
      </main>
      <AppFooter />
    </div>
    </FornitoreRiscontri>
  );
}
