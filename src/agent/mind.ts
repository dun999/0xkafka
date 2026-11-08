import { db, logActivity, nowIso } from '../db/client';
import type { Category } from '../markets/categories';
import { enqueueMemory } from '../memory/walrus';
import { lessonText, mindText } from '../memory/format';
import { DEFAULT_POLICY, type Policy, type ScoredRow } from './policy';
import { reflect, type ActiveLesson, type LessonKind } from './reflect';

// The mind is the current policy plus the lessons behind it. Each reflection
// that changes anything becomes a new version, written to Walrus.

export const REFLECT_EVERY = 10;

export interface Mind {
  version: number;
  policy: Policy;
  nScored: number;
  createdAt: string | null;
}

export function currentMind(): Mind {
  const row = db().prepare('SELECT * FROM minds ORDER BY version DESC LIMIT 1').get() as
    | { version: number; policy: string; n_scored: number; created_at: string }
    | undefined;
  if (!row) return { version: 0, policy: DEFAULT_POLICY, nScored: 0, createdAt: null };
  return { version: row.version, policy: { ...DEFAULT_POLICY, ...JSON.parse(row.policy) }, nScored: row.n_scored, createdAt: row.created_at };
}

export function mindAt(version: number): Mind {
  if (version <= 0) return { version: 0, policy: DEFAULT_POLICY, nScored: 0, createdAt: null };
  const row = db().prepare('SELECT * FROM minds WHERE version = ?').get(version) as
    | { version: number; policy: string; n_scored: number; created_at: string }
    | undefined;
  if (!row) return currentMind();
  return { version: row.version, policy: { ...DEFAULT_POLICY, ...JSON.parse(row.policy) }, nScored: row.n_scored, createdAt: row.created_at };
}

export function scoredRows(): ScoredRow[] {
  return (
    db()
      .prepare(
        `SELECT s.category, f.market_p AS market, f.raw_p AS raw, s.outcome
         FROM scores s JOIN forecasts f ON f.id = s.forecast_id ORDER BY s.resolved_at`,
      )
      .all() as { category: Category; market: number; raw: number; outcome: 0 | 1 }[]
  ).map((r) => ({ ...r, outcome: r.outcome ? 1 : 0 }));
}

export function activeLessons(): ActiveLesson[] {
  return (
    // Post-mortems are recalled by meaning, never refitted, so reflection leaves them alone.
    db().prepare(`SELECT id, kind, category, evidence FROM lessons WHERE status = 'active' AND kind != 'postmortem'`).all() as {
      id: number;
      kind: LessonKind;
      category: Category | null;
      evidence: string;
    }[]
  ).map((l) => {
    const e = JSON.parse(l.evidence) as { value?: number };
    return { id: l.id, kind: l.kind, category: l.category, value: Number(e.value ?? 0) };
  });
}

export function shouldReflect(): boolean {
  const n = (db().prepare('SELECT COUNT(*) n FROM scores').get() as { n: number }).n;
  return n - currentMind().nScored >= REFLECT_EVERY;
}

/**
 * Fit a new policy from every scored forecast, write lessons and a new mind
 * version (each to Walrus). Returns the new version, or null if nothing changed.
 */
export function reflectNow(simTime: Date = new Date()): number | null {
  const d = db();
  const rows = scoredRows();
  const mind = currentMind();
  const active = activeLessons();
  const r = reflect(rows, mind.policy, active);
  if (!r.changed) {
    // Record that this evidence was considered, without a new version.
    if (mind.version > 0) d.prepare('UPDATE minds SET n_scored = ? WHERE version = ?').run(rows.length, mind.version);
    return null;
  }
  const version = mind.version + 1;
  const at = nowIso();
  const changes = [...r.changes];

  const tx = d.transaction(() => {
    const lessonIds: number[] = [];
    for (const draft of r.drafts) {
      const info = d
        .prepare(
          `INSERT INTO lessons (kind, category, statement, evidence, status, born_version, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(draft.kind, draft.category, draft.statement, JSON.stringify(draft.evidence), version, at);
      const id = Number(info.lastInsertRowid);
      lessonIds.push(id);
      changes.push(`New lesson L${id}.`);
      for (const old of draft.replaces) {
        d.prepare(`UPDATE lessons SET status = 'retired', retired_version = ?, retired_reason = ? WHERE id = ? AND status = 'active'`).run(
          version,
          `replaced by L${id}`,
          old,
        );
        changes.push(`Retired L${old}.`);
      }
      const memId = enqueueMemory(
        'lessons',
        lessonText({ id, kind: draft.kind, category: draft.category, statement: draft.statement, version, retires: draft.replaces }),
        `lesson:${id}`,
      );
      d.prepare('UPDATE lessons SET memory_id = ? WHERE id = ?').run(memId, id);
    }
    for (const ret of r.retire) {
      d.prepare(`UPDATE lessons SET status = 'retired', retired_version = ?, retired_reason = ? WHERE id = ? AND status = 'active'`).run(
        version,
        ret.reason,
        ret.id,
      );
      changes.push(`Retired L${ret.id}: ${ret.reason}.`);
    }

    const stats = {
      trust: Object.fromEntries(
        Object.entries(r.fit.trustFits).map(([c, f]) => [c, { n: f.n, ols: f.ols, brierRaw: f.brierRaw, brierMarket: f.brierMarket }]),
      ),
      calib: r.fit.calibFit,
      lessons: lessonIds,
    };
    d.prepare(`INSERT INTO minds (version, created_at, sim_time, policy, diff, n_scored, stats) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      version,
      at,
      simTime.toISOString(),
      JSON.stringify(r.fit.policy),
      JSON.stringify(changes),
      rows.length,
      JSON.stringify(stats),
    );
    const memId = enqueueMemory(
      'mind',
      mindText({ version, at: simTime.toISOString(), nScored: rows.length, policy: r.fit.policy, changes }),
      `mind:${version}`,
    );
    d.prepare('UPDATE minds SET memory_id = ? WHERE version = ?').run(memId, version);
  });
  tx();
  logActivity('reflect', `Mind v${version}: ${changes.slice(0, 3).join(' ')}`, `mind:${version}`);
  return version;
}
