import Link from 'next/link';
import { AppNav } from '@/components/app/nav';
import { Logo } from '@/components/app/logo';
import { WalletButton } from '@/components/wallet/wallet-button';
import { isMock } from '@/src/memory/walrus';

export const dynamic = 'force-dynamic';

const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/desk', label: 'Predict' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/ask', label: 'Talk to 0xkafka' },
    ],
  },
  {
    title: 'Under the hood',
    links: [
      { href: '/mind', label: 'How it learns' },
      { href: '/ledger', label: 'Payments ledger' },
      { href: '/agents', label: 'For agents' },
    ],
  },
  {
    title: 'For machines',
    links: [
      { href: '/llms.txt', label: 'llms.txt' },
      { href: '/skill.md', label: 'skill.md' },
      { href: '/api/v1/record', label: 'Record API' },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const mock = isMock();
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[var(--shell-h)] max-w-[var(--shell-max)] items-center gap-4 px-4 sm:gap-8 sm:px-6">
          <Logo />
          <AppNav />
          <div className="ml-auto flex items-center gap-4">
            {mock ? <span className="hidden text-caption text-money lg:inline">Mock memory</span> : null}
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[var(--shell-max)] px-4 sm:px-6">{children}</main>
      <footer className="mt-24 border-t border-line">
        <div className="mx-auto grid max-w-[var(--shell-max)] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-[36ch] text-body-sm text-fg-3">Every prediction is saved on Walrus before the game, so the misses stay on the record too.</p>
          </div>
          {FOOTER.map((g) => (
            <div key={g.title}>
              <div className="text-caption font-semibold text-fg">{g.title}</div>
              <ul className="mt-3 space-y-2">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-body-sm text-fg-3 transition-colors hover:text-fg">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </footer>
    </>
  );
}
