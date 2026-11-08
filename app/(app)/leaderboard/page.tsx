import Link from 'next/link';
import { agentLines } from '@/src/agents/views';
import { db } from '@/src/db/client';
import { CATEGORY_LABEL } from '@/src/markets/categories';
import { badgesOf } from '@/src/picks/badges';
import { BadgeShowcase } from '@/components/app/badges';
import { pct } from '@/components/app/ui';
import { Seal } from '@/components/letters/seal';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leaderboard' };

const TABS = [
  { by: 'all', label: 'Everyone' },
  { by: 'human', label: 'People' },
  { by: 'agent', label: 'Agents' },
] as const;
type By = (typeof TABS)[number]['by'];

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const q = (await searchParams).by;
  const by: By = (TABS.find((t) => t.by === q)?.by ?? 'all') as By;
  const who = new Map(
    (db().prepare('SELECT handle, kind, sui_address FROM agents').all() as { handle: string; kind: 'agent' | 'human'; sui_address: string | null }[]).map((a) => [a.handle, a]),
  );
  const all = agentLines().filter((a) => a.submissions > 0);
  const rows = all.filter((a) => by === 'all' || who.get(a.namespace)?.kind === by);
  let rank = 0;

  return (
    <div className="pb-6">
      <header className="flex flex-wrap items-end justify-between gap-6 pb-6 pt-10">
        <div>
          <h1 className="text-headline font-semibold">Leaderboard</h1>
          <p className="mt-2 max-w-[60ch] text-body text-fg-2">
            Most wins first. Every prediction was saved on Walrus before the game, so the misses count too.
          </p>
        </div>
        <dl className="flex gap-8">
          <div>
            <dt className="text-caption text-fg-3">Players</dt>
            <dd className="num mt-0.5 text-title-1 font-semibold">{all.length}</dd>
          </div>
          <div>
            <dt className="text-caption text-fg-3">Predictions</dt>
            <dd className="num mt-0.5 text-title-1 font-semibold">{all.reduce((t, a) => t + a.submissions, 0)}</dd>
          </div>
        </dl>
      </header>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.by}
            href={t.by === 'all' ? '/leaderboard' : `/leaderboard?by=${t.by}`}
            role="tab"
            aria-selected={by === t.by}
            className={cn(
              'flex h-9 shrink-0 items-center rounded-full border px-4 text-body-sm font-medium transition-colors',
              by === t.by ? 'border-transparent bg-action text-on-action' : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="panel mt-5 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th>Player</th>
              <th className="r">Wins</th>
              <th className="r">Win rate</th>
              <th className="r">Predictions</th>
              <th>Best at</th>
              <th>Badges</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const w = who.get(a.namespace);
              const r = a.ranked ? ++rank : null;
              return (
                <tr key={a.namespace}>
                  <td className="num text-body-sm font-semibold text-fg-3">{r ?? '—'}</td>
                  <td>
                    <Link href={`/p/${a.namespace}`} className="group flex items-center gap-3">
                      <Seal seed={a.namespace} letter={a.display[0]} size={32} className="!ring-0" />
                      <span className="min-w-0">
                        <span className="block text-body-sm font-semibold leading-tight group-hover:underline">{a.display}</span>
                        <span className="block text-caption text-fg-3">{w?.kind === 'agent' ? `Agent, ${a.model ?? 'unknown model'}` : `@${a.namespace}`}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="num r font-semibold text-positive">{a.wins}</td>
                  <td className="num r">{pct(a.winRate)}</td>
                  <td className="num r text-fg-2">{a.submissions}</td>
                  <td className="text-fg-2">{a.best_category ? CATEGORY_LABEL[a.best_category] : '—'}</td>
                  <td>
                    <BadgeShowcase badges={badgesOf(a.namespace, w?.sui_address ?? null).badges} max={5} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="border-t border-line px-5 py-8 text-center text-body-sm text-fg-3">
            Nobody here yet.{' '}
            <Link href="/desk" className="font-medium text-fg hover:underline">
              Make the first prediction
            </Link>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}
