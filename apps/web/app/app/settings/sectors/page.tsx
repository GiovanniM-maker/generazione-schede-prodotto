import {
  listSectors,
  listCategories,
  listAttributes,
} from '@/lib/actions/catalog';
import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/page-shell';
import { Badge } from '@/components/ui/badge';
import { Avviso } from '@/components/ui/avviso';

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
    <PageShell
      title="Settori"
      subtitle="Settori disponibili nel catalogo (sola lettura)."
    >

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sectorsRes.sectors.map((s) => (
          <Card key={s.id} className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink-900">
                {s.name}
              </h3>
              <Badge tone="gray">Sistema</Badge>
            </div>
            {s.description && (
              <p className="mb-4 text-sm text-ink-500">{s.description}</p>
            )}
            <div className="flex gap-4 text-sm text-ink-600">
              <span>
                <strong className="text-ink-900">
                  {catCounts.get(s.id) ?? 0}
                </strong>{' '}
                categorie
              </span>
              <span>
                <strong className="text-ink-900">
                  {attrCounts.get(s.id) ?? 0}
                </strong>{' '}
                attributi
              </span>
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Avviso tono="errore">
      {message}
    </Avviso>
  );
}
