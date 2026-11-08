import Link from 'next/link';
import type { ReactNode } from 'react';
import { pct, rel } from '@/components/app/ui';
import { MarketIcon, QuestionCard, cardTitle } from '@/components/letters/question-card';
import { Seal } from '@/components/letters/seal';
import { Stamp } from '@/components/letters/stamp';
import { cn } from '@/lib/utils';
import { currentUser } from '@/src/auth/current';
import { kafkaLine } from '@/src/agents/views';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '@/src/markets/categories';
import { pickBoard, recentlyOpened } from '@/src/picks/board';
import { resolvedMarkets, stats } from '@/src/views';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Predict' };

export default async function Picks({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const q = (await searchParams).c;
  const cat = (CATEGORIES as readonly string[]).includes(q ?? '') ? (q as Category) : null;
  const me = await currentUser();
  const board = pickBoard(me?.profile?.handle ?? null);
  const shown = cat ? board.filter((c) => c.m.category === cat) : board;
  const open = shown.filter((c) => c.phase === 'open');
  const onSale = shown.filter((c) => c.phase !== 'open');
  const counts = new Map<string, number>();
  for (const c of board) counts.set(c.m.category, (counts.get(c.m.category) ?? 0) + 1);
  const opened = recentlyOpened(6);
  const kafkaCalls = resolvedMarkets(6);
  const s = stats();
  const k = kafkaLine();

  return (
    <div id="top" className="pb-4">
      <header className="flex flex-wrap items-end justify-between gap-6 pb-6 pt-10">
        <div>
          <h1 className="text-headline font-semibold">Predict</h1>
          <p className="mt-2 max-w-[58ch] text-body text-fg-2">
            Pick a side before the game. Others see your prediction when predictions close. Wins and misses both stay on your record.
          </p>
        </div>
        <dl className="flex gap-8">
          <Fact label="Open" value={String(board.filter((c) => c.phase === 'open').length)} />
          <Fact label="On Walrus" value={String(s.memories)} />
          <Fact label="0xkafka" value={k.n ? `${k.wins}–${k.n - k.wins}` : '—'} />
        </dl>
      </header>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label="Categories">
        <FilterChip href="/desk" active={!cat} label="All" n={board.length} />
        {CATEGORIES.filter((c) => counts.get(c)).map((c) => (
          <FilterChip key={c} href={`/desk?c=${c}`} active={cat === c} label={CATEGORY_LABEL[c]} n={counts.get(c) ?? 0} />
        ))}
      </nav>

      <section className="mt-6">
        <SectionHead title="Open now" note={open.length ? 'Closing soonest first' : undefined} />
        {open.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((c) => (
              <QuestionCard key={c.m.id} c={c} />
            ))}
          </div>
        ) : (
          <EmptyCard className="mt-4">No open questions here right now. 0xkafka lists new ones from Polymarket every 15 minutes.</EmptyCard>
        )}
      </section>

      {onSale.length ? (
        <section className="mt-12">
          <SectionHead title="Predictions closed" note="Waiting for the result" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {onSale.map((c) => (
              <QuestionCard key={c.m.id} c={c} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <ListCard title="Latest results" note="Everyone scored the same way">
          {opened.length ? (
            opened.map((o) => (
              <Row
                key={o.id}
                href={`/pick/${o.id}`}
                lead={<Seal seed={o.namespace} letter={o.display?.[0]} size={36} />}
                title={o.question ?? ''}
                sub={
                  <>
                    <span className="font-medium text-fg-2">{o.display}</span> took {o.prediction?.pick} at {pct(o.prediction?.confidence)}
                  </>
                }
                end={<Stamp kind={o.result?.win ? 'won' : 'missed'} size="sm" />}
              />
            ))
          ) : (
            <EmptyRow cta={{ href: '#top', label: 'Make the first prediction' }}>No prediction has resolved yet. Results land here, wins and misses, as games end.</EmptyRow>
          )}
        </ListCard>

        <ListCard
          title="0xkafka's last calls"
          note={
            <Link href="/mind" className="hover:text-fg">
              How it learns →
            </Link>
          }
        >
          {kafkaCalls.length ? (
            kafkaCalls.map((m) => {
              const won = m.outcome !== null && m.f_final !== null ? (m.f_final >= 0.5 ? 1 : 0) === m.outcome : null;
              const side = m.f_final === null ? null : m.f_final >= 0.5 ? m.outcome_a : m.outcome_b;
              const conf = m.f_final === null ? null : Math.max(m.f_final, 1 - m.f_final);
              return (
                <Row
                  key={m.id}
                  href={`/m/${m.id}`}
                  lead={<MarketIcon src={m.image} category={m.category} size={36} />}
                  title={cardTitle(m)}
                  sub={
                    <>
                      Said {side} at {pct(conf)} · {m.f_mode === 'backtest' ? 'replay' : rel(m.closed_at)}
                    </>
                  }
                  end={won === null ? null : <Stamp kind={won ? 'won' : 'missed'} size="sm" />}
                />
              );
            })
          ) : (
            <EmptyRow>0xkafka hasn&apos;t resolved a call yet.</EmptyRow>
          )}
        </ListCard>
      </section>
    </div>
  );
}

function FilterChip({ href, active, label, n }: { href: string; active: boolean; label: string; n: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-body-sm font-medium transition-colors',
        active ? 'border-transparent bg-action text-on-action' : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg',
      )}
    >
      {label}
      <span className={cn('num text-caption', active ? 'opacity-70' : 'text-fg-4')}>{n}</span>
    </Link>
  );
}

function SectionHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-title-1 font-semibold">{title}</h2>
      {note ? <span className="text-body-sm text-fg-3">{note}</span> : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-fg-3">{label}</dt>
      <dd className="num mt-0.5 text-title-1 font-semibold">{value}</dd>
    </div>
  );
}

function ListCard({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-4 px-5 pb-2 pt-5">
        <h2 className="text-title-2 font-semibold">{title}</h2>
        {note ? <span className="text-body-sm text-fg-3">{note}</span> : null}
      </div>
      <ul className="flex flex-1 flex-col px-2 pb-2">{children}</ul>
    </section>
  );
}

function Row({ href, lead, title, sub, end }: { href: string; lead: ReactNode; title: string; sub: ReactNode; end: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-3 transition-colors hover:bg-hover">
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium text-fg">{title}</span>
          <span className="mt-0.5 block truncate text-caption text-fg-3">{sub}</span>
        </span>
        {end}
      </Link>
    </li>
  );
}

function EmptyRow({ children, cta }: { children: ReactNode; cta?: { href: string; label: string } }) {
  return (
    <li className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-subtle text-fg-3" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="9" cy="9" r="6.5" />
          <path d="M9 5.5V9l2.3 1.6" />
        </svg>
      </span>
      <p className="max-w-[34ch] text-body-sm text-fg-3">{children}</p>
      {cta ? (
        <Link href={cta.href} className="text-body-sm font-semibold text-fg hover:underline">
          {cta.label} →
        </Link>
      ) : null}
    </li>
  );
}

function EmptyCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[var(--radius-md)] border border-dashed border-line-strong px-6 py-12 text-center text-body-sm text-fg-3', className)}>{children}</div>;
}
