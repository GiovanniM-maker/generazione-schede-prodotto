import { listCategories, listSectors } from '@/lib/actions/catalog';
import { CategoriesClient } from '@/components/settings/categories-client';
import { Avviso } from '@/components/ui/avviso';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const [catsRes, sectorsRes] = await Promise.all([
    listCategories(),
    listSectors(),
  ]);

  if (!catsRes.ok) return <ErrorState message={catsRes.error} />;
  if (!sectorsRes.ok) return <ErrorState message={sectorsRes.error} />;

  return (
    <CategoriesClient
      categories={catsRes.categories}
      sectors={sectorsRes.sectors}
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
