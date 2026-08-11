import { redirect } from 'next/navigation';
import { IMAGE_NAMING_GUIDE } from '@app/core';
import { requireUser, getUserOrg } from '@/lib/auth';
import { BatchWizard } from '@/components/batch/wizard';
import { PageShell } from '@/components/page-shell';

export const dynamic = 'force-dynamic';

export default async function NewBatchPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  return (
    <PageShell
      title="Nuovo batch"
      subtitle="Configura il batch passo dopo passo: preset, fonti, caricamento e verifica dei prodotti."
    >
      <BatchWizard imageNamingGuide={IMAGE_NAMING_GUIDE} />
    </PageShell>
  );
}
