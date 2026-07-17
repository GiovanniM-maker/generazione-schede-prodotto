import { redirect } from 'next/navigation';
import { requireUser, getUserOrg } from '@/lib/auth';
import { NewBatchFlow } from '@/components/new-batch-flow';

export const dynamic = 'force-dynamic';

export default async function NewBatchPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900">Nuovo batch</h1>
      <p className="mt-1 text-sm text-gray-500">
        Dai un nome al batch e carica il file del catalogo.
      </p>
      <div className="mt-6">
        <NewBatchFlow organizationId={org.organizationId} />
      </div>
    </div>
  );
}
