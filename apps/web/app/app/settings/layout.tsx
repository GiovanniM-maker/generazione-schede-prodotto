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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr] lg:gap-8">
      {/* Era un `<h1>` da 12px grigio a 2,40:1 — il testo meno leggibile dello
          schermo, più piccolo dell'`<h2>` sotto di lui, e per giunta l'unico
          titolo semantico della pagina: il vero titolo («Preset», «Categorie»)
          era un `<h2>`. Adesso è quello che è sempre stato, cioè l'etichetta di
          una navigazione, e il titolo vero è un `<h1>`. */}
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        {/* L'etichetta serve alla colonna, non alla striscia: su telefono il
            menu è già sotto il titolo della sezione, e una riga in più di
            maiuscoletto è spazio tolto al contenuto. Il nome resta comunque
            annunciato, perché è l'`aria-label` della navigazione. */}
        <p className="mb-3 hidden px-3 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:block">
          Configurazione catalogo
        </p>
        <SettingsNav aria-label="Configurazione catalogo" />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
