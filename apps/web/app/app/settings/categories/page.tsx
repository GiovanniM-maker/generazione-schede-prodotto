import { listCategories, listSectors } from '@/lib/actions/catalog';
import { CategoriesClient } from '@/components/settings/categories-client';

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
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}
