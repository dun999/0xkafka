import { db } from '../db/client';
import { lockAt } from '../agent/lock';
import { decidesAt } from '../agent/forecast';
import { publicSubmission, type PublicSubmission, type SubmissionRow } from '../agents/views';
import type { MarketRow } from '../markets/polymarket';

// What the prediction pages read: open questions, and every prediction made on
// one, shown as much as the viewer may see. A prediction is hidden from others
// until predictions close, so nobody can copy it; then everyone can read it.

export type Phase = 'open' | 'closed' | 'awaiting' | 'resolved' | 'void';

/** open: predictions being made · closed: game on, predictions readable · resolved/void: scored. */
export function phaseOf(m: Pick<MarketRow, 'id' | 'status' | 'category' | 'start_time' | 'end_date'>, now = new Date()): Phase {
  if (m.status === 'resolved') return 'resolved';
  if (m.status === 'void') return 'void';
  if (now < lockAt(m) && m.status === 'open') return 'open';
  return now < decidesAt(m) ? 'closed' : 'awaiting';
}

export interface Sealer {
  handle: string;
  display: string;
  kind: 'agent' | 'human';
  at: string;
}

export interface BoardCard {
  m: MarketRow;
  phase: Phase;
  lock_at: string;
  decides_at: string;
  sealers: Sealer[];
  n: number;
  kafka_predicted: boolean;
  /** The viewer's own pick, which they can always read. */
  mine: PublicSubmission | null;
}

function sealersOf(marketId: string): Sealer[] {
  return db()
    .prepare(
      `SELECT s.handle, a.display, a.kind, s.submitted_at at FROM submissions s JOIN agents a ON a.handle = s.handle
       WHERE s.market_id = ? ORDER BY s.submitted_at`,
    )
    .all(marketId) as Sealer[];
}

function mineOn(marketId: string, handle: string | null): PublicSubmission | null {
  if (!handle) return null;
  const r = db()
    .prepare(`SELECT s.*, a.display FROM submissions s JOIN agents a ON a.handle = s.handle WHERE s.market_id = ? AND s.handle = ?`)
    .get(marketId, handle) as (SubmissionRow & { display: string }) | undefined;
  return r ? publicSubmission(r, true) : null;
}

/** Open questions, soonest lock first, each with who has sealed. */
export function pickBoard(viewer: string | null, now = new Date()): BoardCard[] {
  const rows = db()
    .prepare(`SELECT * FROM markets WHERE status IN ('open','closed') AND source IN ('live','demand') ORDER BY COALESCE(start_time, end_date)`)
    .all() as MarketRow[];
  return rows
    .map((m) => {
      const sealers = sealersOf(m.id);
      return {
        m,
        phase: phaseOf(m, now),
        lock_at: lockAt(m).toISOString(),
        decides_at: decidesAt(m).toISOString(),
        sealers,
        n: sealers.length,
        kafka_predicted: !!db().prepare(`SELECT 1 FROM forecasts WHERE market_id = ? AND mode = 'live'`).get(m.id),
        mine: mineOn(m.id, viewer),
      };
    })
    .filter((c) => c.phase !== 'awaiting' || c.n > 0)
    .sort((a, b) => Number(a.phase !== 'open') - Number(b.phase !== 'open') || a.lock_at.localeCompare(b.lock_at));
}

/** Can this viewer read this prediction? Its author always; everyone once its author shares it or predictions close. */
export function canRead(
  sub: Pick<SubmissionRow, 'handle' | 'status' | 'market_id' | 'shared_at'>,
  viewer: { handle: string | null; address?: string | null },
  now = new Date(),
): boolean {
  if (sub.status !== 'open' || sub.shared_at) return true;
  if (viewer.handle && viewer.handle === sub.handle) return true;
  const m = db().prepare('SELECT * FROM markets WHERE id = ?').get(sub.market_id) as MarketRow | undefined;
  return !!m && now >= lockAt(m);
}

export interface Letter extends PublicSubmission {
  kind: 'agent' | 'human';
  readable_by_viewer: boolean;
}

/** Every letter sealed on a question, revealed only as far as the viewer may read. */
export function lettersFor(marketId: string, viewer: { handle: string | null; address?: string | null }): Letter[] {
  const rows = db()
    .prepare(`SELECT s.*, a.display, a.kind FROM submissions s JOIN agents a ON a.handle = s.handle WHERE s.market_id = ? ORDER BY s.submitted_at`)
    .all(marketId) as (SubmissionRow & { display: string; kind: 'agent' | 'human' })[];
  return rows.map((r) => {
    const readable = canRead(r, viewer);
    return { ...publicSubmission(r, readable), kind: r.kind, readable_by_viewer: readable };
  });
}

/** Picks that just opened, newest first: the stamps of the last few days. */
export function recentlyOpened(limit = 12): (PublicSubmission & { kind: 'agent' | 'human'; scored_at: string | null; image: string | null })[] {
  const rows = db()
    .prepare(
      `SELECT s.*, a.display, a.kind, m.question, m.image FROM submissions s JOIN agents a ON a.handle = s.handle JOIN markets m ON m.id = s.market_id
       WHERE s.status = 'scored' ORDER BY s.scored_at DESC LIMIT ?`,
    )
    .all(limit) as (SubmissionRow & { display: string; kind: 'agent' | 'human'; question: string; image: string | null })[];
  return rows.map((r) => ({ ...publicSubmission(r), kind: r.kind, scored_at: r.scored_at, image: r.image }));
}

export interface PickDetail {
  letter: Letter;
  m: MarketRow;
  phase: Phase;
  lock_at: string;
  /** What the question resolved to, once it has. */
  winner: string | null;
}

/** One pick with its question, for the share page and its image. */
export function pickDetail(id: string, viewer: { handle: string | null; address?: string | null }): PickDetail | null {
  const r = db()
    .prepare(`SELECT s.*, a.display, a.kind FROM submissions s JOIN agents a ON a.handle = s.handle WHERE s.id = ?`)
    .get(id) as (SubmissionRow & { display: string; kind: 'agent' | 'human' }) | undefined;
  if (!r) return null;
  const m = db().prepare('SELECT * FROM markets WHERE id = ?').get(r.market_id) as MarketRow;
  const readable = canRead(r, viewer);
  return {
    letter: { ...publicSubmission(r, readable), kind: r.kind, readable_by_viewer: readable },
    m,
    phase: phaseOf(m),
    lock_at: lockAt(m).toISOString(),
    winner: m.outcome === null ? null : m.outcome ? m.outcome_a : m.outcome_b,
  };
}
