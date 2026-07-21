'use client';

import { useMemo, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface InputProduct {
  id: string;
  identifier: string;
  name: string;
  type: string;
  factCount: number;
  score: number;
  level: 'buono' | 'parziale' | 'insufficiente';
  verificationStatus: string;
}

type Filter = 'tutti' | 'validi' | 'parziali' | 'esclusi' | 'verifica';

const TABS: { key: Filter; label: string }[] = [
  { key: 'tutti', label: 'Tutti' },
  { key: 'validi', label: 'Validi' },
  { key: 'parziali', label: 'Parziali' },
  { key: 'esclusi', label: 'Esclusi' },
  { key: 'verifica', label: 'Da verificare' },
];

function qualityBadge(level: InputProduct['level']) {
  if (level === 'buono') return <Badge tone="green">Buono</Badge>;
  if (level === 'parziale') return <Badge tone="amber">Parziale</Badge>;
  return <Badge tone="red">Insufficiente</Badge>;
}

export function InputTable({ products }: { products: InputProduct[] }) {
  const [filter, setFilter] = useState<Filter>('tutti');

  const counts = useMemo(() => {
    return {
      tutti: products.length,
      validi: products.filter((p) => p.verificationStatus === 'eligible').length,
      parziali: products.filter((p) => p.level === 'parziale').length,
      esclusi: products.filter((p) => p.verificationStatus === 'excluded')
        .length,
      verifica: products.filter(
        (p) =>
          p.verificationStatus !== 'eligible' &&
          p.verificationStatus !== 'excluded',
      ).length,
    } satisfies Record<Filter, number>;
  }, [products]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'validi':
        return products.filter((p) => p.verificationStatus === 'eligible');
      case 'parziali':
        return products.filter((p) => p.level === 'parziale');
      case 'esclusi':
        return products.filter((p) => p.verificationStatus === 'excluded');
      case 'verifica':
        return products.filter(
          (p) =>
            p.verificationStatus !== 'eligible' &&
            p.verificationStatus !== 'excluded',
        );
      default:
        return products;
    }
  }, [products, filter]);

  if (products.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <PackageOpen className="h-8 w-8 text-gray-400" />
          <p className="text-sm text-gray-500">
            Nessun prodotto importato in questo batch.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs filtro */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
              filter === t.key
                ? 'border-brand-accent bg-brand-soft text-brand-accent'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-xs',
                filter === t.key
                  ? 'bg-brand-accent text-white'
                  : 'bg-gray-100 text-gray-500',
              )}
            >
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Identificativo</TH>
                <TH>Nome</TH>
                <TH>Tipo</TH>
                <TH>Fatti</TH>
                <TH>Qualità</TH>
                <TH>Stato</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((p) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs text-gray-600">
                    {p.identifier}
                  </TD>
                  <TD className="font-medium text-gray-900">{p.name}</TD>
                  <TD className="text-gray-600">{p.type}</TD>
                  <TD className="text-gray-600">{p.factCount}</TD>
                  <TD>{qualityBadge(p.level)}</TD>
                  <TD>
                    <StatusBadge status={p.verificationStatus} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-gray-500">
              Nessun prodotto in questa categoria.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
