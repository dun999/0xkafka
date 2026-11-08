import { CATEGORIES, type Category } from '../markets/categories';

// 0xkafka's policy is everything it has learned from its record, as numbers.
// No model writes these: they are fitted in code from scored forecasts.

export interface Policy {
  /** How far 0xkafka trusts its own view over the market, per category. 0 = copy the market, 1 = ignore it. */
  trust: Record<Category, number>;
  /** Calibration on the log-odds scale. >1 sharpens, <1 softens. */
  calib: number;
  /** Categories where 0xkafka's own view has added nothing; it stops covering them. */
  benched: Category[];
}

export interface ScoredRow {
  category: Category;
  market: number; // market price of outcome A at forecast time
  raw: number; // 0xkafka's raw view (with recalled memory, before the policy)
  outcome: 0 | 1;
}

export const PRIOR_TRUST = 0.5;
export const PRIOR_WEIGHT = 10; // pseudo-observations pulling trust toward the prior
export const MIN_CALIB_N = 20;
export const BENCH_BELOW = 0.15;
export const UNBENCH_AT = 0.25;
export const BENCH_MIN_N = 15;

export const DEFAULT_POLICY: Policy = {
  trust: Object.fromEntries(CATEGORIES.map((c) => [c, PRIOR_TRUST])) as Record<Category, number>,
  calib: 1,
  benched: [],
};

export const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const logit = (p: number) => Math.log(p / (1 - p));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export const brier = (p: number, y: 0 | 1) => (p - y) ** 2;

/** Skill of `p` over a baseline: 1 − Brier(p) / Brier(base), in [−1, 1]. Null with no rows. */
export function relSkill(rows: { p: number; base: number; outcome: 0 | 1 }[]): number | null {
  if (!rows.length) return null;
  let bp = 0;
  let bb = 0;
  for (const r of rows) {
    bp += brier(r.p, r.outcome);
    bb += brier(r.base, r.outcome);
  }
  return Math.max(-1, Math.min(1, 1 - bp / Math.max(bb, 0.02 * rows.length)));
}

/** Pull an estimate from `n` observations toward `prior` with `k` pseudo-observations. */
export const shrinkTo = (s: number | null, n: number, prior: number, k: number) => (s === null || n === 0 ? prior : (n * s + k * prior) / (n + k));

export function calibrate(p: number, a: number): number {
  return clampP(sigmoid(a * logit(clampP(p))));
}

export interface Applied {
  trust: number;
  blend: number;
  calib: number;
  final: number;
}

/** Turn a raw view into 0xkafka's forecast: blend with the market by learned trust, then calibrate. */
export function applyPolicy(policy: Policy, category: Category, raw: number, market: number): Applied {
  const trust = policy.trust[category] ?? PRIOR_TRUST;
  const blend = clampP(market + trust * (raw - market));
  return { trust, blend, calib: policy.calib, final: calibrate(blend, policy.calib) };
}

/** What 0xkafka would say with no memory: a fixed half-trust blend, no calibration. */
export const blankForecast = (blankRaw: number, market: number) => clampP(market + PRIOR_TRUST * (blankRaw - market));

export interface TrustFit {
  trust: number;
  n: number;
  /** Unshrunk least-squares weight, for display. */
  ols: number | null;
  brierRaw: number;
  brierMarket: number;
}

/**
 * Least-squares weight w for `market + w·(raw − market)` against outcomes,
 * shrunk toward `prior` with `k` pseudo-observations, kept in [0, 1].
 */
export function fitTrust(rows: ScoredRow[], prior = PRIOR_TRUST, k = PRIOR_WEIGHT): TrustFit {
  const n = rows.length;
  if (n === 0) return { trust: prior, n, ols: null, brierRaw: 0, brierMarket: 0 };
  let num = 0;
  let den = 0;
  let br = 0;
  let bm = 0;
  for (const r of rows) {
    const d = r.raw - r.market;
    num += (r.outcome - r.market) * d;
    den += d * d;
    br += brier(r.raw, r.outcome);
    bm += brier(r.market, r.outcome);
  }
  const ols = den > 1e-9 ? clamp01(num / den) : null;
  const trust = ols === null ? prior : clamp01((n * ols + k * prior) / (n + k));
  return { trust, n, ols, brierRaw: br / n, brierMarket: bm / n };
}

export interface CalibFit {
  calib: number;
  n: number;
  brierBefore: number;
  brierAfter: number;
}

/** Minimum Brier improvement before calibration moves away from 1. Smaller gains are noise. */
export const CALIB_MIN_GAIN = 0.002;

/**
 * Grid search over a ∈ [0.6, 1.4] for σ(a·logit(blend)), applied to blends under the given trust.
 * Among settings within a hair of the best, the one closest to 1 wins, so calibration only
 * moves when it measurably helps.
 */
export function fitCalibration(rows: ScoredRow[], trust: Record<Category, number>): CalibFit {
  const n = rows.length;
  const blends = rows.map((r) => clampP(r.market + (trust[r.category] ?? PRIOR_TRUST) * (r.raw - r.market)));
  const score = (a: number) => blends.reduce((s, b, i) => s + brier(calibrate(b, a), rows[i].outcome), 0) / Math.max(1, n);
  const before = score(1);
  if (n < MIN_CALIB_N) return { calib: 1, n, brierBefore: before, brierAfter: before };
  const grid: { a: number; s: number }[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.round((0.6 + i * 0.05) * 100) / 100;
    grid.push({ a, s: score(a) });
  }
  const bestScore = Math.min(...grid.map((g) => g.s));
  if (before - bestScore < CALIB_MIN_GAIN) return { calib: 1, n, brierBefore: before, brierAfter: before };
  const near = grid.filter((g) => g.s <= bestScore + 0.0005).sort((x, y) => Math.abs(x.a - 1) - Math.abs(y.a - 1))[0];
  return { calib: near.a, n, brierBefore: before, brierAfter: near.s };
}

export interface PolicyFit {
  policy: Policy;
  trustFits: Record<Category, TrustFit>;
  calibFit: CalibFit;
}

export function fitPolicy(rows: ScoredRow[], prev: Policy): PolicyFit {
  const trustFits = {} as Record<Category, TrustFit>;
  const trust = {} as Record<Category, number>;
  for (const c of CATEGORIES) {
    const fit = fitTrust(rows.filter((r) => r.category === c));
    trustFits[c] = fit;
    trust[c] = Math.round(fit.trust * 100) / 100;
  }
  const calibFit = fitCalibration(rows, trust);
  const benched = CATEGORIES.filter((c) => {
    const f = trustFits[c];
    const was = prev.benched.includes(c);
    if (f.n < BENCH_MIN_N) return was;
    return was ? trust[c] < UNBENCH_AT : trust[c] < BENCH_BELOW;
  });
  return { policy: { trust, calib: calibFit.calib, benched }, trustFits, calibFit };
}
