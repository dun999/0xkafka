import Link from 'next/link';
import { notFound } from 'next/navigation';
import { toHandle } from '@/src/agents/store';
import { currentUser } from '@/src/auth/current';
import { db } from '@/src/db/client';
import { CATEGORY_LABEL, type Category } from '@/src/markets/categories';
import { isMock } from '@/src/memory/walrus';
import { badgesOf, type Badge, type Streak } from '@/src/picks/badges';
import { dossierOf, type Dossier } from '@/src/picks/dossier';
import { BadgeGrid, BadgeShowcase, StreakFlame } from '@/components/app/badges';
import { BlobLink, day, rel } from '@/components/app/ui';
import { LetterRow } from '@/components/letters/letter';
import { ProfileEditor } from '@/components/letters/profile-editor';
import { headlineOf } from '@/components/letters/question-card';
import { Seal } from '@/components/letters/seal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const h = toHandle(decodeURIComponent((await params).handle));
  const d = h ? dossierOf(h, { handle: null, address: null }) : null;
  if (!d) return { title: 'Profile' };
  const r = d.record;
  return {
    title: d.profile.display,
    description: `${d.profile.display} on 0xkafka: ${r.wins} won of ${r.n} predictions. Every prediction saved on Walrus before the game.`,
  };
}


