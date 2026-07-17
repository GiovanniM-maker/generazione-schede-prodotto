import { redirect } from 'next/navigation';
import { requireUser, getUserOrg } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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

  const supabase = await createSupabaseServerClient();
  const { data: batch } = await supabase
    .from('batches')
    .select('id, name, brand_profile_version_id')
    .eq('id', batchId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Tono e campione
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Genera un campione gratuito per verificare il tono prima della
          generazione in massa.
        </p>
      </div>
      <SampleRunner
        batchId={batchId}
        organizationId={org.organizationId}
        hasProfile={Boolean(batch?.brand_profile_version_id)}
      />
    </div>
  );
}
