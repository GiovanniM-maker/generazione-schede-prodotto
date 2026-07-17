import { redirect } from 'next/navigation';
import { IMAGE_NAMING_GUIDE } from '@app/core';
import { requireUser, getUserOrg } from '@/lib/auth';
import { BatchWizard } from '@/components/batch/wizard';

export const dynamic = 'force-dynamic';

export default async function NewBatchPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-gray-900">Nuovo batch</h1>
      <p className="mt-1 text-sm text-gray-500">
        Configura il batch passo dopo passo: preset, fonti, caricamento e verifica dei prodotti.
      </p>
      <div className="mt-6">
        <BatchWizard imageNamingGuide={IMAGE_NAMING_GUIDE} />
      </div>
    </div>
  );
}
