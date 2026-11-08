import { nsName, profileNs } from '../config';
import { db } from '../db/client';
import { getAgent } from '../agents/store';
import { agentLines, publicProfile, publicSubmission, RANK_MIN_N, type SubmissionRow } from '../agents/views';
import type { MarketRow } from '../markets/polymarket';
import { canRead, phaseOf, type Letter, type Phase } from './board';

// A forecaster's dossier: who they are, how good they are, what they've sealed,
// and what 0xkafka remembers about them on Walrus.

export type Tier = 'Rookie' | 'Contender' | 'Sharp' | 'Oracle';
export const ORACLE_MIN_N = 15;

/** Rookie until five picks resolve; then Sharp if they beat the market, Contender if not; Oracle for the top three with depth. */
export function tierOf(n: number, reputation: number, rank: number | null): Tier {
  if (n < RANK_MIN_N) return 'Rookie';
  if (reputation <= 0) return 'Contender';
  if (n >= ORACLE_MIN_N && rank !== null && rank <= 3) return 'Oracle';
  return 'Sharp';
}

export const TIER_LINE: Record<Tier, string> = {
  Rookie: `Fewer than ${RANK_MIN_N} picks resolved. The record is still being written.`,
  Contender: 'Has a record, but has not beaten the market price yet.',
  Sharp: 'Beats the market price on the picks that resolved.',
  Oracle: `Top three by skill against the market, over ${ORACLE_MIN_N}+ resolved picks.`,
};

export type Verdict = 'Too early' | 'Honest' | 'Overconfident' | 'Too timid';
export const CALIBRATION_MIN_N = 3;
const CALIBRATION_GAP = 0.08;

/** Do they mean it when they say 70%? Mean confidence against how often they were right. */
export function calibrationOf(rows: { confidence: number; win: boolean }[]): { verdict: Verdict; says: number | null; hits: number | null } {
  if (rows.length < CALIBRATION_MIN_N) return { verdict: 'Too early', says: null, hits: null };
  const says = rows.reduce((a, r) => a + r.confidence, 0) / rows.length;
  const hits = rows.filter((r) => r.win).length / rows.length;
  const verdict = says - hits > CALIBRATION_GAP ? 'Overconfident' : hits - says > CALIBRATION_GAP ? 'Too timid' : 'Honest';
  return { verdict, says, hits };
}

/** The current run, newest first: 3 wins in a row → { kind: 'won', n: 3 }. */
export function streakOf(newestFirst: boolean[]): { kind: 'won' | 'missed'; n: number } | null {
  if (!newestFirst.length) return null;
  const first = newestFirst[0];
  let n = 0;
  while (n < newestFirst.length && newestFirst[n] === first) n++;
  return { kind: first ? 'won' : 'missed', n };
}

export interface DossierLetter extends Letter {
  question: string;
  event_title: string | null;
  phase: Phase;
  decides_at: string | null;
}

export interface Remembered {
  id: number;
  kind: string;
  text: string;
  blob: string | null;
  mock: boolean;
  at: string;
}

type SubJoin = SubmissionRow & { question: string; event_title: string | null; status_m: MarketRow['status'] };

/** Memories in this profile's Walrus namespace, safe to show: sealed picks stay sealed unless the viewer may read them. */
function remembered(handle: string, viewer: { handle: string | null; address?: string | null }, limit = 12): Remembered[] {
  const rows = db()
    .prepare(`SELECT id, text, blob_id, mock, status, created_at FROM memories WHERE namespace = ? ORDER BY id DESC LIMIT ?`)
    .all(nsName(profileNs(handle)), limit) as { id: number; text: string; blob_id: string | null; mock: number; status: string; created_at: string }[];
  const own = viewer.handle === handle;
  return rows.flatMap((r) => {
    const meta = /meta: (.*)$/m.exec(r.text)?.[1] ?? '';
    const field = (k: string) => new RegExp(`(?:^| )${k}=(\\S+)`).exec(meta)?.[1] ?? null;
    const kind = field('kind') ?? 'note';
    // What a person's assistant learned about them is theirs alone.
    if ((kind === 'assistant_lesson' || kind === 'saved_signal') && !own) return [];
    let text = r.text.split('\n')[0];
    if (kind === 'submission') {
      const sub = db()
        .prepare('SELECT s.handle, s.status, s.market_id, s.shared_at, m.question FROM submissions s JOIN markets m ON m.id = s.market_id WHERE s.id = ?')
        .get(field('sub')) as (Pick<SubmissionRow, 'handle' | 'status' | 'market_id' | 'shared_at'> & { question: string }) | undefined;
      if (sub && !canRead(sub, viewer)) text = `Predicted "${sub.question}". Hidden until predictions close.`;
    }
    return [{ id: r.id, kind, text, blob: r.status === 'done' ? r.blob_id : null, mock: !!r.mock, at: r.created_at }];
  });
}

export function dossierOf(handleIn: string, viewer: { handle: string | null; address?: string | null }) {
  const a = getAgent(handleIn);
  if (!a) return null;
  const lines = agentLines();
  const line = lines.find((l) => l.namespace === a.handle)!;
  const ranked = lines.filter((l) => l.ranked);
  const rankIdx = ranked.findIndex((l) => l.namespace === a.handle);
  const rank = rankIdx < 0 ? null : rankIdx + 1;

  const rows = db()
    .prepare(
      `SELECT s.*, m.question, m.event_title, m.status status_m FROM submissions s JOIN markets m ON m.id = s.market_id
       WHERE s.handle = ? ORDER BY s.submitted_at DESC LIMIT 300`,
    )
    .all(a.handle) as SubJoin[];
  const market = db().prepare('SELECT * FROM markets WHERE id = ?');

  const letters: DossierLetter[] = rows.map((r) => {
    const m = market.get(r.market_id) as MarketRow;
    const readable = canRead(r, viewer);
    return {
      ...publicSubmission({ ...r, display: a.display }, readable),
      kind: a.kind,
      readable_by_viewer: readable,
      question: r.question,
      event_title: r.event_title,
      phase: phaseOf(m),
      decides_at: m.start_time ?? m.end_date,
    };
  });
  const scored = rows.filter((r) => r.status === 'scored' && r.win !== null);

  return {
    profile: publicProfile(a),
    is_owner: viewer.handle === a.handle,
    record: line,
    rank,
    tier: tierOf(line.n, line.reputation, rank),
    calibration: calibrationOf(scored.map((r) => ({ confidence: r.confidence, win: r.win === 1 }))),
    streak: streakOf(scored.sort((x, y) => (y.scored_at ?? '').localeCompare(x.scored_at ?? '')).map((r) => r.win === 1)),
    sealed: letters.filter((l) => l.status === 'sealed'),
    archive: letters.filter((l) => l.status !== 'sealed'),
    remembered: remembered(a.handle, viewer),
  };
}

export type Dossier = NonNullable<ReturnType<typeof dossierOf>>;
