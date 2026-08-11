import { requireUser } from '@/lib/auth';
import { batchDiPagina } from '@/lib/batch-page';
import { ProcessingMonitor } from '@/components/processing-monitor';

export const dynamic = 'force-dynamic';

export default async function ProcessingPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireUser();
  const { batchId } = await params;
  // Senza questo controllo la pagina diceva «Generazione in corso» per un
  // batch che non esiste, e continuava a dirlo per sempre.
  const batch = await batchDiPagina(batchId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Generazione in corso
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {batch.name} — puoi lasciare questa pagina: l’elaborazione continua in
          background.
        </p>
      </div>
      <ProcessingMonitor batchId={batchId} />
    </div>
  );
}
