import { config } from '../config';
import { db, logActivity, nowIso } from '../db/client';
import type { MarketRow } from '../markets/polymarket';
import { forecastText } from '../memory/format';
import { enqueueMemory, recall, type RecallHit } from '../memory/walrus';
import { askForecast } from '../llm';
import { cryptoContext, type CryptoContext } from './crypto';
import { currentMind } from './mind';
import { applyPolicy, blankForecast } from './policy';
import { SYSTEM, userPrompt, type PromptAgent } from './prompts';

export const RECALL_LIMIT = 4;
export const RECALL_MAX_DISTANCE = Number(process.env.RECALL_MAX_DISTANCE ?? 0.6);

export interface ForecastRow {
  id: string;
  market_id: string;
  mode: 'live' | 'backtest';
  made_at: string;
  created_at: string;
  mind_version: number;
  market_p: number;
  blank_raw: number | null;
  blank_p: number | null;
  raw_p: number;
  trust: number;
  blend_p: number;
  calib: number;
  final_p: number;
  reason: string;
  blank_reason: string | null;
  recalled: string;
  context: string | null;
  model: string | null;
  memory_id: number | null;
  /** The agents' predictions this one was made from: who, what and how much 0xkafka weighed them. */
  agents: string;
  /** The lessons recalled from Walrus for it. */
  lessons_used: string;
}

/** An agent's public prediction as 0xkafka reads it at lock. */
export interface AgentInput extends PromptAgent {
  submission_id: string;
  handle: string;
  p_a: number;
  /** Share of the sale this agent earns: grows with its reputation in the category. */
  weight: number;
}

export interface UsedLesson {
  blob_id: string;
  distance: number;
  text: string;
}

/** When the question is decided: game start for sports, else the listed end date. */
export function decidesAt(m: Pick<MarketRow, 'start_time' | 'end_date'>): Date {
  return new Date(m.start_time ?? m.end_date ?? Date.now());
}

/**
 * Past outcomes like this question, recalled from Walrus by meaning.
 * Only outcomes resolved before `now` count: in a replay, memory from the
 * replay's future must not leak into a forecast.
 */
export async function recallSimilar(m: MarketRow, now: Date): Promise<RecallHit[]> {
  const hits = await recall('outcomes', `${m.question} ${m.event_title ?? ''}`.trim(), { limit: RECALL_LIMIT * 3 });
  return hits
    .filter((h) => h.meta.market !== m.id)
    .filter((h) => !h.meta.resolved || new Date(h.meta.resolved) < now)
    .filter((h) => h.distance <= RECALL_MAX_DISTANCE)
    .slice(0, RECALL_LIMIT);
}

/** What 0xkafka learned from agents on questions like this one: post-mortem lessons, recalled by meaning. */
export async function recallLessons(m: MarketRow, now: Date): Promise<RecallHit[]> {
  const hits = await recall('lessons', `${m.category} ${m.question} ${m.event_title ?? ''}`.trim(), { limit: RECALL_LIMIT * 3 });
  return hits
    .filter((h) => h.meta.kind === 'postmortem' && h.meta.market !== m.id)
    .filter((h) => !h.meta.resolved || new Date(h.meta.resolved) < now)
    .filter((h) => h.distance <= RECALL_MAX_DISTANCE + 0.1)
    .slice(0, RECALL_LIMIT);
}

export interface ForecastOptions {
  market: MarketRow;
  marketP: number;
  now: Date;
  mode: 'live' | 'backtest';
  /** Live: the agents' public predictions at lock. */
  agents?: AgentInput[];
  /** Replay only: also ask the same model with no memory, as a control. */
  blank?: boolean;
}

export async function runForecast({ market, marketP, now, mode, agents = [], blank: withBlank = false }: ForecastOptions): Promise<ForecastRow> {
  const mind = currentMind();
  const closes = new Date(market.end_date ?? decidesAt(market));
  let crypto: CryptoContext | null = null;
  if (market.category === 'crypto') crypto = await cryptoContext(market.question, now, closes).catch(() => null);
  const [memory, lessons] = await Promise.all([recallSimilar(market, now), recallLessons(market, now)]);

  const [kafka, blank] = await Promise.all([
    askForecast(SYSTEM, userPrompt(market, now, closes, crypto, memory, lessons, agents)),
    withBlank ? askForecast(SYSTEM, userPrompt(market, now, closes, crypto, null)) : Promise.resolve(null),
  ]);

  const applied = applyPolicy(mind.policy, market.category, kafka.p, marketP);
  const row: ForecastRow = {
    id: `${mode}:${market.id}`,
    market_id: market.id,
    mode,
    made_at: now.toISOString(),
    created_at: nowIso(),
    mind_version: mind.version,
    market_p: marketP,
    blank_raw: blank ? blank.p : null,
    blank_p: blank ? blankForecast(blank.p, marketP) : null,
    raw_p: kafka.p,
    trust: applied.trust,
    blend_p: applied.blend,
    calib: applied.calib,
    final_p: applied.final,
    reason: kafka.reason,
    blank_reason: blank ? blank.reason : null,
    recalled: JSON.stringify(memory.map((h) => ({ blob_id: h.blob_id, distance: h.distance, text: h.text }))),
    context: crypto ? JSON.stringify(crypto) : null,
    model: config.llm.model,
    memory_id: null,
    agents: JSON.stringify(agents.map(({ reasons: _r, ...a }) => a)),
    lessons_used: JSON.stringify(lessons.map((h): UsedLesson => ({ blob_id: h.blob_id, distance: h.distance, text: h.text }))),
  };

  const d = db();
  d.prepare(
    `INSERT INTO forecasts (id, market_id, mode, made_at, created_at, mind_version, market_p, blank_raw, blank_p, raw_p, trust, blend_p, calib, final_p, reason, blank_reason, recalled, context, model, agents, lessons_used)
     VALUES (@id, @market_id, @mode, @made_at, @created_at, @mind_version, @market_p, @blank_raw, @blank_p, @raw_p, @trust, @blend_p, @calib, @final_p, @reason, @blank_reason, @recalled, @context, @model, @agents, @lessons_used)
     ON CONFLICT(market_id, mode) DO NOTHING`,
  ).run(row);
  const memId = enqueueMemory(
    'forecasts',
    forecastText({
      marketId: market.id,
      category: market.category,
      question: market.question,
      outcomeA: market.outcome_a,
      madeAt: row.made_at,
      mode,
      raw: row.raw_p,
      blank: row.blank_raw,
      lessons: lessons.length,
      agents: agents.length,
      market: marketP,
      trust: row.trust,
      calib: row.calib,
      final: row.final_p,
      reason: row.reason,
      recalled: memory.length,
      mind: mind.version,
    }),
    `forecast:${row.id}`,
  );
  d.prepare('UPDATE forecasts SET memory_id = ? WHERE id = ?').run(memId, row.id);
  row.memory_id = memId;
  logActivity(
    'forecast',
    `${mode === 'backtest' ? 'Replay' : 'Prediction'} · ${market.question} · ${agents.length} agent${agents.length === 1 ? '' : 's'}, ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} · sealed`,
    market.id,
  );
  return row;
}
