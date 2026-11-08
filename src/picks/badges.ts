import { normalizeSuiAddress } from '@mysten/sui/utils';
import { nsName, profileNs } from '../config';
import { db } from '../db/client';
import { askedTimes } from '../chat/store';

// Badges and the daily streak: a reason to come back. Earned from what a person
// actually did: predictions, results, questions to 0xkafka, signals bought,
// memories on Walrus. Predictions copied from a bought signal count for
// activity, not for skill.

export type BadgeArt =
  | 'first'
  | 'sports'
  | 'globe'
  | 'target'
  | 'flame'
  | 'underdog'
  | 'gem'
  | 'roll'
  | 'regular'
  | 'insider'
  | 'talker'
  | 'walrus';

export interface Badge {
  id: BadgeArt;
  name: string;
  /** How to earn it, in one line. */
  how: string;
  goal: number;
  progress: number;
  done: boolean;
  /** When it was earned, as near as the record says. */
  at: string | null;
}

export interface Activity {
  picks: { category: string; at: string; win: boolean | null; scored_at: string | null; confidence: number; market_side: number | null; backs: boolean }[];
  /** When each memory landed on Walrus. */
  memories: string[];
  /** One timestamp per question asked in chat. */
  asked: string[];
  /** Times they bought 0xkafka's signal. */
  bought: string[];
}

export interface Streak {
  /** Days in a row with any activity, ending today or yesterday (UTC). */
  current: number;
  best: number;
  activeToday: boolean;
}

const dayOf = (iso: string) => iso.slice(0, 10);

/** Consecutive UTC days with activity. */
export function dailyStreak(times: string[], now = new Date()): Streak {
  const days = [...new Set(times.map(dayOf))].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  const today = dayOf(now.toISOString());
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000).toISOString());
  const last = days.at(-1);
  const current = last === today || last === yesterday ? run : 0;
  return { current, best, activeToday: last === today };
}

/** The longest run of wins, in the order picks resolved. */
export function bestWinRun(results: { win: boolean; at: string }[]): number {
  let best = 0;
  let run = 0;
  for (const r of [...results].sort((a, b) => a.at.localeCompare(b.at))) {
    run = r.win ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

const nth = (times: string[], n: number) => [...times].sort()[n - 1] ?? null;

/** The day a run of consecutive active days first reached n. */
function streakReached(times: string[], n: number): string | null {
  const days = [...new Set(times.map(dayOf))].sort();
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    prev = t;
    if (run >= n) return `${d}T23:59:59Z`;
  }
  return null;
}

export function badgesFrom(a: Activity, now = new Date()): { badges: Badge[]; streak: Streak } {
  const own = a.picks.filter((p) => !p.backs);
  const results = own.filter((p) => p.win !== null).map((p) => ({ win: p.win === true, at: p.scored_at ?? p.at }));
  const wins = own.filter((p) => p.win === true);
  const winAt = (ps: typeof wins) => ps.map((p) => p.scored_at ?? p.at);
  const active = [...a.picks.map((p) => p.at), ...a.asked, ...a.bought];
  const streak = dailyStreak(active, now);
  const sports = a.picks.filter((p) => p.category === 'sports').map((p) => p.at);
  const firstOfCat = [...new Map([...a.picks].sort((x, y) => x.at.localeCompare(y.at)).reverse().map((p) => [p.category, p.at])).values()];
  let run = 0;
  let hotAt: string | null = null;
  for (const r of [...results].sort((x, y) => x.at.localeCompare(y.at))) {
    run = r.win ? run + 1 : 0;
    if (run >= 3 && !hotAt) hotAt = r.at;
  }
  const b = (id: BadgeArt, name: string, how: string, goal: number, progress: number, at: string | null): Badge => ({
    id,
    name,
    how,
    goal,
    progress: Math.min(goal, progress),
    done: progress >= goal,
    at: progress >= goal ? at : null,
  });
  const underdogs = wins.filter((p) => p.market_side !== null && p.market_side < 0.4);
  const sure = wins.filter((p) => p.confidence >= 0.85);
  const badges = [
    b('first', 'First call', 'Make your first prediction', 1, a.picks.length, nth(a.picks.map((p) => p.at), 1)),
    b('sports', 'Sports fan', 'Make 3 sports predictions', 3, sports.length, nth(sports, 3)),
    b('globe', 'All-rounder', 'Predict in 3 categories', 3, firstOfCat.length, nth(firstOfCat, 3)),
    b('target', 'Called it', 'Win a prediction', 1, wins.length, nth(winAt(wins), 1)),
    b('flame', 'Hot hand', 'Win 3 in a row', 3, bestWinRun(results), hotAt),
    b('underdog', 'Underdog', 'Win one the market gave under 40%', 1, underdogs.length, nth(winAt(underdogs), 1)),
    b('gem', 'Sure thing', 'Win one you were 85% or more sure of', 1, sure.length, nth(winAt(sure), 1)),
    b('roll', 'On a roll', 'Play 3 days in a row', 3, streak.best, streakReached(active, 3)),
    b('regular', 'Regular', 'Play 7 days in a row', 7, streak.best, streakReached(active, 7)),
    b('insider', 'Insider', "Buy 0xkafka's signal", 1, a.bought.length, nth(a.bought, 1)),
    b('talker', 'Talker', 'Ask 0xkafka 10 questions', 10, a.asked.length, nth(a.asked, 10)),
    b('walrus', 'Walrus', 'Have 10 memories on Walrus', 10, a.memories.length, nth(a.memories, 10)),
  ];
  return { badges, streak };
}

/** Everything a profile has done, from the database. */
export function activityOf(handle: string, address: string | null): Activity {
  const picks = (
    db()
      .prepare(`SELECT category, submitted_at at, win, scored_at, confidence, pick_a, market_p, backs, status FROM submissions WHERE handle = ?`)
      .all(handle) as { category: string; at: string; win: number | null; scored_at: string | null; confidence: number; pick_a: number; market_p: number | null; backs: string | null; status: string }[]
  ).map((r) => ({
    category: r.category,
    at: r.at,
    win: r.status === 'scored' && r.win !== null ? r.win === 1 : null,
    scored_at: r.scored_at,
    confidence: r.confidence,
    market_side: r.market_p === null ? null : r.pick_a ? r.market_p : 1 - r.market_p,
    backs: !!r.backs,
  }));
  const memories = (db().prepare(`SELECT created_at FROM memories WHERE namespace = ? AND status = 'done'`).all(nsName(profileNs(handle))) as { created_at: string }[]).map(
    (r) => r.created_at,
  );
  const bought = address
    ? (db().prepare(`SELECT at FROM sales WHERE payer = ? AND endpoint IN ('prediction','forecast-on-demand')`).all(normalizeSuiAddress(address)) as { at: string }[]).map((r) => r.at)
    : [];
  return { picks, memories, asked: askedTimes(handle), bought };
}

export function badgesOf(handle: string, address: string | null, now = new Date()) {
  return badgesFrom(activityOf(handle, address), now);
}
