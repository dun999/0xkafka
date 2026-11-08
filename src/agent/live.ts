import { db, logActivity } from '../db/client';
import { CATEGORIES, SCAN_TAGS, type Category } from '../markets/categories';
import { fetchEvents, fetchMarket, livePrice, parseResolution, pickMarket, toRow, type MarketRow } from '../markets/polymarket';
import { getMarket, updateMarketState, upsertMarket } from '../markets/store';
import { scoreSubmissions, voidSubmissions } from '../agents/score';
import { decidesAt, type ForecastRow } from './forecast';
import { hasWindow } from './lock';
import { currentMind, reflectNow, shouldReflect } from './mind';
import { scoreForecast } from './score';

// The live loop: find questions, forecast them, lock them (signal on sale,
// submissions closed), score 0xkafka, the signal and every agent when they
// resolve, and reflect every REFLECT_EVERY scores.

export const LIVE_MIN_VOLUME = 5_000;
export const DAILY_PER_CATEGORY = 8; // new live questions per category per 24h
export const DAILY_BENCHED = 1; // a benched category stays on probation
export const MAX_OPEN = 60;
const H = 3_600_000;

const inBand = (p: number | null): p is number => p !== null && p >= 0.04 && p <= 0.96;

/** Find open questions closing in the next 72 hours and add the best ones per category. */
export async function scan(now = new Date()): Promise<number> {
  const seen = new Map<string, MarketRow>();
  for (const tag of SCAN_TAGS) {
    const events = await fetchEvents({
      closed: false,
      endMin: new Date(now.getTime() + 2 * H),
      endMax: new Date(now.getTime() + 72 * H),
      tag,
      limit: 50,
      order: 'volume24hr',
    }).catch(() => []);
    for (const ev of events) {
      const m = pickMarket(ev);
      if (!m) continue;
      const row = toRow(ev, m, 'live', now);
      if (!row || row.status !== 'open' || !inBand(row.price)) continue;
      if ((row.volume ?? 0) < LIVE_MIN_VOLUME) continue;
      if (!hasWindow(row, now)) continue; // agents need time to submit before lock
      seen.set(row.id, row);
    }
  }

  const d = db();
  const open = (d.prepare(`SELECT COUNT(*) n FROM forecasts f JOIN markets m ON m.id = f.market_id WHERE f.mode = 'live' AND m.status = 'open'`).get() as { n: number }).n;
  let room = Math.max(0, MAX_OPEN - open);
  const { policy } = currentMind();
  let added = 0;
  for (const c of CATEGORIES) {
    const known = new Set((d.prepare(`SELECT id FROM markets`).all() as { id: string }[]).map((r) => r.id));
    const since = new Date(now.getTime() - 24 * H).toISOString();
    const today = (d.prepare(`SELECT COUNT(*) n FROM markets WHERE source = 'live' AND category = ? AND added_at >= ?`).get(c, since) as { n: number }).n;
    const quota = Math.max(0, (policy.benched.includes(c) ? DAILY_BENCHED : DAILY_PER_CATEGORY) - today);
    const fresh = [...seen.values()]
      .filter((r) => r.category === c && !known.has(r.id))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, Math.min(quota, room));
    for (const r of fresh) {
      upsertMarket(r);
      added++;
      room--;
    }
  }
  // Keep prices fresh for markets already tracked.
  for (const r of seen.values()) if (getMarket(r.id)) updateMarketState(r.id, { price: r.price, price_at: r.price_at });
  if (added) logActivity('scan', `Added ${added} questions from Polymarket`);
  return added;
}

/** Forecast every open question that has no live forecast yet. */
/** Check questions past their decision time; score 0xkafka and every agent on the ones that resolved. */
export async function resolvePending(now = new Date()): Promise<number> {
  const d = db();
  const rows = d
    .prepare(
      `SELECT m.* FROM markets m
       WHERE m.status IN ('open','closed') AND m.source IN ('live','demand')
         AND (EXISTS (SELECT 1 FROM forecasts f LEFT JOIN scores s ON s.forecast_id = f.id WHERE f.market_id = m.id AND f.mode = 'live' AND s.forecast_id IS NULL)
              OR EXISTS (SELECT 1 FROM submissions x WHERE x.market_id = m.id AND x.status = 'open'))`,
    )
    .all() as MarketRow[];
  let n = 0;
  for (const m of rows) {
    if (decidesAt(m).getTime() > now.getTime()) continue;
    const g = await fetchMarket(m.id).catch(() => null);
    if (!g) continue;
    const res = parseResolution(g);
    const closedAt = g.closedTime ? new Date(g.closedTime.replace(' ', 'T').replace(/\+00(:00)?$/, 'Z')).toISOString() : now.toISOString();
    if (res === null) {
      updateMarketState(m.id, { status: g.closed ? 'closed' : 'open', price: livePrice(g), price_at: now.toISOString() });
      continue;
    }
    if (res === 'void') {
      updateMarketState(m.id, { status: 'void', closed_at: closedAt });
      voidSubmissions(m.id);
      continue;
    }
    updateMarketState(m.id, { status: 'resolved', outcome: res, closed_at: closedAt });
    const resolved: MarketRow = { ...m, status: 'resolved', outcome: res };
    // Agents first, so the outcome memory can say who was right.
    scoreSubmissions(resolved, res, closedAt);
    const f = d.prepare(`SELECT * FROM forecasts WHERE market_id = ? AND mode = 'live'`).get(m.id) as ForecastRow | undefined;
    if (f) {
      scoreForecast(f, resolved, res, closedAt);
      n++;
    }
  }
  if (n && shouldReflect()) reflectNow(now);
  return n;
}

export function benched(): Category[] {
  return currentMind().policy.benched;
}
