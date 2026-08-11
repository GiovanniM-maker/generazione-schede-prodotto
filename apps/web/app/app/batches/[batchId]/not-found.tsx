import Link from 'next/link';
import { PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Un 404 che dice cosa è successo e dove andare. La pagina muta — quella che si
// apriva vuota facendo credere che il batch fosse senza prodotti — era peggio
// dell'errore: lasciava a chiedersi se il guasto fosse del prodotto.
export default function BatchNonTrovato() {
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
            <PackageOpen className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Questo lavoro non c’è più
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Il batch non esiste, è stato eliminato, oppure appartiene a
              un’altra organizzazione. Se ci sei arrivato da un collegamento
              salvato, potrebbe essere vecchio.
            </p>
          </div>
          <Link href="/app">
            <Button variant="secondary">Torna ai tuoi lavori</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