export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const handle = toHandle(decodeURIComponent((await params).handle));
  const me = await currentUser();
  const viewer = { handle: me?.profile?.handle ?? null, address: me?.session.address ?? null };
  const d = handle ? dossierOf(handle, viewer) : null;
  if (!d) notFound();
  const mock = isMock();
  const no = (db().prepare('SELECT COUNT(*) n FROM agents WHERE created_at <= ?').get(d.profile.since) as { n: number }).n;
  const { badges, streak } = badgesOf(d.profile.handle, d.profile.sui_address);

  return (
    <div className="pb-6 pt-8">
      <DossierCard d={d} no={no} mock={mock} streak={streak} badges={badges} />
      <BadgesPanel badges={badges} owner={d.is_owner} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <ListSection
            title="Open predictions"
            count={d.sealed.length}
            note={d.sealed.length ? 'Hidden from others until predictions close' : undefined}
          >
            {d.sealed.length ? (
              <ul className="divide-y divide-line">
                {d.sealed.map((l) => (
                  <LetterRow key={l.id} l={l} phase={l.phase} mock={mock} about={{ href: `/m/${l.market_id}`, title: headlineOf(l) }} />
                ))}
              </ul>
            ) : (
              <Empty>
                {d.is_owner ? (
                  <>
                    Nothing open right now.{' '}
                    <Link href="/desk" className="font-medium text-fg hover:underline">
                      Make a prediction →
                    </Link>
                  </>
                ) : (
                  'Nothing open right now.'
                )}
              </Empty>
            )}
          </ListSection>

          <ListSection title="Results" count={d.archive.length} note="Wins and misses both stay">
            {d.archive.length ? (
              <ul className="divide-y divide-line">
                {d.archive.map((l) => (
                  <LetterRow key={l.id} l={l} phase={l.phase} mock={mock} about={{ href: `/pick/${l.id}`, title: headlineOf(l) }} />
                ))}
              </ul>
            ) : (
              <Empty>No results yet. Predictions land here when their games end.</Empty>
            )}
          </ListSection>
        </div>

        <aside className="space-y-6">
          {d.is_owner ? (
            <section className="panel p-5">
              <div className="text-body font-semibold">Ask about your record</div>
              <p className="mt-1 text-body-sm text-fg-2">0xkafka reads your predictions and results from Walrus and tells you where you have an edge.</p>
              <Button href="/ask" variant="primary" className="mt-4 w-full">
                Talk to 0xkafka
              </Button>
            </section>
          ) : null}

          <section className="panel p-5">
            <div className="text-body font-semibold">0xkafka remembers</div>
            <p className="mt-1 text-caption text-fg-3">
              Encrypted on Walrus mainnet in <span className="mono text-memory">{d.profile.walrus_namespace}</span>, recalled when you talk to 0xkafka.
            </p>
            {d.remembered.length ? (
              <ol className="mt-4 space-y-4">
                {d.remembered.map((r) => (
                  <li key={r.id}>
                    <p className="text-body-sm leading-snug text-fg-2">{r.text}</p>
                    <div className="mt-1 flex items-center gap-3 text-caption text-fg-4">
                      <span>{rel(r.at)}</span>
                      <BlobLink blob={r.blob} mock={r.mock} />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 rounded-[var(--radius-sm)] bg-subtle px-4 py-4 text-body-sm text-fg-3">Nothing yet. The first memory is written with your first prediction.</p>
            )}
          </section>

          <ByCategory d={d} />
        </aside>
      </div>
    </div>
  );
}


function DossierCard({ d, no, mock, streak, badges }: { d: Dossier; no: number; mock: boolean; streak: Streak; badges: Badge[] }) {
  const r = d.record;
  const p = d.profile;
  const total = d.sealed.length + d.archive.length;
  return (
    <section className="panel">
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start">
        <Seal seed={p.handle} letter={p.display[0]} size={88} className="!ring-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-headline font-semibold">{p.display}</h1>
            <BadgeShowcase badges={badges} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-fg-3">
            <span>@{p.handle}</span>
            <span>Joined {day(p.since).replace(/,? \d\d:\d\d$/, '')}</span>
            <span>Player #{no}</span>
            {d.rank ? <span className="font-medium text-fg-2">#{d.rank} on the leaderboard</span> : null}
          </div>
          {p.bio ? <p className="mt-3 max-w-[60ch] text-body text-fg-2">{p.bio}</p> : null}
          {d.is_owner ? (
            <div className="mt-3">
              <ProfileEditor bio={p.bio} />
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 text-caption text-fg-3 sm:pt-2">
          Memory on Walrus <BlobLink blob={r.walrus.latest_blob} mock={mock} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[var(--radius-md)] border-t border-line bg-line lg:grid-cols-4">
        <Fact label="Win rate" value={r.n && r.winRate !== null ? `${Math.round(r.winRate * 100)}%` : '—'} sub={r.n ? `${r.wins} won of ${r.n} resolved` : 'No results yet'} tone={r.n ? 'positive' : undefined} />
        <Fact label="Predictions" value={String(total)} sub={d.sealed.length ? `${d.sealed.length} still open` : 'All resolved'} />
        <div className="bg-surface px-5 py-4">
          <dt className="text-caption text-fg-3">Day streak</dt>
          <dd className="mt-1 flex items-center gap-2">
            <StreakFlame streak={streak} size={30} />
            <span className="num text-title-1 font-semibold">{streak.current}</span>
          </dd>
          <div className="mt-0.5 truncate text-caption text-fg-4">
            {streak.current && !streak.activeToday ? 'Play today to keep it' : streak.best > streak.current ? `Best ${streak.best}` : 'Predict or ask daily'}
          </div>
        </div>
        <Fact label="Memories" value={String(r.walrus.memories)} sub={r.walrus.queued ? `${r.walrus.queued} being written to Walrus` : 'Stored on Walrus'} tone="memory" />
      </dl>
    </section>
  );
}

function BadgesPanel({ badges, owner }: { badges: Badge[]; owner: boolean }) {
  const earned = badges.filter((b) => b.done).length;
  const next = badges.filter((b) => !b.done).sort((a, b) => b.progress / b.goal - a.progress / a.goal)[0];
  return (
    <section className="panel mt-6 p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-title-2 font-semibold">
          Badges <span className="num text-body font-normal text-fg-3">{earned} of {badges.length} earned</span>
        </div>
        {next ? (
          <div className="text-caption text-fg-3">
            {owner ? 'Next up' : 'Closest'}: <span className="font-medium text-fg-2">{next.name}</span>, {next.how.charAt(0).toLowerCase() + next.how.slice(1)}
            {next.goal > 1 ? ` (${next.progress}/${next.goal})` : ''}
          </div>
        ) : null}
      </div>
      <BadgeGrid badges={badges} />
    </section>
  );
}

function ByCategory({ d }: { d: Dossier }) {
  const cats = db()
    .prepare(
      `SELECT category, COUNT(*) n, SUM(win) wins FROM submissions WHERE handle = ? AND status = 'scored' AND win IS NOT NULL AND backs IS NULL GROUP BY category ORDER BY n DESC`,
    )
    .all(d.profile.handle) as { category: Category; n: number; wins: number }[];
  if (!cats.length) return null;
  return (
    <section className="panel p-5">
      <div className="text-body font-semibold">By category</div>
      <ul className="mt-4 space-y-3">
        {cats.map((c) => (
          <li key={c.category} className="text-body-sm">
            <div className="flex items-center justify-between">
              <span>{CATEGORY_LABEL[c.category] ?? c.category}</span>
              <span className="num text-fg-3">
                {c.wins}–{c.n - c.wins}
              </span>
            </div>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full rounded-full bg-positive" style={{ width: `${Math.round((c.wins / c.n) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ListSection({ title, count, note, children }: { title: string; count: number; note?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-1 pt-5">
        <h2 className="text-title-2 font-semibold">
          {title} <span className="num font-normal text-fg-3">{count}</span>
        </h2>
        {note ? <span className="text-body-sm text-fg-3">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pb-8 pt-6 text-center text-body-sm text-fg-3">{children}</p>;
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'positive' | 'money' | 'memory' }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-caption text-fg-3">{label}</dt>
      <dd className={cn('num mt-1 truncate text-title-1 font-semibold', tone === 'positive' && 'text-positive', tone === 'money' && 'text-money', tone === 'memory' && 'text-memory')}>
        {value}
      </dd>
      {sub ? <div className="mt-0.5 truncate text-caption text-fg-4">{sub}</div> : null}
    </div>
  );
}
