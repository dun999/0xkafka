import { profileNs } from '../config';
import { db, logActivity, nowIso } from '../db/client';
import { brier } from '../agent/policy';
import type { MarketRow } from '../markets/polymarket';
import { resultText } from '../memory/format';
import { enqueueMemory } from '../memory/walrus';
import { rememberInsights } from './insights';

// When a question resolves, every pick is scored by the same rule as 0xkafka:
// Brier on P(outcome A), plus whether the pick won. Each result is written to
// the forecaster's own Walrus namespace, so their record lives there too.

interface OpenRow {
  id: string;
  handle: string;
  display: string;
  pick: string;
  confidence: number;
  category: string;
  pick_a: number;
  p_a: number;
  market_p: number | null;
}

export function scoreSubmissions(m: MarketRow, outcome: 0 | 1, _resolvedAt: string): number {
  const d = db();
  const rows = d
    .prepare(
      `SELECT s.id, s.handle, a.display, s.pick, s.confidence, s.category, s.p_a, s.pick_a, s.market_p
       FROM submissions s JOIN agents a ON a.handle = s.handle WHERE s.market_id = ? AND s.status = 'open'`,
    )
    .all(m.id) as OpenRow[];
  const update = d.prepare(
    `UPDATE submissions SET status = 'scored', outcome = ?, win = ?, brier = ?, brier_market = ?, scored_at = ?, scored_memory_id = ? WHERE id = ?`,
  );
  const winner = outcome ? m.outcome_a : m.outcome_b;
  d.transaction(() => {
    for (const s of rows) {
      const win = s.pick_a === outcome;
      const b = brier(s.p_a, outcome);
      const bm = s.market_p === null ? null : brier(s.market_p, outcome);
      const at = nowIso();
      const memId = enqueueMemory(
        profileNs(s.handle),
        resultText({
          id: s.id,
          handle: s.handle,
          display: s.display,
          marketId: m.id,
          category: s.category,
          question: m.question,
          pick: s.pick,
          confidence: s.confidence,
          winner,
          win,
          brier: b,
          market: s.market_p === null ? null : s.pick_a ? s.market_p : 1 - s.market_p,
          brierMarket: bm,
          at,
        }),
        `scored:${s.id}`,
      );
      update.run(outcome, win ? 1 : 0, b, bm, at, memId, s.id);
    }
  })();
  if (rows.length) {
    const right = rows.filter((s) => s.pick_a === outcome).length;
    logActivity('resolve', `Scored ${rows.length} picks on "${m.question}": ${right} right`, m.id);
    // What each forecaster's record now says about them, if it changed.
    for (const [handle, display] of new Map(rows.map((s) => [s.handle, s.display]))) rememberInsights(handle, display);
  }
  return rows.length;
}

/** A void question scores nobody. */
export function voidSubmissions(marketId: string): void {
  db().prepare(`UPDATE submissions SET status = 'void', scored_at = ? WHERE market_id = ? AND status = 'open'`).run(nowIso(), marketId);
}
