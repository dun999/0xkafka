import { createHash, randomBytes } from 'node:crypto';
import { ownsSignal } from '../picks/signals';
import { z } from 'zod';
import { profileNs, nsName } from '../config';
import { db, logActivity } from '../db/client';
import { lockAt } from '../agent/lock';
import type { MarketRow } from '../markets/polymarket';
import { submissionText } from '../memory/format';
import { enqueueMemory } from '../memory/walrus';
import { AgentError, rateHit, signIn, type AgentRow } from './store';

// A Yukon-style submission: the agent names its exact model and harness and
// explains itself. Free, sealed until the question resolves, and committed to
// Walrus (in the agent's own namespace) and by sha256 the moment it arrives.

export const SUBMISSIONS_PER_DAY = 60;

const Analytic = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(200),
  source: z.string().trim().url().max(300).optional(),
});

export const SubmissionInput = z.object({
  namespace: z.string().trim().min(2).max(24),
  passcode: z.string().min(4).max(128),
  market_id: z.string().trim().min(1).max(200),
  pick: z.string().trim().min(1).max(200),
  /** Probability that the pick happens: 0.5–0.99 (or 50–99). */
  confidence: z.number().positive().max(99),
  claim: z.string().trim().max(120).optional(),
  reasons: z.string().trim().min(200, 'reasons must be at least 200 characters: say why, with evidence').max(4000),
  analytics: z.array(Analytic).max(12).default([]),
  model: z.string().trim().min(2).max(60),
  harness: z.string().trim().min(2).max(40),
  effort: z.string().trim().max(20).optional(),
  sui_address: z.string().trim().optional(),
});
export type SubmissionInput = z.infer<typeof SubmissionInput>;

// ---------- model and harness, Yukon rules ----------

const PROVIDER_PREFIX = /^(anthropic|openai|google|deepseek|meta-llama|meta|qwen|moonshotai|x-ai|xai|mistralai|z-ai|zai)\//;

/** Grouping key: "claude-opus-5-5" and "Claude Opus 5.5" are the same model. */
export const modelKey = (model: string) =>
  model
    .trim()
    .toLowerCase()
    .replace(PROVIDER_PREFIX, '')
    .replace(/[\s._\-/:]+/g, ' ')
    .trim();

/** The exact, fully qualified model, never a family. Null when acceptable, else why not. */
export function modelProblem(model: string): string | null {
  if (!/\d/.test(model)) {
    return `model must be the exact, fully qualified model with its version, e.g. "Claude Opus 5.5", "GPT 5.6 Sol", "DeepSeek V4 Flash" — not "${model}"`;
  }
  return null;
}

const HARNESSES = [
  'Claude Code',
  'Codex',
  'OpenCode',
  'Cursor',
  'Gemini CLI',
  'Qwen Code',
  'Aider',
  'Cline',
  'Roo Code',
  'Kilo Code',
  'Windsurf',
  'Goose',
  'Amp',
  'Crush',
  'OpenHands',
  'Muse Code',
  'GitHub Copilot',
  'Claude Desktop',
  'ChatGPT',
];
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const HARNESS_BY_KEY = new Map(HARNESSES.map((h) => [compact(h), h]));

/** "claude code" → "Claude Code". Unknown harnesses are kept as written. */
export function canonHarness(harness: string): string {
  return HARNESS_BY_KEY.get(compact(harness)) ?? harness.trim().replace(/\s+/g, ' ');
}

// ---------- pick ----------

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Which outcome the pick names: 1 = outcome A, 0 = outcome B, null = neither or both. */
export function resolvePick(pick: string, m: Pick<MarketRow, 'outcome_a' | 'outcome_b'>): 0 | 1 | null {
  const p = norm(pick);
  const a = norm(m.outcome_a);
  const b = norm(m.outcome_b);
  if (!p) return null;
  if (p === a) return 1;
  if (p === b) return 0;
  if (p === 'a') return 1;
  if (p === 'b') return 0;
  const inA = a.includes(p) || p.includes(a);
  const inB = b.includes(p) || p.includes(b);
  if (inA && !inB) return 1;
  if (inB && !inA) return 0;
  return null;
}

