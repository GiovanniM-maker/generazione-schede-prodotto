import { requireUser, getUserOrg } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AccountClient } from '@/components/settings/account-client';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  return (
    <AccountClient email={user.email ?? ''} isOwner={org.role === 'owner'} />
  );
}
