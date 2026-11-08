import { rateCount } from '../agents/store';
import { agentInputs } from '../agents/views';
import { db, logActivity } from '../db/client';
import { fetchMarket, livePrice, type MarketRow } from '../markets/polymarket';
import { decidesAt, runForecast } from './forecast';
import { lockAt } from './lock';

// At lock, submissions close and 0xkafka makes its one prediction on the
// question: from the lessons it learned on past questions and every agent's
// public prediction on this one, weighed by their records. The prediction is
// written to Walrus, sealed on the site, and sold over MPP until it resolves.

/** After a failed prediction, wait this long before trying again… */
export const RETRY_AFTER_MS = 30 * 60_000;
/** …and give up on the question after this many failures, so one bad question can't burn model calls. */
export const MAX_FAILS = 3;

async function priceNow(m: MarketRow): Promise<number | null> {
  const g = await fetchMarket(m.id).catch(() => null);
  return (g ? livePrice(g) : null) ?? m.price;
}

/** Make the prediction for every question whose lock has passed. */
export async function predictPending(now = new Date(), limit = 4): Promise<number> {
  const d = db();
  const rows = d
    .prepare(
      `SELECT m.* FROM markets m LEFT JOIN forecasts f ON f.market_id = m.id AND f.mode = 'live'
       WHERE f.id IS NULL AND m.status IN ('open','closed') AND m.source IN ('live','demand') ORDER BY COALESCE(m.start_time, m.end_date)`,
    )
    .all() as MarketRow[];
  let n = 0;
  let tried = 0;
  for (const m of rows) {
    if (tried >= limit) break;
    if (now < lockAt(m) || now >= decidesAt(m)) continue;
    const bucket = `predict-fail:${m.id}`;
    if (rateCount(bucket, RETRY_AFTER_MS, now.getTime()) > 0 || rateCount(bucket, 2 * 86_400_000, now.getTime()) >= MAX_FAILS) continue;
    const price = await priceNow(m);
    if (price === null) continue;
    tried++;
    try {
      const agents = agentInputs(m);
      await runForecast({ market: m, marketP: price, now, mode: 'live', agents });
      logActivity('lock', `Submissions closed on "${m.question}" with ${agents.length} agent${agents.length === 1 ? '' : 's'}; prediction on sale`, m.id);
      n++;
    } catch (e) {
      d.prepare('INSERT INTO rate_events (bucket, at) VALUES (?, ?)').run(bucket, now.getTime());
      logActivity('error', `Prediction failed for ${m.question}: ${e instanceof Error ? e.message : e}`, m.id);
    }
  }
  return n;
}
