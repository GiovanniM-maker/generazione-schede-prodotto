import { requireUser } from '@/lib/auth';
import { SettingsNav } from '@/components/settings/settings-nav';

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <h1 className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Configurazione catalogo
        </h1>
        <SettingsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
