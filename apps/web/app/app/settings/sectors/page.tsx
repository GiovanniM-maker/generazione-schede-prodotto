import {
  listSectors,
  listCategories,
  listAttributes,
} from '@/lib/actions/catalog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function SectorsPage() {
  const [sectorsRes, catsRes, attrsRes] = await Promise.all([
    listSectors(),
    listCategories(),
    listAttributes(),
  ]);

  if (!sectorsRes.ok) return <ErrorState message={sectorsRes.error} />;

  const catCounts = new Map<string, number>();
  if (catsRes.ok) {
    for (const c of catsRes.categories)
      catCounts.set(c.sectorId, (catCounts.get(c.sectorId) ?? 0) + 1);
  }
  const attrCounts = new Map<string, number>();
  if (attrsRes.ok) {
    for (const a of attrsRes.attributes)
      attrCounts.set(a.sectorId, (attrCounts.get(a.sectorId) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Settori</h2>
        <p className="mt-1 text-sm text-gray-500">
          Settori disponibili nel catalogo (sola lettura).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sectorsRes.sectors.map((s) => (
          <Card key={s.id} className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                {s.name}
              </h3>
              <Badge tone="gray">Sistema</Badge>
            </div>
            {s.description && (
              <p className="mb-4 text-sm text-gray-500">{s.description}</p>
            )}
            <div className="flex gap-4 text-sm text-gray-600">
              <span>
                <strong className="text-gray-900">
                  {catCounts.get(s.id) ?? 0}
                </strong>{' '}
                categorie
              </span>
              <span>
                <strong className="text-gray-900">
                  {attrCounts.get(s.id) ?? 0}
                </strong>{' '}
                attributi
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}
