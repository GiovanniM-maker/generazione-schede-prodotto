import { requireUser } from '@/lib/auth';
import { ProcessingMonitor } from '@/components/processing-monitor';

export const dynamic = 'force-dynamic';

export default async function ProcessingPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireUser();
  const { batchId } = await params;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Generazione in corso
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Puoi lasciare questa pagina: l’elaborazione continua in background.
        </p>
      </div>
      <ProcessingMonitor batchId={batchId} />
    </div>
  );
}
