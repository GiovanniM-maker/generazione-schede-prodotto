import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getPresetDetail } from '@/lib/actions/catalog';
import { PresetDetailClient } from '@/components/settings/preset-detail-client';

export const dynamic = 'force-dynamic';

export default async function PresetDetailPage({
  params,
}: {
  params: Promise<{ presetId: string }>;
}) {
  const { presetId } = await params;
  const res = await getPresetDetail({ presetId });

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {res.error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BackLink />
      <PresetDetailClient detail={res.detail} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/app/settings/presets"
      className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
    >
      <ArrowLeft className="h-4 w-4" />
      Tutti i preset
    </Link>
  );
}
