import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getCategoryDetail } from '@/lib/actions/catalog';
import { CategoryDetailClient } from '@/components/settings/category-detail-client';

export const dynamic = 'force-dynamic';

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;
  const res = await getCategoryDetail({ categoryId });

  return (
    <div className="space-y-4">
      <Link
        href="/app/settings/categories"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Tutte le categorie
      </Link>
      {res.ok ? (
        <CategoryDetailClient detail={res.detail} />
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {res.error}
        </div>
      )}
    </div>
  );
}
