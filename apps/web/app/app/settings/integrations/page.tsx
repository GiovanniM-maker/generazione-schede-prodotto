import Link from 'next/link';
import { Download, Link2, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Integrazioni.
//
// Era una voce di menu con dentro **una sola card «In arrivo»**: si arrivava
// qui con una domanda — «posso collegare il mio negozio?» — e si trovava una
// promessa senza data («Disponibile a breve») e nient'altro. Peggio: la
// risposta vera esisteva già, ma stava altrove e nessuno la trovava. I file per
// Shopify, WooCommerce e PrestaShop si esportano dai risultati, e sono
// esattamente quello che serve per portare le schede nel proprio negozio oggi.
//
// Adesso questa pagina risponde alla domanda con cui ci si arriva: prima quello
// che c'è, poi quello che non c'è — senza dire «a breve», che è una data che
// nessuno può promettere.
// ---------------------------------------------------------------------------

const FORMATI = [
  {
    nome: 'Shopify',
    dettaglio: 'CSV nel tracciato dell’importazione prodotti.',
  },
  {
    nome: 'WooCommerce',
    dettaglio: 'CSV nel tracciato del Product CSV Importer.',
  },
  {
    nome: 'PrestaShop',
    dettaglio: 'CSV nel tracciato dell’importazione catalogo.',
  },
];

export default function IntegrationsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">Integrazioni</h1>
      <p className="mt-1 text-sm text-gray-500">
        Come portare le schede generate nel tuo negozio.
      </p>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Download className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  Esportazione nei formati dei negozi
                </h2>
                <Badge tone="green">Disponibile</Badge>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                A fine generazione, dalla pagina dei risultati, scarichi un file già nel
                tracciato del tuo negozio: si importa senza rimaneggiarlo.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
                {FORMATI.map((f) => (
                  <li key={f.nome} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{f.nome}</span>
                    <span className="text-gray-500">{f.dettaglio}</span>
                  </li>
                ))}
              </ul>
              <Link href="/app" className="mt-4 inline-block">
                <Button variant="outline">Vai ai tuoi batch</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
              <Link2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  Collegamento diretto al negozio
                </h2>
                <Badge tone="gray">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  Non ancora
                </Badge>
              </div>
              {/* Prima c'era scritto «Disponibile a breve». Nessuno può
                  promettere una data, e una promessa che scade fa più danno del
                  silenzio. */}
              <p className="mt-1 text-sm text-gray-500">
                Scrivere le schede nel negozio senza passare da un file — e rileggere il
                catalogo da lì — non c’è ancora. Non diamo una data: quando ci sarà, si
                vedrà da questa pagina. Nel frattempo l’esportazione qui sopra fa lo stesso
                lavoro in due passaggi invece che in uno.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
