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
      {/* Era un `<h1>` da 12px grigio a 2,40:1 — il testo meno leggibile dello
          schermo, più piccolo dell'`<h2>` sotto di lui, e per giunta l'unico
          titolo semantico della pagina: il vero titolo («Preset», «Categorie»)
          era un `<h2>`. Adesso è quello che è sempre stato, cioè l'etichetta di
          una navigazione, e il titolo vero è un `<h1>`. */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Configurazione catalogo
        </p>
        <SettingsNav aria-label="Configurazione catalogo" />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
