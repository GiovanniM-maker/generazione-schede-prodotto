'use client';

import { useState } from 'react';
import type { CopilotEntityType } from '@app/core';
import type { SectorRow } from '@/lib/actions/catalog';
import { CopilotPanel } from '@/components/copilot/copilot-panel';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export function CopilotPageClient({
  initialEntityType,
  initialSectorId,
  sectors,
}: {
  initialEntityType: CopilotEntityType;
  initialSectorId?: string;
  sectors: SectorRow[];
}) {
  const [entityType, setEntityType] = useState<CopilotEntityType>(initialEntityType);
  const [sectorId, setSectorId] = useState<string>(
    initialSectorId ?? sectors[0]?.id ?? '',
  );

  // La chiave forza il riavvio del copilot (nuova conversazione) quando
  // cambiano tipo di entità o settore.
  const panelKey = `${entityType}:${sectorId}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">
          Copilot di configurazione
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Configura attributi e categorie in chat. Il copilot prepara una bozza:
          la creazione avviene solo dopo la tua conferma.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="cp-entity">Cosa vuoi creare</Label>
            <Select
              id="cp-entity"
              value={entityType}
              onChange={(e) =>
                setEntityType(e.target.value as CopilotEntityType)
              }
              className="w-48"
            >
              <option value="attribute">Attributo</option>
              <option value="category">Categoria</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="cp-sector">Settore</Label>
            <Select
              id="cp-sector"
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="w-48"
            >
              {sectors.length === 0 && <option value="">—</option>}
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <CopilotPanel
        key={panelKey}
        entityType={entityType}
        sectorId={sectorId || undefined}
      />
    </div>
  );
}
