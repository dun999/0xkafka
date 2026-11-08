import { db, logActivity, nowIso } from '../db/client';
import type { MarketRow } from '../markets/polymarket';
import { outcomeText } from '../memory/format';
import { enqueueMemory } from '../memory/walrus';
import type { ForecastRow } from './forecast';
import { brier } from './policy';

/** Score a forecast against how its question resolved, and remember the outcome on Walrus. */
export function scoreForecast(f: ForecastRow, m: MarketRow, outcome: 0 | 1, resolvedAt: string): void {
  const d = db();
  const exists = d.prepare('SELECT 1 FROM scores WHERE forecast_id = ?').get(f.id);
  if (exists) return;
  const s = {
    forecast_id: f.id,
    market_id: m.id,
    category: m.category,
    mode: f.mode,
    outcome,
    resolved_at: resolvedAt,
    brier_final: brier(f.final_p, outcome),
    brier_raw: brier(f.raw_p, outcome),
    brier_blank: f.blank_p === null ? null : brier(f.blank_p, outcome),
    brier_market: brier(f.market_p, outcome),
    scored_at: nowIso(),
  };
  d.prepare(
    `INSERT INTO scores (forecast_id, market_id, category, mode, outcome, resolved_at, brier_final, brier_raw, brier_blank, brier_market, scored_at)
     VALUES (@forecast_id, @market_id, @category, @mode, @outcome, @resolved_at, @brier_final, @brier_raw, @brier_blank, @brier_market, @scored_at)`,
  ).run(s);
  const agents = d
    .prepare(
      `SELECT a.display, s.pick, s.confidence, s.win FROM submissions s JOIN agents a ON a.handle = s.handle
       WHERE s.market_id = ? AND s.status = 'scored' ORDER BY s.win DESC, s.confidence DESC`,
    )
    .all(m.id) as { display: string; pick: string; confidence: number; win: number }[];
  const memId = enqueueMemory(
    'outcomes',
    outcomeText({
      marketId: m.id,
      category: m.category,
      question: m.question,
      outcomeA: m.outcome_a,
      winner: outcome ? m.outcome_a : m.outcome_b,
      resolvedAt,
      final: f.final_p,
      market: f.market_p,
      blank: f.blank_p,
      raw: f.raw_p,
      brierFinal: s.brier_final,
      brierMarket: s.brier_market,
      brierBlank: s.brier_blank,
      reason: f.reason,
      mode: f.mode,
      agents: agents.map((a) => ({ ...a, win: a.win === 1 })),
    }),
    `outcome:${f.id}`,
  );
  d.prepare('UPDATE scores SET memory_id = ? WHERE forecast_id = ?').run(memId, f.id);
  const verdict = s.brier_final < s.brier_market - 0.005 ? 'beat the market' : s.brier_final > s.brier_market + 0.005 ? 'market closer' : 'level with market';
  logActivity('resolve', `${m.question} → ${outcome ? m.outcome_a : m.outcome_b} · 0xkafka ${verdict}`, m.id);
}
