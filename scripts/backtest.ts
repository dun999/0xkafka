// Walk-forward replay over questions that already resolved, so 0xkafka has a
// real record before going live. Day by day, at each simulated midnight:
//   1. reveal outcomes that resolved before that midnight, score them, write them to Walrus
//   2. wait for Walrus, then reflect if enough new scores came in
//   3. forecast that day's questions, recalling only memories from the past
// The model (DeepSeek V4, Jul/Aug 2026) predates every question here.
//
//   pnpm backtest --from 2026-10-15 --to 2026-11-04

import { db, logActivity } from '../src/db/client';
import { CATEGORIES, SCAN_TAGS, type Category } from '../src/markets/categories';
import { fetchEvents, pickMarket, priceAt, toRow, type MarketRow } from '../src/markets/polymarket';
import { getMarket, upsertMarket } from '../src/markets/store';
import { runForecast, type ForecastRow } from '../src/agent/forecast';
import { currentMind, reflectNow, shouldReflect } from '../src/agent/mind';
import { scoreForecast } from '../src/agent/score';
import { flushMemories, isMock } from '../src/memory/walrus';

const DAY = 86_400_000;
const H = 3_600_000;
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const from = new Date(`${arg('from', '2026-10-15')}T00:00:00Z`);
const to = new Date(`${arg('to', '2026-11-04')}T00:00:00Z`);
const PER_DAY: Record<Category, number> = { sports: 5, crypto: 3, politics: 2, economy: 2, culture: 2 };
const MIN_VOLUME = Number(arg('min-volume', '20000'));
const CONCURRENCY = 4;

interface Candidate {
  m: MarketRow;
  at: Date; // when 0xkafka forecasts
  price: number;
}

/** Sports: an hour before the game. Everything else: a day before it closes. */
function forecastTime(m: MarketRow): Date {
  if (m.start_time) return new Date(new Date(m.start_time).getTime() - H);
  return new Date(new Date(m.end_date!).getTime() - 24 * H);
}

async function collect(): Promise<Candidate[]> {
  const rows = new Map<string, MarketRow>();
  for (let t = from.getTime(); t <= to.getTime() + DAY; t += DAY) {
    for (const tag of SCAN_TAGS) {
      const evs = await fetchEvents({ closed: true, endMin: new Date(t), endMax: new Date(t + DAY), tag, limit: 60 }).catch(() => []);
      for (const ev of evs) {
        const m = pickMarket(ev);
        if (!m) continue;
        const row = toRow(ev, m, 'backtest');
        if (!row || row.status !== 'resolved' || row.outcome === null || !row.closed_at || !row.yes_token) continue;
        if ((row.volume ?? 0) < MIN_VOLUME) continue;
        rows.set(row.id, row);
      }
    }
    process.stdout.write(`\rcollecting ${new Date(t).toISOString().slice(0, 10)} · ${rows.size} resolved questions`);
  }
  console.log();

  // Group by forecast day, best volume first, then price each pick at its forecast time.
  const byDay = new Map<string, MarketRow[]>();
  for (const r of rows.values()) {
    const at = forecastTime(r);
    if (at < from || at >= new Date(to.getTime() + DAY)) continue;
    if (new Date(r.closed_at!) <= at) continue; // resolved before 0xkafka would have looked
    const key = at.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  const out: Candidate[] = [];
  for (const [day, list] of [...byDay].sort()) {
    for (const c of CATEGORIES) {
      let taken = 0;
      for (const r of list.filter((x) => x.category === c).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))) {
        if (taken >= PER_DAY[c]) break;
        const at = forecastTime(r);
        const price = await priceAt(r.yes_token!, at).catch(() => null);
        if (price === null || price < 0.04 || price > 0.96) continue;
        out.push({ m: r, at, price });
        taken++;
      }
    }
    process.stdout.write(`\rpricing ${day} · ${out.length} questions`);
  }
  console.log();
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

function reveal(before: Date): number {
  const due = db()
    .prepare(
      `SELECT f.* FROM forecasts f JOIN markets m ON m.id = f.market_id LEFT JOIN scores s ON s.forecast_id = f.id
       WHERE f.mode = 'backtest' AND s.forecast_id IS NULL AND m.closed_at < ? ORDER BY m.closed_at`,
    )
    .all(before.toISOString()) as ForecastRow[];
  for (const f of due) {
    const m = getMarket(f.market_id)!;
    scoreForecast(f, m, m.outcome ? 1 : 0, m.closed_at!);
  }
  return due.length;
}

async function main() {
  console.log(`0xkafka replay ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} · memory: ${isMock() ? 'MOCK (not Walrus)' : 'Walrus mainnet'}`);
  const cands = await collect();
  console.log(`${cands.length} questions to replay`);
  logActivity('backtest', `Replay started: ${cands.length} questions`);

  for (let day = from.getTime(); day <= to.getTime(); day += DAY) {
    const midnight = new Date(day);
    const revealed = reveal(midnight);
    if (revealed) await flushMemories();
    let v: number | null = null;
    while (shouldReflect()) {
      v = reflectNow(midnight);
      if (v === null) break;
    }
    if (v) await flushMemories();

    const { policy, version } = currentMind();
    const todays = cands.filter((c) => c.at >= midnight && c.at < new Date(day + DAY));
    const probation = new Set<Category>();
    const run = todays.filter((c) => {
      if (!policy.benched.includes(c.m.category)) return true;
      if (probation.has(c.m.category)) return false;
      probation.add(c.m.category);
      return true;
    });
    let done = 0;
    await pool(run, CONCURRENCY, async (c) => {
      if (db().prepare(`SELECT 1 FROM forecasts WHERE id = ?`).get(`backtest:${c.m.id}`)) return;
      upsertMarket(c.m);
      try {
        await runForecast({ market: c.m, marketP: c.price, now: c.at, mode: 'backtest' });
        done++;
      } catch (e) {
        console.error(`\n  forecast failed: ${c.m.question}: ${e instanceof Error ? e.message : e}`);
      }
    });
    const scored = (db().prepare('SELECT COUNT(*) n FROM scores').get() as { n: number }).n;
    console.log(
      `${midnight.toISOString().slice(0, 10)} · revealed ${revealed} · forecast ${done}/${todays.length} · mind v${version}${policy.benched.length ? ` · benched ${policy.benched.join(',')}` : ''} · scored ${scored}`,
    );
  }

  // Everything that has resolved by now.
  reveal(new Date());
  while (shouldReflect()) if (reflectNow(new Date()) === null) break;
  await flushMemories();
  const s = db().prepare(`SELECT COUNT(*) n, AVG(brier_final) k, AVG(brier_blank) b, AVG(brier_market) m FROM scores`).get() as Record<string, number>;
  console.log(`done · ${s.n} scored · Brier 0xkafka ${s.k?.toFixed(4)} · blank ${s.b?.toFixed(4)} · market ${s.m?.toFixed(4)} · mind v${currentMind().version}`);
  logActivity('backtest', `Replay finished: ${s.n} scored, mind v${currentMind().version}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
