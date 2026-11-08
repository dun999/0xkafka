import { normalizeSuiAddress } from '@mysten/sui/utils';
import { decidesAt, runForecast } from '../agent/forecast';
import { isLocked, lockAt } from '../agent/lock';
import { agentInputs } from '../agents/views';
import { config } from '../config';
import { db, logActivity } from '../db/client';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '../markets/categories';
import type { MarketRow } from '../markets/polymarket';
import { headline } from './share';

// 0xkafka sells its own call on any open question, over MPP (USDC on Sui).
// If it has not made the call yet, buying it makes it: 0xkafka reads the picks
// sealed so far and its lessons from Walrus, writes the call to Walrus, and
// sells the same call to everyone after. Otherwise it makes the call when picks
// close, as before.

/** Too close to the decision to make a fair call on request. */
export const CALL_MIN_LEAD_MS = 15 * 60_000;

export const SIGNAL_ENDPOINTS = ['prediction', 'forecast-on-demand'] as const;

export interface KafkaRecord {
  category: Category | null;
  label: string;
  /** Resolved questions it called. */
  n: number;
  /** Called the side that happened. */
  right: number;
  hit_rate: number | null;
  brier: number | null;
  brier_market: number | null;
}

/** 0xkafka's record: every question it called and saw resolve, in one category or all. */
export function kafkaRecord(category: Category | null = null): KafkaRecord {
  const r = db()
    .prepare(
      `SELECT COUNT(*) n, SUM((f.final_p >= 0.5) = (s.outcome = 1)) hits, AVG(s.brier_final) brier, AVG(s.brier_market) market
       FROM scores s JOIN forecasts f ON f.id = s.forecast_id ${category ? 'WHERE s.category = ?' : ''}`,
    )
    .get(...(category ? [category] : [])) as { n: number; hits: number | null; brier: number | null; market: number | null };
  return {
    category,
    label: category ? CATEGORY_LABEL[category] : 'All questions',
    n: r.n,
    right: r.hits ?? 0,
    hit_rate: r.n ? (r.hits ?? 0) / r.n : null,
    brier: r.brier,
    brier_market: r.market,
  };
}

export type SignalState = 'ready' | 'on_request';

export interface SignalItem {
  id: string;
  title: string;
  question: string;
  category: Category;
  image: string | null;
  outcome_a: string;
  outcome_b: string;
  /** Polymarket's P(outcome A), last seen. */
  market_price: number | null;
  decides_at: string;
  lock_at: string;
  picks_open: boolean;
  picks: number;
  /** ready: 0xkafka has made its call. on_request: buying it makes the call now. */
  state: SignalState;
  /** The asker already paid for this one; opening it again is free. */
  owned: boolean;
  /** The asker has sealed their own pick on it. */
  picked: boolean;
}

type Row = MarketRow & { f_id: string | null; picks: number };

const forSale = (m: Row, now: Date) =>
  (m.status === 'open' || m.status === 'closed') && (m.f_id ? true : m.status === 'open' && m.price !== null && decidesAt(m).getTime() - now.getTime() > CALL_MIN_LEAD_MS);

/** Words people use for each category, to find what they asked for. */
const CATEGORY_WORDS: Record<Category, RegExp> = {
  sports: /\b(sports?|football|soccer|nfl|nba|nhl|mlb|ufc|mma|tennis|cricket|f1|formula ?1|basketball|baseball|hockey|game|match|premier league|la ?liga|champions league|serie a|bundesliga)\b/i,
  politics: /\b(politics?|political|elections?|vote|senate|president|governor|mayor|parliament)\b/i,
  crypto: /\b(crypto|bitcoin|btc|eth|ethereum|sol|solana|sui|token|coin)\b/i,
  economy: /\b(economy|economic|fed|rates?|inflation|cpi|gdp|jobs|recession|stocks?)\b/i,
  culture: /\b(culture|movies?|music|box office|oscars?|grammys?|tv|celebrity|awards?)\b/i,
};

export function categoryIn(text: string): Category | null {
  return CATEGORIES.find((c) => CATEGORY_WORDS[c].test(text)) ?? null;
}

const STOP = new Set(
  'a an the and or for of on in at to is are be will win wins who what which buy get show me your my any some signal signals call calls pick picks prediction predictions bet bets place make seal post want would like please kafka 0xkafka today tonight tomorrow this that game match vs'.split(
    ' ',
  ),
);

