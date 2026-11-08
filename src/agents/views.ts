import { profileNs, config, nsName } from '../config';
import { db } from '../db/client';
import { lockAt } from '../agent/lock';
import { brier, relSkill, shrinkTo } from '../agent/policy';
import { CATEGORIES, type Category } from '../markets/categories';
import type { MarketRow } from '../markets/polymarket';
import { fromMicro } from '../pay/earnings';
import { blobOf } from '../memory/walrus';
import type { AgentRow } from './store';

// Everything public about forecasters (people and agents). A pick is sealed the
// moment it's made: who, when, model and harness, the Walrus blob and the sha256
// commitment are public; the pick, confidence and take are not, until the
// question resolves. Between lock and resolution a buyer can unlock one.

export interface SubmissionRow {
  id: string;
  handle: string;
  market_id: string;
  category: Category;
  pick: string;
  pick_a: number;
  confidence: number;
  p_a: number;
  claim: string | null;
  reasons: string;
  analytics: string;
  model: string;
  model_key: string;
  harness: string;
  effort: string | null;
  market_p: number | null;
  commitment: string;
  canonical: string;
  submitted_at: string;
  memory_id: number | null;
  status: 'open' | 'scored' | 'void';
  outcome: number | null;
  win: number | null;
  brier: number | null;
  brier_market: number | null;
  scored_at: string | null;
  scored_memory_id: number | null;
  /** '0xkafka' when the author bought 0xkafka's call on this question before sealing. */
  backs: string | null;
  /** When its author shared it publicly; it is readable by everyone from then on. */
  shared_at?: string | null;
}

export interface PublicSubmission {
  id: string;
  /** '0xkafka' when the author bought 0xkafka's call first: shown, not ranked. */
  backs: string | null;
  namespace: string;
  display: string;
  market_id: string;
  question?: string;
  category: string;
  model: string;
  harness: string;
  effort: string | null;
  submitted_at: string;
  /** sealed until the question resolves, then revealed; void if the question was voided. */
  status: 'sealed' | 'revealed' | 'void';
  walrus: { namespace: string; blob: string | null };
  /** sha256 of `canonical`, public at once; `canonical` (the exact JSON) once revealed. */
  commitment: { sha256: string; canonical: string | null };
  prediction: null | {
    pick: string;
    confidence: number;
    p_a: number;
    claim: string | null;
    reasons: string;
    analytics: { label: string; value: string; source?: string }[];
    market_at_submit: number | null;
  };
  result: null | { outcome: number; win: boolean; brier: number; brier_market: number | null };
}

/** Pick, confidence and take: only once revealed, or for the owner and buyers (`reveal`). */
export function publicSubmission(r: SubmissionRow & { display?: string; question?: string }, reveal = false): PublicSubmission {
  const status = r.status === 'open' ? 'sealed' : r.status === 'scored' ? 'revealed' : 'void';
  const open = status !== 'sealed' || reveal;
  return {
    id: r.id,
    backs: r.backs ?? null,
    namespace: r.handle,
    display: r.display ?? r.handle,
    market_id: r.market_id,
    ...(r.question ? { question: r.question } : {}),
    category: r.category,
    model: r.model,
    harness: r.harness,
    effort: r.effort,
    submitted_at: r.submitted_at,
    status,
    walrus: { namespace: nsName(profileNs(r.handle)), blob: blobOf(r.memory_id) },
    commitment: { sha256: r.commitment, canonical: open ? r.canonical : null },
    prediction: open ? {
      pick: r.pick,
      confidence: r.confidence,
      p_a: r.p_a,
      claim: r.claim,
      reasons: r.reasons,
      analytics: JSON.parse(r.analytics),
      market_at_submit: r.market_p,
    } : null,
    result:
      r.status === 'scored' && r.outcome !== null
        ? { outcome: r.outcome, win: r.win === 1, brier: r.brier!, brier_market: r.brier_market }
        : null,
  };
}

export function submissionsForMarket(marketId: string): PublicSubmission[] {
  const rows = db()
    .prepare(`SELECT s.*, a.display FROM submissions s JOIN agents a ON a.handle = s.handle WHERE s.market_id = ? ORDER BY s.submitted_at`)
    .all(marketId) as (SubmissionRow & { display: string })[];
  return rows.map((r) => publicSubmission(r));
}

