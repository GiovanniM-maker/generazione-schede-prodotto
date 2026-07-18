import { requireUser, getUserOrg } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getTeam } from '@/lib/actions/team';
import { TeamClient } from '@/components/settings/team-client';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  const res = await getTeam();
  if (!res.ok) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {res.error}
      </div>
    );
  }

  return (
    <TeamClient
      members={res.data.members}
      invites={res.data.invites}
      isOwner={res.data.isOwner}
    />
  );
}
