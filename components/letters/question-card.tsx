import Link from 'next/link';
import { Countdown } from '@/components/fx/motion';
import { Seal } from '@/components/letters/seal';
import { CATEGORY_LABEL, type Category } from '@/src/markets/categories';
import type { BoardCard } from '@/src/picks/board';
import { headline } from '@/src/picks/share';
import { cn } from '@/lib/utils';

/** The headline of a question: "Lakers vs. Celtics" when the event has one, else the question. */
export const headlineOf = headline;

const isYesNo = (m: { outcome_a: string; outcome_b: string }) => /^yes$/i.test(m.outcome_a) && /^no$/i.test(m.outcome_b);

/** On a card, a yes/no question reads as itself ("Will Liverpool win?"); a two-sided one as its event ("Lions vs. Dolphins"). */
export function cardTitle(m: { event_title: string | null; question: string; outcome_a: string; outcome_b: string }) {
  return isYesNo(m) ? m.question : headline(m);
}

const kickoff = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false });

/** A market's icon: its Polymarket image, or the first letter of its category. */
export function MarketIcon({ src, category, size = 44 }: { src: string | null; category: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-[10px] bg-subtle object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-[10px] bg-subtle text-body font-semibold text-fg-3" style={{ width: size, height: size }}>
      {category.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * A question on the board. Every card has the same slots in the same places:
 * icon and a two-line title, the two sides as buttons, then who sealed and when picks close.
 */
export function QuestionCard({ c }: { c: BoardCard }) {
  const { m } = c;
  const title = cardTitle(m);
  const p = m.price;
  const open = c.phase === 'open';
  const sides = [
    { k: 'a', name: m.outcome_a, q: p },
    { k: 'b', name: m.outcome_b, q: p === null ? null : 1 - p },
  ] as const;

  return (
    <article className="envelope group flex h-full flex-col p-4">
      <div className="flex items-start gap-3">
        <MarketIcon src={m.image} category={m.category} />
        <h3 className="line-clamp-2 min-h-[2.7em] flex-1 text-title-3 font-semibold leading-[1.35]">
          <Link href={`/m/${m.id}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-md)] after:content-['']">
            {title}
          </Link>
        </h3>
      </div>

      <div className="relative z-10 mt-4 grid grid-cols-2 gap-2">
        {sides.map((s) => (
          <Link
            key={s.k}
            href={`/m/${m.id}?side=${s.k}`}
            className={cn(
              'flex h-10 items-center justify-between gap-2 rounded-[var(--radius-sm)] px-3 text-body-sm font-semibold transition-colors',
              s.k === 'a' ? 'bg-side-a-subtle text-side-a hover:bg-side-a-solid hover:text-white' : 'bg-side-b-subtle text-side-b hover:bg-side-b-solid hover:text-white',
            )}
          >
            <span className="truncate">{s.name}</span>
            <span className="num shrink-0 opacity-80">{s.q === null ? '—' : `${Math.round(s.q * 100)}%`}</span>
          </Link>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-caption text-fg-3">
        <span className="flex min-w-0 items-center gap-2">
          {c.n ? (
            <span className="flex -space-x-1.5">
              {c.sealers.slice(0, 3).map((s) => (
                <Seal key={s.handle} seed={s.handle} letter={s.display[0]} size={20} />
              ))}
            </span>
          ) : null}
          <span className="truncate">
            {c.mine ? <span className="font-medium text-seal">You predicted, </span> : null}
            {c.n ? `${c.n} predicted` : (CATEGORY_LABEL[m.category as Category] ?? m.category)}, {kickoff(c.decides_at)}
          </span>
        </span>
        <span className="shrink-0 font-medium text-fg-2">
          {open ? (
            <>
              closes in <Countdown to={c.lock_at} short className="num" />
            </>
          ) : (
            'closed'
          )}
        </span>
      </div>
    </article>
  );
}
