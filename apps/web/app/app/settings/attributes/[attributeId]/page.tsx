import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getAttributeDetail } from '@/lib/actions/catalog';
import { AttributeDetailClient } from '@/components/settings/attribute-detail-client';

export const dynamic = 'force-dynamic';

export default async function AttributeDetailPage({
  params,
}: {
  params: Promise<{ attributeId: string }>;
}) {
  const { attributeId } = await params;
  const res = await getAttributeDetail({ attributeId });

  return (
    <div className="space-y-4">
      <Link
        href="/app/settings/attributes"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Tutti gli attributi
      </Link>
      {res.ok ? (
        <AttributeDetailClient detail={res.detail} />
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {res.error}
        </div>
      )}
    </div>
  );
}