/** The newest submissions across all questions, for the agents feed. */
export function recentSubmissions(limit = 30): PublicSubmission[] {
  const rows = db()
    .prepare(
      `SELECT s.*, a.display, m.question FROM submissions s JOIN agents a ON a.handle = s.handle JOIN markets m ON m.id = s.market_id
       ORDER BY s.submitted_at DESC LIMIT ?`,
    )
    .all(limit) as (SubmissionRow & { display: string; question: string })[];
  return rows.map((r) => publicSubmission(r));
}

export const submissionCount = (marketId: string) =>
  (db().prepare(`SELECT COUNT(*) n FROM submissions WHERE market_id = ?`).get(marketId) as { n: number }).n;

// ---------- reputation ----------

export const REP_K = 10;
export const RANK_MIN_N = 5;
export const EXPERT_MIN_N = 5;

export interface Record_ {
  n: number;
  wins: number;
  winRate: number | null;
  brier: number | null;
  brierMarket: number | null;
  /** Skill against the market, shrunk toward 0 with REP_K pseudo-observations. */
  reputation: number;
}

interface Scored {
  p: number;
  pickA: number;
  market: number | null;
  outcome: 0 | 1;
}

export function recordOf(rows: Scored[]): Record_ {
  const n = rows.length;
  const wins = rows.filter((r) => r.pickA === r.outcome).length;
  const withM = rows.filter((r) => r.market !== null);
  const skill = relSkill(withM.map((r) => ({ p: r.p, base: r.market!, outcome: r.outcome })));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    n,
    wins,
    winRate: n ? wins / n : null,
    brier: mean(rows.map((r) => brier(r.p, r.outcome))),
    brierMarket: mean(withM.map((r) => brier(r.market!, r.outcome))),
    reputation: Math.round(shrinkTo(skill, withM.length, 0, REP_K) * 1000) / 1000,
  };
}

function bestCategory(rows: (Scored & { category: Category })[]): Category | null {
  let best: { c: Category; rep: number } | null = null;
  for (const c of CATEGORIES) {
    const rc = rows.filter((r) => r.category === c);
    if (rc.length < EXPERT_MIN_N) continue;
    const rep = recordOf(rc).reputation;
    if (rep > 0 && (!best || rep > best.rep)) best = { c, rep };
  }
  return best?.c ?? null;
}

const mostCommon = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

interface ScoredSub extends Scored {
  handle: string;
  display: string;
  category: Category;
  model: string;
  model_key: string;
  harness: string;
}

function scoredSubs(): ScoredSub[] {
  return (
    db()
      .prepare(
        `SELECT s.handle, a.display, s.category, s.model, s.model_key, s.harness, s.p_a p, s.pick_a pickA, s.market_p market, s.outcome
         FROM submissions s JOIN agents a ON a.handle = s.handle WHERE s.status = 'scored' AND s.backs IS NULL`,
      )
      .all() as (Omit<ScoredSub, 'outcome'> & { outcome: number })[]
  ).map((r) => ({ ...r, outcome: r.outcome ? 1 : 0 }));
}

export interface NamespaceStats {
  namespace: string;
  memories: number;
  queued: number;
  latest_blob: string | null;
}

export function namespaceStats(handle: string): NamespaceStats {
  const ns = nsName(profileNs(handle));
  const r = db()
    .prepare(
      `SELECT SUM(status = 'done') done, SUM(status IN ('pending','submitted')) queued,
         (SELECT blob_id FROM memories m2 WHERE m2.namespace = ? AND m2.status = 'done' ORDER BY m2.id DESC LIMIT 1) latest
       FROM memories WHERE namespace = ?`,
    )
    .get(ns, ns) as { done: number | null; queued: number | null; latest: string | null };
  return { namespace: ns, memories: r.done ?? 0, queued: r.queued ?? 0, latest_blob: r.latest };
}

/** A profile as anyone may see it. The Sui address is public: it is the wallet they signed in with. */
export function publicProfile(a: AgentRow) {
  return {
    handle: a.handle,
    display: a.display,
    kind: a.kind,
    bio: a.bio,
    sui_address: a.sui_address,
    since: a.created_at,
    walrus_namespace: nsName(profileNs(a.handle)),
  };
}
export type PublicProfile = ReturnType<typeof publicProfile>;

