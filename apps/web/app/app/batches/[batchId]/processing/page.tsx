import { requireUser } from '@/lib/auth';
import { batchDiPagina } from '@/lib/batch-page';
import { PageShell } from '@/components/page-shell';
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
    <PageShell
      title="Generazione in corso"
      subtitle={`${batch.name} — puoi lasciare questa pagina: l’elaborazione continua in background.`}
    >
      <ProcessingMonitor batchId={batchId} />
    </PageShell>
  );
}
