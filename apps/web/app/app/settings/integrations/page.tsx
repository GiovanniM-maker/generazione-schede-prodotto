import { HardDrive, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default function IntegrationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Integrazioni</h2>
        <p className="mt-1 text-sm text-gray-500">
          Collega origini dati esterne al tuo catalogo.
        </p>
      </div>

      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
            <HardDrive className="h-6 w-6 text-gray-500" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">
                Google Drive
              </h3>
              <Badge tone="amber">
                <Clock className="h-3 w-3" />
                In arrivo
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Importa automaticamente schede e listini dai tuoi file su Google
              Drive. Disponibile a breve.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
