import { CATEGORIES, CATEGORY_LABEL, type Category } from '../markets/categories';
import { CALIB_MIN_GAIN, fitPolicy, MIN_CALIB_N, PRIOR_TRUST, type Policy, type PolicyFit, type ScoredRow } from './policy';

// Reflection turns scored memories into a new policy and, when something
// changed enough to matter, into lessons. All wording is templated in code,
// so every number in a lesson is a measured one.

export const LESSON_MOVE = 0.1; // how far a parameter must move from its last lesson to earn a new one
export const LESSON_MIN_N = 8;

/** `postmortem` lessons come from agents' resolved predictions (see postmortem.ts); the rest from the numbers here. */
export type LessonKind = 'trust' | 'calibration' | 'bench' | 'postmortem';

export interface ActiveLesson {
  id: number;
  kind: LessonKind;
  category: Category | null;
  /** The parameter value this lesson set (trust or calibration). */
  value: number;
}

export interface LessonDraft {
  kind: LessonKind;
  category: Category | null;
  statement: string;
  evidence: Record<string, number | string>;
  replaces: number[];
}

export interface Reflection {
  fit: PolicyFit;
  changes: string[];
  drafts: LessonDraft[];
  retire: { id: number; reason: string }[];
  changed: boolean;
}

const f2 = (n: number) => n.toFixed(2);
const f3 = (n: number) => n.toFixed(3);

export function reflect(rows: ScoredRow[], prev: Policy, active: ActiveLesson[]): Reflection {
  const fit = fitPolicy(rows, prev);
  const next = fit.policy;
  const changes: string[] = [];
  const drafts: LessonDraft[] = [];
  const retire: { id: number; reason: string }[] = [];

  const moved = CATEGORIES.filter((c) => Math.abs(next.trust[c] - (prev.trust[c] ?? PRIOR_TRUST)) >= 0.01);
  if (moved.length) changes.push(`Trust: ${moved.map((c) => `${c} ${f2(prev.trust[c] ?? PRIOR_TRUST)} → ${f2(next.trust[c])}`).join(', ')}.`);

  for (const c of CATEGORIES) {
    const after = next.trust[c];

    const tf = fit.trustFits[c];
    const anchorLesson = active.find((l) => l.kind === 'trust' && l.category === c);
    const anchor = anchorLesson?.value ?? PRIOR_TRUST;
    if (tf.n >= LESSON_MIN_N && Math.abs(after - anchor) >= LESSON_MOVE) {
      const label = CATEGORY_LABEL[c];
      const statement =
        after < anchor
          ? `In ${label} the market beat my own view: my raw calls scored Brier ${f3(tf.brierRaw)} against the market's ${f3(tf.brierMarket)} over ${tf.n} questions. I now trust my own view ${f2(after)} (was ${f2(anchor)}).`
          : `In ${label} my own view added information beyond the market over ${tf.n} questions (raw Brier ${f3(tf.brierRaw)}, market ${f3(tf.brierMarket)}). I now trust my own view ${f2(after)} (was ${f2(anchor)}).`;
      drafts.push({
        kind: 'trust',
        category: c,
        statement,
        evidence: { n: tf.n, value: after, was: anchor, brierRaw: tf.brierRaw, brierMarket: tf.brierMarket },
        replaces: anchorLesson ? [anchorLesson.id] : [],
      });
    }

    const wasBenched = prev.benched.includes(c);
    const isBenched = next.benched.includes(c);
    if (!wasBenched && isBenched) {
      changes.push(`Benched ${c}.`);
      drafts.push({
        kind: 'bench',
        category: c,
        statement: `I am benching ${CATEGORY_LABEL[c]}: over ${tf.n} questions my own view added almost nothing beyond the market (trust ${f2(after)}). I stop covering new ${CATEGORY_LABEL[c]} questions until that changes.`,
        evidence: { n: tf.n, value: after },
        replaces: [],
      });
    } else if (wasBenched && !isBenched) {
      changes.push(`Back to covering ${c}.`);
      for (const l of active.filter((l) => l.kind === 'bench' && l.category === c)) {
        retire.push({ id: l.id, reason: `trust in ${c} recovered to ${f2(after)}` });
      }
    }
  }

  const cf = fit.calibFit;
  if (Math.abs(next.calib - prev.calib) >= 0.01) changes.push(`Calibration ${f2(prev.calib)} → ${f2(next.calib)}.`);
  const calibLesson = active.find((l) => l.kind === 'calibration');
  const calibAnchor = calibLesson?.value ?? 1;
  if (cf.n >= MIN_CALIB_N && Math.abs(next.calib - calibAnchor) >= LESSON_MOVE && (next.calib === 1 || cf.brierBefore - cf.brierAfter >= CALIB_MIN_GAIN)) {
    const statement =
      next.calib === 1
        ? `My forecasts are calibrated again across ${cf.n} questions: no adjustment beats leaving them as they are, so I stop adjusting (calibration 1.00, was ${f2(calibAnchor)}).`
        : next.calib < calibAnchor
        ? `My forecasts were too confident across ${cf.n} questions. I now soften them (calibration ${f2(next.calib)}, was ${f2(calibAnchor)}), which takes my Brier from ${f3(cf.brierBefore)} to ${f3(cf.brierAfter)} on the record.`
        : `My forecasts were too timid across ${cf.n} questions. I now sharpen them (calibration ${f2(next.calib)}, was ${f2(calibAnchor)}), which takes my Brier from ${f3(cf.brierBefore)} to ${f3(cf.brierAfter)} on the record.`;
    drafts.push({
      kind: 'calibration',
      category: null,
      statement,
      evidence: { n: cf.n, value: next.calib, was: calibAnchor, brierBefore: cf.brierBefore, brierAfter: cf.brierAfter },
      replaces: calibLesson ? [calibLesson.id] : [],
    });
  }

  return { fit, changes, drafts, retire, changed: changes.length > 0 || drafts.length > 0 || retire.length > 0 };
}