/** Open questions 0xkafka will sell its call on, soonest first; or one by id. */
export function signalList(opts: { category?: Category | null; q?: string | null; id?: string | null; address?: string | null; handle?: string | null; picksOnly?: boolean; limit?: number } = {}): SignalItem[] {
  const now = new Date();
  const rows = db()
    .prepare(
      `SELECT m.*, f.id f_id, (SELECT COUNT(*) FROM submissions x WHERE x.market_id = m.id) picks
       FROM markets m LEFT JOIN forecasts f ON f.market_id = m.id AND f.mode = 'live'
       WHERE m.status IN ('open','closed') AND m.source IN ('live','demand') ${opts.id ? 'AND m.id = ?' : ''}
       ORDER BY COALESCE(m.start_time, m.end_date)`,
    )
    .all(...(opts.id ? [opts.id] : [])) as Row[];
  const words = (opts.q ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !categoryIn(w));
  const owned = new Set(
    opts.address
      ? (db()
          .prepare(`SELECT market_id FROM sales WHERE payer = ? AND endpoint IN ('prediction','forecast-on-demand') AND market_id IS NOT NULL`)
          .all(normalizeSuiAddress(opts.address)) as { market_id: string }[]).map((r) => r.market_id)
      : [],
  );
  const picked = new Set(
    opts.handle ? (db().prepare(`SELECT market_id FROM submissions WHERE handle = ?`).all(opts.handle) as { market_id: string }[]).map((r) => r.market_id) : [],
  );

  let items = rows
    .filter((m) => (opts.picksOnly ? m.status === 'open' && !isLocked(m, now) : forSale(m, now)))
    .filter((m) => !opts.category || m.category === opts.category)
    .map(
      (m): SignalItem => ({
        id: m.id,
        title: /^yes$/i.test(m.outcome_a) && /^no$/i.test(m.outcome_b) ? m.question : headline(m),
        question: m.question,
        category: m.category,
        image: m.image,
        outcome_a: m.outcome_a,
        outcome_b: m.outcome_b,
        market_price: m.price,
        decides_at: decidesAt(m).toISOString(),
        lock_at: lockAt(m).toISOString(),
        picks_open: m.status === 'open' && !isLocked(m, now),
        picks: m.picks,
        state: m.f_id ? 'ready' : 'on_request',
        owned: owned.has(m.id),
        picked: picked.has(m.id),
      }),
    );
  if (words.length) {
    const hits = items.filter((it) => words.some((w) => `${it.title} ${it.question} ${it.outcome_a} ${it.outcome_b}`.toLowerCase().includes(w)));
    if (hits.length) items = hits;
  }
  return items.slice(0, opts.limit ?? 8);
}

/** Has this address paid for 0xkafka's call on this question? */
export function ownsSignal(address: string | null | undefined, marketId: string): boolean {
  if (!address) return false;
  return !!db()
    .prepare(`SELECT 1 FROM sales WHERE payer = ? AND market_id = ? AND endpoint IN ('prediction','forecast-on-demand')`)
    .get(normalizeSuiAddress(address), marketId);
}

/** Can 0xkafka make its call on this question right now, on request? */
export function canCallNow(m: MarketRow, now = new Date()): boolean {
  return m.status === 'open' && m.price !== null && decidesAt(m).getTime() - now.getTime() > CALL_MIN_LEAD_MS;
}

const g = globalThis as unknown as { __kafkaCalls?: Map<string, Promise<void>> };

/**
 * Make 0xkafka's call on a question now, because someone bought it before picks
 * closed. One call per question: concurrent buyers wait on the same one.
 */
export function callNow(m: MarketRow, price: number): Promise<void> {
  g.__kafkaCalls ??= new Map();
  const running = g.__kafkaCalls.get(m.id);
  if (running) return running;
  const p = (async () => {
    if (db().prepare(`SELECT 1 FROM forecasts WHERE market_id = ? AND mode = 'live'`).get(m.id)) return;
    const agents = agentInputs(m);
    await runForecast({ market: m, marketP: price, now: new Date(), mode: 'live', agents });
    logActivity('lock', `0xkafka made its call on "${m.question}" on request, reading ${agents.length} pick${agents.length === 1 ? '' : 's'}`, m.id);
  })().finally(() => g.__kafkaCalls!.delete(m.id));
  g.__kafkaCalls.set(m.id, p);
  return p;
}

export const signalPrice = () => config.prices.signal;
