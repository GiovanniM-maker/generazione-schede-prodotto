import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// ---------------------------------------------------------------------------
// Il 404 di tutto il resto.
//
// Ne esisteva uno curato per i batch inesistenti, e nient'altro: qualsiasi
// altro indirizzo sbagliato — `/app/una-pagina-che-non-esiste`, un vecchio
// collegamento, un refuso — finiva sulla pagina predefinita di Next. Che è in
// inglese, non ha intestazione e non ha **nessun collegamento**: da lì si esce
// solo col tasto indietro.
//
// Le due uscite sono quelle vere: dentro l'applicazione si torna ai lavori,
// da fuori si torna alla vetrina. Il guscio se lo porta da sé, perché questa
// pagina risponde anche a chi non ha una sessione e il guscio dell'app
// richiede un accesso.
// ---------------------------------------------------------------------------

export default function NonTrovata() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)]">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <Logo href="/" />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-12 sm:px-6">
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
              <Compass className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-ink-900">
                Questa pagina non esiste
              </h1>
              <p className="mt-2 text-sm text-ink-500">
                L’indirizzo potrebbe essere scritto male, oppure la pagina è
                stata spostata. Non è colpa tua: da qui si riparte.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/app/batches">
                <Button>Vai ai tuoi lavori</Button>
              </Link>
              <Link href="/">
                <Button variant="outline">Torna alla vetrina</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
