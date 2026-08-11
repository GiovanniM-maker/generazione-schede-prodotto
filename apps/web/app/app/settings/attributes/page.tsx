import {
  listAttributes,
  listCategories,
  listSectors,
} from '@/lib/actions/catalog';
import { AttributesClient } from '@/components/settings/attributes-client';
import { Avviso } from '@/components/ui/avviso';

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
    <Avviso tono="errore">
      {message}
    </Avviso>
  );
}
