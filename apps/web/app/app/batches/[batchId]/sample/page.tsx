import { redirect } from 'next/navigation';
import { requireUser, getUserOrg } from '@/lib/auth';
import { batchDiPagina } from '@/lib/batch-page';
import { PageShell } from '@/components/page-shell';
import { SampleRunner } from '@/components/sample-runner';

export const dynamic = 'force-dynamic';

export default async function SamplePage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const user = await requireUser();
  const { batchId } = await params;
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  // Leggeva il batch ma non guardava se c'era: `batch?.brand_profile_version_id`
  // su `undefined` dava semplicemente «nessun profilo», e la pagina si apriva
  // uguale per un batch inesistente.
  const batch = await batchDiPagina(batchId);

  return (
    <PageShell
      title="Tono e campione"
      subtitle={`${batch.name} — genera un campione gratuito per verificare il tono prima della generazione in massa.`}
    >
      <SampleRunner
        batchId={batchId}
        organizationId={org.organizationId}
        hasProfile={Boolean(batch.brandProfileVersionId)}
      />
    </PageShell>
  );
}
