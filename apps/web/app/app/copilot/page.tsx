import { listSectors } from '@/lib/actions/catalog';
import { CopilotPageClient } from '@/components/copilot/copilot-page-client';
import type { CopilotEntityType } from '@app/core';

export const dynamic = 'force-dynamic';

export default async function CopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; sector?: string }>;
}) {
  const { entity, sector } = await searchParams;
  const entityType: CopilotEntityType = entity === 'category' ? 'category' : 'attribute';
  const sectorsRes = await listSectors();
  const sectors = sectorsRes.ok ? sectorsRes.sectors : [];

  return (
    <CopilotPageClient
      initialEntityType={entityType}
      initialSectorId={sector}
      sectors={sectors}
    />
  );
}
