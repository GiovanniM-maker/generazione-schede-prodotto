'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers, FolderTree, Tags, Grid3x3, Plug, History, Users, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/app/settings/presets', label: 'Preset', icon: Layers },
  { href: '/app/settings/categories', label: 'Categorie', icon: FolderTree },
  { href: '/app/settings/attributes', label: 'Attributi', icon: Tags },
  { href: '/app/settings/sectors', label: 'Settori', icon: Grid3x3 },
  { href: '/app/settings/activity', label: 'Storico', icon: History },
  { href: '/app/settings/team', label: 'Team', icon: Users },
  { href: '/app/settings/integrations', label: 'Integrazioni', icon: Plug },
  { href: '/app/settings/account', label: 'Account', icon: UserCog },
];

export function SettingsNav({ 'aria-label': ariaLabel }: { 'aria-label'?: string } = {}) {
  const pathname = usePathname();
  return (
    // ---------------------------------------------------------------------
    // Su telefono è una striscia che scorre, non una colonna.
    //
    // Da colonna misurava 358×344 px in cima a tutte e nove le pagine della
    // configurazione, `position: static` e senza modo di chiuderla: il titolo
    // della pagina cominciava al **56% dell'altezza dello schermo**. Metà
    // schermata, ogni volta, per un menu che si legge una volta sola.
    //
    // Da `lg` torna colonna, dove lo spazio orizzontale c'è e la colonna è la
    // forma giusta. `overflow-x-auto` scorre DENTRO di sé — la pagina non si
    // allarga (c'è un test che lo verifica a 320/360/390/768).
    // ---------------------------------------------------------------------
    <nav
      aria-label={ariaLabel}
      className="-mx-4 flex snap-x gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:snap-none lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex shrink-0 snap-start items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:shrink',
              active
                ? 'bg-brand-accent/10 text-brand-accent'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
