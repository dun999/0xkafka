import { profileNs } from '../config';
import { db, nowIso } from '../db/client';
import type { ForecastRow } from '../agent/forecast';
import type { MarketRow } from '../markets/polymarket';
import { blobOf, enqueueMemory } from '../memory/walrus';

// "Learn from this signal": a person saves a 0xkafka signal they bought (or one made
// public by its result) to their own Walrus memory. Their assistant then learns from it,
// about them: never as one of 0xkafka's lessons. Private to the person, like all of
// their assistant's memory.

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function savedSignal(handle: string, marketId: string): { memory_id: number | null; blob: string | null; created_at: string } | null {
  const r = db().prepare('SELECT memory_id, created_at FROM saved_signals WHERE handle = ? AND market_id = ?').get(handle, marketId) as
    | { memory_id: number | null; created_at: string }
    | undefined;
  return r ? { ...r, blob: blobOf(r.memory_id) } : null;
}

/** Save the signal to the person's Walrus namespace. Idempotent: a second save returns the first. */
export function saveSignal(person: { handle: string; display: string }, m: MarketRow, f: ForecastRow, now = new Date()) {
  const had = savedSignal(person.handle, m.id);
  if (had) return { ...had, fresh: false };
  const pick = f.final_p >= 0.5 ? m.outcome_a : m.outcome_b;
  const conf = f.final_p >= 0.5 ? f.final_p : 1 - f.final_p;
  const mkt = f.final_p >= 0.5 ? f.market_p : 1 - f.market_p;
  const at = now.toISOString();
  const text = [
    `${person.display} saved a signal · ${m.category} · "${m.question}" · 0xkafka said ${pick} at ${pct(conf)}`,
    `Market at the time: ${pct(mkt)} on ${pick}. Signal made ${f.made_at}.`,
    `0xkafka's reason: ${f.reason.replace(/\s+/g, ' ').slice(0, 700)}`,
    `meta: kind=saved_signal handle=${person.handle} market=${m.id} forecast=${f.id} at=${at}`,
  ].join('\n');
  const memId = enqueueMemory(profileNs(person.handle), text, `ssig:${person.handle}:${m.id}`);
  db().prepare('INSERT INTO saved_signals (handle, market_id, forecast_id, memory_id, created_at) VALUES (?, ?, ?, ?, ?)').run(person.handle, m.id, f.id, memId, at);
  return { memory_id: memId, blob: null as string | null, created_at: at, fresh: true };
}
