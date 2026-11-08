import { createHash } from 'node:crypto';
import { profileNs } from '../config';
import { db, nowIso } from '../db/client';
import { CATEGORY_LABEL, type Category } from '../markets/categories';
import { enqueueMemory } from '../memory/walrus';

// What a forecaster's own record says about them, in one line each:
// "2/7 in Sports when you claim 70%", "4/4 when you fade the market".
// Pure where it can be; written to their Walrus namespace when it changes,
// so 0xkafka's memory of them visibly moves with their results.

export interface ScoredPick {
  category: string;
  confidence: number;
  win: boolean;
  /** The market's price for the side they picked, when they sealed it. */
  marketForPick: number | null;
}

export interface Insight {
  key: string;
  text: string;
  n: number;
  wins: number;
  rate: number;
  /** What they claimed on average for this group. */
  claimed: number;
  tone: 'warn' | 'good' | 'info';
  /** How much it should matter: the gap from what they claim, weighed by how many picks back it. */
  strength: number;
}

export const INSIGHT_MIN_N = 3;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function insight(key: string, label: string, rows: ScoredPick[]): Insight | null {
  if (rows.length < INSIGHT_MIN_N) return null;
  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const rate = wins / n;
  const claimed = rows.reduce((a, r) => a + r.confidence, 0) / n;
  const gap = rate - claimed;
  const tone = gap < -0.1 ? 'warn' : gap > 0.05 ? 'good' : 'info';
  const tail = tone === 'warn' ? `, below the ${pct(claimed)} you usually claim` : tone === 'good' ? `, better than the ${pct(claimed)} you claim` : `, about what you claim`;
  return { key, text: `${wins}/${n} ${label}${tail}.`, n, wins, rate, claimed, tone, strength: Math.abs(gap) * Math.sqrt(n) };
}

/** Every insight their resolved picks support, strongest first. */
export function insightsOf(picks: ScoredPick[]): Insight[] {
  const out: (Insight | null)[] = [];
  for (const c of Object.keys(CATEGORY_LABEL) as Category[]) {
    out.push(insight(`cat:${c}`, `in ${CATEGORY_LABEL[c]}`, picks.filter((p) => p.category === c)));
  }
  out.push(insight('conf:high', 'when you say 75% or more', picks.filter((p) => p.confidence >= 0.75)));
  out.push(insight('fade', 'when you fade the market', picks.filter((p) => p.marketForPick !== null && p.marketForPick < 0.5)));
  out.push(insight('follow', 'when you side with the market', picks.filter((p) => p.marketForPick !== null && p.marketForPick >= 0.5)));
  return out.filter((x): x is Insight => x !== null).sort((a, b) => b.strength - a.strength);
}

/** The ones worth showing before a pick on a question in `category`. */
export function hintsFor(all: Insight[], category: string, limit = 2): Insight[] {
  return all.filter((i) => i.key === `cat:${category}` || !i.key.startsWith('cat:')).slice(0, limit);
}

/** A forecaster's resolved picks, in the shape insights need. */
export function scoredPicksOf(handle: string): ScoredPick[] {
  const rows = db()
    .prepare(`SELECT category, confidence, win, pick_a, market_p FROM submissions WHERE handle = ? AND status = 'scored' AND win IS NOT NULL AND backs IS NULL`)
    .all(handle) as { category: string; confidence: number; win: number; pick_a: number; market_p: number | null }[];
  return rows.map((r) => ({
    category: r.category,
    confidence: r.confidence,
    win: r.win === 1,
    marketForPick: r.market_p === null ? null : r.pick_a ? r.market_p : 1 - r.market_p,
  }));
}

export function insightsFor(handle: string): Insight[] {
  return insightsOf(scoredPicksOf(handle));
}

/**
 * After a result, write each insight that changed to the forecaster's Walrus namespace
 * (at most `limit`, strongest first). Returns how many were written.
 */
export function rememberInsights(handle: string, display: string, limit = 2): number {
  const d = db();
  const get = d.prepare(`SELECT text FROM notes WHERE handle = ? AND kind = 'insight' AND key = ?`);
  const put = d.prepare(
    `INSERT INTO notes (handle, kind, key, text, status, memory_id, created_at) VALUES (?, 'insight', ?, ?, 'active', ?, ?)
     ON CONFLICT (handle, kind, key) DO UPDATE SET text = excluded.text, memory_id = excluded.memory_id, created_at = excluded.created_at`,
  );
  let written = 0;
  for (const i of insightsFor(handle).slice(0, limit)) {
    const prev = get.get(handle, i.key) as { text: string } | undefined;
    if (prev?.text === i.text) continue;
    const at = nowIso();
    const text = [
      `${display}: ${i.text}`,
      `meta: kind=insight handle=${handle} key=${i.key} n=${i.n} wins=${i.wins} claimed=${i.claimed.toFixed(2)} at=${at}`,
    ].join('\n');
    const memId = enqueueMemory(profileNs(handle), text, `insight:${handle}:${createHash('sha256').update(text.split('\n')[0]).digest('hex').slice(0, 16)}`);
    put.run(handle, i.key, i.text, memId, at);
    written++;
  }
  return written;
}
