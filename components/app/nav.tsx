'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const APP_NAV = [
  { href: '/desk', label: 'Predict', match: ['/desk', '/m/', '/pick/'] },
  { href: '/leaderboard', label: 'Leaderboard', match: ['/leaderboard'] },
  { href: '/ask', label: 'Talk', match: ['/ask'] },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Product">
      {APP_NAV.map((n) => {
        const active = n.match.some((m) => path === m || path.startsWith(m.endsWith('/') ? m : `${m}/`) || path === n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center rounded-full px-3.5 text-body-sm font-medium transition-colors',
              active ? 'bg-subtle text-fg' : 'text-fg-3 hover:text-fg',
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