export interface AgentLine extends Record_ {
  namespace: string;
  display: string;
  submissions: number;
  open: number;
  /** On the leaderboard: at least one resolved prediction. */
  ranked: boolean;
  best_category: Category | null;
  model: string | null;
  harness: string | null;
  walrus: NamespaceStats;
  last_submitted: string | null;
}

export function agentLines(): AgentLine[] {
  const subs = scoredSubs();
  const agents = db()
    .prepare(
      `SELECT a.handle, a.display, COUNT(s.id) total, SUM(s.status = 'open') open, MAX(s.submitted_at) last
       FROM agents a LEFT JOIN submissions s ON s.handle = a.handle GROUP BY a.handle`,
    )
    .all() as { handle: string; display: string; total: number; open: number | null; last: string | null }[];
  const allModels = db().prepare(`SELECT handle, model, harness FROM submissions`).all() as { handle: string; model: string; harness: string }[];
  return agents
    .map((a) => {
      const mine = subs.filter((s) => s.handle === a.handle);
      const used = allModels.filter((s) => s.handle === a.handle);
      const rec = recordOf(mine);
      return {
        namespace: a.handle,
        display: a.display,
        ...rec,
        submissions: a.total,
        open: a.open ?? 0,
        ranked: rec.n > 0,
        best_category: bestCategory(mine),
        model: mostCommon(used.map((u) => u.model)),
        harness: mostCommon(used.map((u) => u.harness)),
        walrus: namespaceStats(a.handle),
        last_submitted: a.last,
      };
    })
    // A game's leaderboard: most wins first, then the better win rate, then the most played.
    .sort((x, y) => Number(y.ranked) - Number(x.ranked) || y.wins - x.wins || (y.winRate ?? 0) - (x.winRate ?? 0) || y.submissions - x.submissions);
}

export interface GroupLine extends Record_ {
  key: string;
  label: string;
  agents: number;
  submissions: number;
  best_category: Category | null;
  memories: number;
}

export function groupLines(by: 'model' | 'harness'): GroupLine[] {
  const subs = scoredSubs();
  const all = db().prepare(`SELECT handle, model, model_key, harness FROM submissions`).all() as { handle: string; model: string; model_key: string; harness: string }[];
  const keyOf = (r: { model_key: string; harness: string }) => (by === 'model' ? r.model_key : r.harness);
  const keys = [...new Set(all.map(keyOf))];
  const mem = db()
    .prepare(`SELECT namespace, SUM(status = 'done') n FROM memories WHERE namespace LIKE ? GROUP BY namespace`)
    .all(`${config.ns}.profile.%`) as { namespace: string; n: number }[];
  const memOf = (handle: string) => mem.find((m) => m.namespace === nsName(profileNs(handle)))?.n ?? 0;
  return keys
    .map((key) => {
      const rows = all.filter((r) => keyOf(r) === key);
      const scored = subs.filter((s) => keyOf(s) === key);
      const handles = [...new Set(rows.map((r) => r.handle))];
      return {
        key,
        label: mostCommon(rows.map((r) => (by === 'model' ? r.model : r.harness))) ?? key,
        ...recordOf(scored),
        agents: handles.length,
        submissions: rows.length,
        best_category: bestCategory(scored),
        memories: handles.reduce((a, h) => a + memOf(h), 0),
      };
    })
    .sort((x, y) => Number(y.n >= RANK_MIN_N) - Number(x.n >= RANK_MIN_N) || y.reputation - x.reputation || y.submissions - x.submissions);
}

/** 0xkafka's own live predictions, scored the same way as the agents: the reference row. */
export function kafkaLine(): Record_ {
  const rows = (
    db()
      .prepare(`SELECT f.final_p p, f.market_p market, s.outcome FROM scores s JOIN forecasts f ON f.id = s.forecast_id WHERE s.mode = 'live'`)
      .all() as { p: number; market: number; outcome: number }[]
  ).map((r) => ({ ...r, pickA: r.p >= 0.5 ? 1 : 0, outcome: (r.outcome ? 1 : 0) as 0 | 1 }));
  return recordOf(rows);
}

/** New agents' share of a sale, before they have a record. */
export const NEW_AGENT_WEIGHT = 0.05;

/**
 * How much of a sale an agent earns on a question in `category`: its reputation
 * there (skill against the market, shrunk), falling back to its overall one.
 * Unproven agents get a small share; proven ones with no skill get none.
 */
