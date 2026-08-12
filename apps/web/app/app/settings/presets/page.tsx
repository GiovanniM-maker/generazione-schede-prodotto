import { listPresets, listSectors } from '@/lib/actions/catalog';
import { PresetsClient } from '@/components/settings/presets-client';
import { Avviso } from '@/components/ui/avviso';

export const dynamic = 'force-dynamic';

export default async function PresetsPage() {
  const [presetsRes, sectorsRes] = await Promise.all([
    listPresets(),
    listSectors(),
  ]);

  if (!presetsRes.ok) {
    return <ErrorState message={presetsRes.error} />;
  }
  if (!sectorsRes.ok) {
    return <ErrorState message={sectorsRes.error} />;
  }

  return (
    <PresetsClient presets={presetsRes.presets} sectors={sectorsRes.sectors} />
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Avviso tono="errore">
      {message}
    </Avviso>
  );
}
