import {
  listAttributes,
  listCategories,
  listSectors,
} from '@/lib/actions/catalog';
import { AttributesClient } from '@/components/settings/attributes-client';

export const dynamic = 'force-dynamic';

export default async function AttributesPage({
  searchParams,
}: {
  searchParams: Promise<{ sector?: string }>;
}) {
  const { sector } = await searchParams;
  const [attrsRes, catsRes, sectorsRes] = await Promise.all([
    listAttributes({ sectorId: sector }),
    listCategories(),
    listSectors(),
  ]);

  if (!attrsRes.ok) return <ErrorState message={attrsRes.error} />;
  if (!catsRes.ok) return <ErrorState message={catsRes.error} />;
  if (!sectorsRes.ok) return <ErrorState message={sectorsRes.error} />;

  return (
    <AttributesClient
      initialAttributes={attrsRes.attributes}
      categories={catsRes.categories}
      sectors={sectorsRes.sectors}
      initialSectorId={sector}
    />
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}