export function agentWeight(handle: string, category: Category, subs = scoredSubs()): { weight: number; record: Record_; scope: 'category' | 'all' } {
  const mine = subs.filter((s) => s.handle === handle);
  const inCat = recordOf(mine.filter((s) => s.category === category));
  const rec = inCat.n >= RANK_MIN_N ? inCat : recordOf(mine);
  const weight = rec.n < RANK_MIN_N ? NEW_AGENT_WEIGHT : Math.max(0, rec.reputation);
  return { weight: Math.round(weight * 1000) / 1000, record: rec, scope: inCat.n >= RANK_MIN_N ? 'category' : 'all' };
}

/** Every agent's prediction on a question, as 0xkafka reads it at lock: with its record and weight. */
export function agentInputs(m: Pick<MarketRow, 'id' | 'category' | 'outcome_a'>) {
  const subs = scoredSubs();
  const rows = db()
    .prepare(
      `SELECT s.id, s.handle, a.display, s.model, s.harness, s.pick, s.confidence, s.p_a, s.reasons FROM submissions s JOIN agents a ON a.handle = s.handle
       WHERE s.market_id = ? AND s.status = 'open' AND s.backs IS NULL ORDER BY s.submitted_at`,
    )
    .all(m.id) as { id: string; handle: string; display: string; model: string; harness: string; pick: string; confidence: number; p_a: number; reasons: string }[];
  return rows
    .map((r) => {
      const w = agentWeight(r.handle, m.category as Category, subs);
      const rec = w.record;
      const record = rec.n
        ? `${rec.wins}/${rec.n} right ${w.scope === 'category' ? `in ${m.category}` : 'overall'}, reputation ${rec.reputation >= 0 ? '+' : ''}${rec.reputation.toFixed(2)}`
        : 'no resolved record yet';
      return {
        submission_id: r.id,
        handle: r.handle,
        display: r.display,
        model: r.model,
        harness: r.harness,
        pick: r.pick,
        confidence: r.confidence,
        p_a: r.p_a,
        reasons: r.reasons,
        record,
        weight: w.weight,
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

export function agentProfile(handle: string) {
  const a = db().prepare('SELECT handle, display, sui_address, created_at FROM agents WHERE handle = ?').get(handle) as
    | { handle: string; display: string; sui_address: string | null; created_at: string }
    | undefined;
  if (!a) return null;
  const line = agentLines().find((l) => l.namespace === handle)!;
  const rows = db()
    .prepare(
      `SELECT s.*, m.question FROM submissions s JOIN markets m ON m.id = s.market_id WHERE s.handle = ? ORDER BY s.submitted_at DESC LIMIT 200`,
    )
    .all(handle) as (SubmissionRow & { question: string })[];
  const scored = scoredSubs().filter((s) => s.handle === handle);
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, recordOf(scored.filter((s) => s.category === c))]).filter(([, r]) => (r as Record_).n > 0),
  ) as Partial<Record<Category, Record_>>;
  const count = (k: 'model' | 'harness') => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[k], (m.get(r[k]) ?? 0) + 1);
    return [...m].map(([name, n]) => ({ name, n })).sort((x, y) => y.n - x.n);
  };
  return {
    agent: { namespace: a.handle, display: a.display, since: a.created_at, receives_earnings: !!a.sui_address },
    record: line,
    by_category: byCategory,
    models: count('model'),
    harnesses: count('harness'),
    walrus: line.walrus,
    submissions: rows.map((r) => publicSubmission({ ...r, display: a.display })),
  };
}

/** Lock and submission state for a market, for lists and the question page. */
export function marketWindow(m: Pick<MarketRow, 'id' | 'category' | 'start_time' | 'end_date' | 'status'>, now = new Date()) {
  const lock = lockAt(m);
  const predicted = !!db().prepare(`SELECT 1 FROM forecasts WHERE market_id = ? AND mode = 'live'`).get(m.id);
  return {
    lock_at: lock.toISOString(),
    submissions_open: m.status === 'open' && now < lock,
    submissions: submissionCount(m.id),
    /** 0xkafka's call: on sale until the question resolves, then free. Made at lock, or earlier when someone buys it. */
    prediction: m.status === 'resolved' ? 'revealed' : predicted ? 'on_sale' : 'on_request',
  } as const;
}
