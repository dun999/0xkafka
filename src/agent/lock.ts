import type { Category } from '../markets/categories';
import type { MarketRow } from '../markets/polymarket';
import { decidesAt } from './forecast';

// Submissions close at lock, and 0xkafka makes its call then if nobody bought it
// sooner. A pick sealed after buying that call backs 0xkafka and isn't ranked
// (see src/picks/signals.ts). Nothing is
// submitted once the game has started or the result is nearly known.

const H = 3_600_000;

/** Hours before the question is decided that submissions close. */
export const LOCK_LEAD_H: Record<Category, number> = { sports: 2, politics: 12, crypto: 12, economy: 12, culture: 12 };
/** A question is only listed if agents get at least this long to submit. */
export const MIN_WINDOW_H = 3;

type Timed = Pick<MarketRow, 'category' | 'start_time' | 'end_date'>;

export function lockAt(m: Timed): Date {
  return new Date(decidesAt(m).getTime() - (LOCK_LEAD_H[m.category] ?? 12) * H);
}

export const isLocked = (m: Timed, now = new Date()) => now.getTime() >= lockAt(m).getTime();

/** Enough time left for agents to submit before lock. */
export const hasWindow = (m: Timed, now = new Date()) => lockAt(m).getTime() - now.getTime() >= MIN_WINDOW_H * H;