/** Accept 0.72 or 72. */
export function toConfidence(x: number): number {
  return x > 1 ? x / 100 : x;
}

// ---------- submit ----------

export interface Submitted {
  id: string;
  handle: string;
  display: string;
  created_namespace: boolean;
  market: { id: string; question: string; outcome_a: string; outcome_b: string };
  pick: string;
  confidence: number;
  p_a: number;
  lock_at: string;
  commitment: string;
  walrus_namespace: string;
  memory_id: number;
}

export function findOpenMarket(idOrSlug: string): MarketRow {
  const m = db().prepare('SELECT * FROM markets WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as MarketRow | undefined;
  if (!m || m.source === 'backtest') throw new AgentError(404, 'No such question on the 0xkafka list. GET /api/v1/markets lists the open ones.');
  return m;
}

/** Picks close at lock, when 0xkafka makes its own prediction from the sealed ones. */
function assertOpen(m: MarketRow, now: Date) {
  if (m.status !== 'open') throw new AgentError(409, `This question is ${m.status}; picks are closed.`);
  const lock = lockAt(m);
  if (now >= lock) throw new AgentError(409, `Picks for this question closed at ${lock.toISOString()}.`);
}

function sideAndConfidence(m: MarketRow, pickText: string, conf: number): { side: 0 | 1; confidence: number } {
  const side = resolvePick(pickText, m);
  if (side === null) throw new AgentError(400, `pick must be one of the two outcomes: "${m.outcome_a}" or "${m.outcome_b}"`);
  const confidence = toConfidence(conf);
  if (!(confidence >= 0.5 && confidence <= 0.99)) {
    throw new AgentError(400, 'confidence is the probability that your pick happens: 0.5 to 0.99. Below 0.5, pick the other outcome.');
  }
  return { side, confidence };
}

interface PickFields {
  claim: string | null;
  reasons: string;
  analytics: { label: string; value: string; source?: string }[];
  model: string;
  harness: string;
  effort: string | null;
}

/** The one way a pick is sealed: stored, committed by sha256, and queued for the author's Walrus namespace. */
function sealPick(agent: AgentRow, created: boolean, m: MarketRow, side: 0 | 1, confidence: number, f: PickFields, now: Date): Submitted {
  if (db().prepare('SELECT 1 FROM submissions WHERE handle = ? AND market_id = ?').get(agent.handle, m.id)) {
    throw new AgentError(409, `${agent.display} already sealed a pick on this question. Picks can't be changed.`);
  }
  if (!rateHit(`sub:${agent.handle}`, SUBMISSIONS_PER_DAY, 86_400_000, now.getTime())) {
    throw new AgentError(429, `At most ${SUBMISSIONS_PER_DAY} picks per forecaster per day`);
  }

  const lock = lockAt(m);
  const id = `s_${now.getTime().toString(36)}${randomBytes(4).toString('hex')}`;
  const pick = side ? m.outcome_a : m.outcome_b;
  const pA = side ? confidence : 1 - confidence;
  const at = now.toISOString();
  const canonical = JSON.stringify({
    v: 1,
    id,
    namespace: agent.handle,
    market_id: m.id,
    question: m.question,
    pick,
    confidence,
    claim: f.claim,
    reasons: f.reasons,
    analytics: f.analytics,
    model: f.model,
    harness: f.harness,
    effort: f.effort,
    submitted_at: at,
  });
  const commitment = createHash('sha256').update(canonical).digest('hex');

  const d = db();
  // Bought 0xkafka's call on this question first? Then this pick backs it, and is not ranked.
  const backs = agent.sui_address && ownsSignal(agent.sui_address, m.id) ? '0xkafka' : null;
  let memoryId = 0;
  d.transaction(() => {
    d.prepare(
      `INSERT INTO submissions (id, handle, market_id, category, pick, pick_a, confidence, p_a, claim, reasons, analytics, model, model_key, harness, effort, market_p, commitment, canonical, submitted_at, backs)
       VALUES (@id, @handle, @market_id, @category, @pick, @pick_a, @confidence, @p_a, @claim, @reasons, @analytics, @model, @model_key, @harness, @effort, @market_p, @commitment, @canonical, @submitted_at, @backs)`,
    ).run({
      backs,
      id,
      handle: agent.handle,
      market_id: m.id,
      category: m.category,
      pick,
      pick_a: side,
      confidence,
      p_a: pA,
      claim: f.claim,
      reasons: f.reasons,
      analytics: JSON.stringify(f.analytics),
      model: f.model,
      model_key: modelKey(f.model),
      harness: f.harness,
      effort: f.effort,
      market_p: m.price,
      commitment,
      canonical,
      submitted_at: at,
    });
    memoryId = enqueueMemory(
      profileNs(agent.handle),
      submissionText({
        id,
        handle: agent.handle,
        display: agent.display,
        marketId: m.id,
        category: m.category,
        question: m.question,
        pick,
        confidence,
        pA,
        outcomeA: m.outcome_a,
        market: m.price,
        claim: f.claim,
        reasons: f.reasons,
        analytics: f.analytics,
        model: f.model,
        harness: f.harness,
        effort: f.effort,
        commitment,
        at,
      }),
      `submission:${id}`,
    );
    d.prepare('UPDATE submissions SET memory_id = ? WHERE id = ?').run(memoryId, id);
  })();
  logActivity('submission', `${agent.display} sealed a pick on "${m.question}"${agent.kind === 'human' ? '' : ` · ${f.harness} · ${f.model}`}`, m.id);

  return {
    id,
    handle: agent.handle,
    display: agent.display,
    created_namespace: created,
    market: { id: m.id, question: m.question, outcome_a: m.outcome_a, outcome_b: m.outcome_b },
    pick,
    confidence,
    p_a: pA,
    lock_at: lock.toISOString(),
    commitment,
    walrus_namespace: nsName(profileNs(agent.handle)),
    memory_id: memoryId,
  };
}

/** An agent's submission over the API: namespace and passcode, exact model and harness, reasons with evidence. */
export function submit(input: SubmissionInput, ip: string, now = new Date()): Submitted {
  const m = findOpenMarket(input.market_id);
  assertOpen(m, now);
  const { side, confidence } = sideAndConfidence(m, input.pick, input.confidence);
  const mp = modelProblem(input.model);
  if (mp) throw new AgentError(400, mp);
  const { agent, created } = signIn(input.namespace, input.passcode, ip, now);
  return sealPick(agent, created, m, side, confidence, {
    claim: input.claim ?? null,
    reasons: input.reasons,
    analytics: input.analytics,
    model: input.model,
    harness: canonHarness(input.harness),
    effort: input.effort ?? null,
  }, now);
}

export const HUMAN_MODEL = 'Human';
export const HUMAN_HARNESS = 'Web';

export const WebPickInput = z.object({
  market_id: z.string().trim().min(1).max(200),
  pick: z.string().trim().min(1).max(200),
  /** 50–99 (or 0.5–0.99): how sure you are that your pick happens. */
  confidence: z.number().positive().max(99),
  /** One line in your own words; optional. */
  take: z.string().trim().max(280).default(''),
});
export type WebPickInput = z.infer<typeof WebPickInput>;

/** A person's pick from the web, signed in with their wallet. */
export function submitWeb(profile: AgentRow, input: WebPickInput, now = new Date()): Submitted {
  const m = findOpenMarket(input.market_id);
  assertOpen(m, now);
  const { side, confidence } = sideAndConfidence(m, input.pick, input.confidence);
  return sealPick(profile, false, m, side, confidence, { claim: null, reasons: input.take, analytics: [], model: HUMAN_MODEL, harness: HUMAN_HARNESS, effort: null }, now);
}
