import { requireUser } from '@/lib/auth';
import { MappingEditor } from '@/components/mapping-editor';

export const dynamic = 'force-dynamic';

export default async function MappingPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireUser();
  const { batchId } = await params;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-900">
        Mappatura delle colonne
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        Abbina le colonne del file ai campi del preset Moda. I campi non
        necessari possono essere ignorati.
      </p>
      <div className="mt-6">
        <MappingEditor batchId={batchId} />
      </div>
    </div>
  );
}
