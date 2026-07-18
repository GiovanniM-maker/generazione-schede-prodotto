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
  { href: '/app/settings/storico', label: 'Storico', icon: History },
  { href: '/app/settings/team', label: 'Team', icon: Users },
  { href: '/app/settings/integrations', label: 'Integrazioni', icon: Plug },
  { href: '/app/settings/account', label: 'Account', icon: UserCog },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-accent/10 text-brand-accent'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
