import { config, nsName } from './config';
import { db } from './db/client';
import type { ForecastRow } from './agent/forecast';
import { currentMind } from './agent/mind';
import { CATEGORIES, type Category } from './markets/categories';
import type { MarketRow } from './markets/polymarket';
import { headline } from './memory/format';
import { blobOf, walruscanBlob } from './memory/walrus';

// Read models shared by the pages and the agent API.

export const polymarketUrl = (m: Pick<MarketRow, 'event_slug' | 'slug'>) => `https://polymarket.com/event/${m.event_slug ?? m.slug}`;
export const suiscanTx = (digest: string) => `https://suiscan.xyz/mainnet/tx/${digest}`;

export interface RecordLine {
  n: number;
  kafka: number | null;
  blank: number | null;
  market: number | null;
}

export function record(filter: { mode?: 'live' | 'backtest' } = {}): { all: RecordLine } & Record<Category, RecordLine> {
  const where = filter.mode ? `WHERE mode = '${filter.mode}'` : '';
  const rows = db()
    .prepare(
      `SELECT category, COUNT(*) n, AVG(brier_final) kafka, AVG(brier_blank) blank, AVG(brier_market) market FROM scores ${where} GROUP BY category`,
    )
    .all() as (RecordLine & { category: Category })[];
  const all = db()
    .prepare(`SELECT COUNT(*) n, AVG(brier_final) kafka, AVG(brier_blank) blank, AVG(brier_market) market FROM scores ${where}`)
    .get() as RecordLine;
  const out = { all } as { all: RecordLine } & Record<Category, RecordLine>;
  for (const c of CATEGORIES) out[c] = rows.find((r) => r.category === c) ?? { n: 0, kafka: null, blank: null, market: null };
  return out;
}

export interface MarketWithForecast extends MarketRow {
  f_id: string | null;
  f_mode: string | null;
  f_made_at: string | null;
  f_final: number | null;
  f_market: number | null;
  f_blank: number | null;
  f_raw: number | null;
  f_memory: number | null;
  f_mind: number | null;
  s_brier_final: number | null;
  s_brier_market: number | null;
  s_brier_blank: number | null;
  sales: number;
}

const MWF = `SELECT m.*, f.id f_id, f.mode f_mode, f.made_at f_made_at, f.final_p f_final, f.market_p f_market, f.blank_p f_blank, f.raw_p f_raw,
  f.memory_id f_memory, f.mind_version f_mind, s.brier_final s_brier_final, s.brier_market s_brier_market, s.brier_blank s_brier_blank,
  (SELECT COUNT(*) FROM sales x WHERE x.market_id = m.id) sales
  FROM markets m LEFT JOIN forecasts f ON f.market_id = m.id LEFT JOIN scores s ON s.forecast_id = f.id`;

export function openMarkets(limit = 100): MarketWithForecast[] {
  return db()
    .prepare(`${MWF} WHERE m.status IN ('open','closed') AND m.source IN ('live','demand') AND f.id IS NOT NULL ORDER BY COALESCE(m.start_time, m.end_date) LIMIT ?`)
    .all(limit) as MarketWithForecast[];
}

export function resolvedMarkets(limit = 50, mode?: 'live' | 'backtest'): MarketWithForecast[] {
  return db()
    .prepare(`${MWF} WHERE s.forecast_id IS NOT NULL ${mode ? 'AND f.mode = @mode' : ''} ORDER BY s.resolved_at DESC LIMIT @limit`)
    .all({ limit, mode }) as MarketWithForecast[];
}

export function marketDetail(id: string) {
  const m = db().prepare(`${MWF} WHERE m.id = ? ORDER BY CASE f.mode WHEN 'live' THEN 0 ELSE 1 END LIMIT 1`).get(id) as MarketWithForecast | undefined;
  if (!m) return null;
  const f = m.f_id ? (db().prepare('SELECT * FROM forecasts WHERE id = ?').get(m.f_id) as ForecastRow) : null;
  return { m, f };
}

export const isSealed = (m: Pick<MarketRow, 'status'>) => m.status === 'open' || m.status === 'closed';

