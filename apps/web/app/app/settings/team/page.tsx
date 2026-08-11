import { requireUser, getUserOrg } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getTeam } from '@/lib/actions/team';
import { TeamClient } from '@/components/settings/team-client';
import { Avviso } from '@/components/ui/avviso';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const user = await requireUser();
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  const res = await getTeam();
  if (!res.ok) {
    return (
      <Avviso tono="errore">
        {res.error}
      </Avviso>
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