/** Lessons in force when a forecast was made: its category's, plus calibration. */
export function lessonsInForce(category: string, mindVersion: number) {
  return (
    db()
      .prepare(
        `SELECT id, kind, category, statement, memory_id FROM lessons
         WHERE born_version <= @v AND (retired_version IS NULL OR retired_version > @v) AND (category = @c OR kind = 'calibration')
         ORDER BY id`,
      )
      .all({ v: mindVersion, c: category }) as { id: number; kind: string; category: string | null; statement: string; memory_id: number | null }[]
  ).map((l) => ({ ...l, blob_id: blobOf(l.memory_id) }));
}

export interface RecalledView {
  blob_id: string;
  distance: number;
  headline: string;
  text: string;
}

export function recalledOf(f: ForecastRow): RecalledView[] {
  return (JSON.parse(f.recalled || '[]') as { blob_id: string; distance: number; text: string }[]).map((r) => ({
    blob_id: r.blob_id,
    distance: r.distance,
    headline: headline(r.text),
    text: r.text,
  }));
}

/** The full forecast as sold to agents. */
export function forecastPayload(m: MarketRow, f: ForecastRow, priceNow: number | null) {
  const blob = blobOf(f.memory_id);
  const rec = record();
  return {
    market: {
      id: m.id,
      question: m.question,
      category: m.category,
      outcome_a: m.outcome_a,
      outcome_b: m.outcome_b,
      closes: m.end_date,
      starts: m.start_time,
      polymarket: polymarketUrl(m),
    },
    forecast: {
      p: round(f.final_p),
      of: m.outcome_a,
      market_at_forecast: round(f.market_p),
      market_now: priceNow === null ? null : round(priceNow),
      edge: priceNow === null ? null : round(f.final_p - priceNow),
      reason: f.reason,
      made_at: f.made_at,
      mind_version: f.mind_version,
      steps: { blank: f.blank_raw === null ? null : round(f.blank_raw), raw: round(f.raw_p), trust: f.trust, blend: round(f.blend_p), calibration: f.calib, final: round(f.final_p) },
      walrus: blob ? { blob_id: blob, url: walruscanBlob(blob), namespace: nsName('forecasts') } : null,
    },
    memory_used: {
      recalled: recalledOf(f).map((r) => ({ blob_id: r.blob_id, distance: round(r.distance), memory: r.headline })),
      lessons: lessonsInForce(m.category, f.mind_version).map((l) => ({ id: `L${l.id}`, lesson: l.statement, blob_id: l.blob_id })),
    },
    record: { category: m.category, ...rec[m.category as Category], overall: rec.all },
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export function stats() {
  const d = db();
  const one = <T>(sql: string) => d.prepare(sql).get() as T;
  const counters = Object.fromEntries((d.prepare('SELECT name, n FROM counters').all() as { name: string; n: number }[]).map((r) => [r.name, r.n]));
  const sales = one<{ n: number; usdc: number | null }>(`SELECT COUNT(*) n, SUM(CAST(amount AS REAL)) usdc FROM sales`);
  const mem = one<{ done: number; queued: number }>(
    `SELECT SUM(status = 'done') done, SUM(status IN ('pending','submitted')) queued FROM memories`,
  );
  return {
    forecasts: one<{ n: number }>(`SELECT COUNT(*) n FROM forecasts`).n,
    open: one<{ n: number }>(`SELECT COUNT(*) n FROM forecasts f JOIN markets m ON m.id = f.market_id WHERE m.status IN ('open','closed') AND f.mode = 'live'`).n,
    scored: one<{ n: number }>(`SELECT COUNT(*) n FROM scores`).n,
    record: record(),
    mind: currentMind(),
    memories: mem.done ?? 0,
    memoriesQueued: mem.queued ?? 0,
    mock: one<{ n: number }>(`SELECT COUNT(*) n FROM memories WHERE mock = 1`).n > 0,
    sales: sales.n,
    usdc: sales.usdc ?? 0,
    tatumCalls: counters['tatum.calls'] ?? 0,
    publicRpcCalls: counters['sui-public.calls'] ?? 0,
    llmCalls: counters['llm.calls'] ?? 0,
    recalls: counters['walrus.recalls'] ?? 0,
    counters,
    ns: config.ns,
  };
}

export function minds() {
  return (
    db().prepare('SELECT * FROM minds ORDER BY version DESC').all() as {
      version: number;
      created_at: string;
      sim_time: string;
      policy: string;
      diff: string;
      n_scored: number;
      stats: string;
      memory_id: number | null;
    }[]
  ).map((r) => ({
    version: r.version,
    createdAt: r.created_at,
    simTime: r.sim_time,
    policy: JSON.parse(r.policy) as { trust: Record<Category, number>; calib: number; benched: Category[] },
    diff: JSON.parse(r.diff) as string[],
    nScored: r.n_scored,
    blob: blobOf(r.memory_id),
  }));
}

export function lessons() {
  return (
    db().prepare('SELECT * FROM lessons ORDER BY id DESC').all() as {
      id: number;
      kind: string;
      category: string | null;
      statement: string;
      evidence: string;
      status: string;
      born_version: number;
      retired_version: number | null;
      retired_reason: string | null;
      created_at: string;
      memory_id: number | null;
    }[]
  ).map((l) => ({ ...l, evidence: JSON.parse(l.evidence) as Record<string, number>, blob: blobOf(l.memory_id) }));
}

/** Rolling mean Brier for 0xkafka, Blank and Market, in the order questions resolved. */
export function learningCurve(window = 30) {
  const rows = db()
    .prepare(`SELECT resolved_at, brier_final k, brier_blank b, brier_market m FROM scores ORDER BY resolved_at`)
    .all() as { resolved_at: string; k: number; b: number; m: number }[];
  const out: { i: number; at: string; k: number; b: number; m: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const w = rows.slice(Math.max(0, i - window + 1), i + 1);
    if (w.length < Math.min(window, 10)) continue;
    const avg = (key: 'k' | 'b' | 'm') => w.reduce((s, r) => s + r[key], 0) / w.length;
    out.push({ i: i + 1, at: rows[i].resolved_at, k: avg('k'), b: avg('b'), m: avg('m') });
  }
  return out;
}

/** Reliability: forecast buckets vs how often outcome A happened. */
export function reliability() {
  const rows = db()
    .prepare(`SELECT f.final_p p, f.blank_p bp, s.outcome y FROM scores s JOIN forecasts f ON f.id = s.forecast_id`)
    .all() as { p: number; bp: number; y: number }[];
  const buckets = Array.from({ length: 5 }, (_, i) => ({ lo: i / 5, hi: (i + 1) / 5 }));
  const fold = (key: 'p' | 'bp') =>
    buckets.map((b) => {
      const inB = rows.filter((r) => r[key] >= b.lo && (r[key] < b.hi || (b.hi === 1 && r[key] <= 1)));
      return {
        mid: (b.lo + b.hi) / 2,
        n: inB.length,
        said: inB.length ? inB.reduce((s, r) => s + r[key], 0) / inB.length : null,
        happened: inB.length ? inB.reduce((s, r) => s + r.y, 0) / inB.length : null,
      };
    });
  return { kafka: fold('p'), blank: fold('bp') };
}

export function trustHistory() {
  return minds()
    .slice()
    .reverse()
    .map((m) => ({ version: m.version, trust: m.policy.trust, calib: m.policy.calib }));
}

export function activity(limit = 30) {
  return db().prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(limit) as { id: number; at: string; kind: string; text: string; ref: string | null }[];
}

export function salesList(limit = 100) {
  return db()
    .prepare(`SELECT s.*, m.question FROM sales s LEFT JOIN markets m ON m.id = s.market_id ORDER BY s.id DESC LIMIT ?`)
    .all(limit) as { id: number; at: string; digest: string; payer: string | null; amount: string; protocol: string; endpoint: string; market_id: string | null; question: string | null }[];
}

export function recentBlobs(limit = 12) {
  return db()
    .prepare(`SELECT id, namespace, text, blob_id, done_at, mock FROM memories WHERE status = 'done' ORDER BY done_at DESC LIMIT ?`)
    .all(limit) as { id: number; namespace: string; text: string; blob_id: string; done_at: string; mock: number }[];
}
