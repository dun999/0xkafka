import { candles, priceAtTime } from '../chain/tatum';

// For crypto questions 0xkafka gets a quantitative anchor from Tatum's Price API:
// spot at forecast time, 30-day realised volatility, and a driftless lognormal
// probability for the strike in the question.

const ASSETS: [RegExp, string][] = [
  [/\bbitcoin\b|\bbtc\b/i, 'BTC'],
  [/\bethereum\b|\beth\b/i, 'ETH'],
  [/\bsolana\b|\bsol\b/i, 'SOL'],
  [/\bxrp\b|\bripple\b/i, 'XRP'],
  [/\bsui\b/i, 'SUI'],
  [/\bdogecoin\b|\bdoge\b/i, 'DOGE'],
  [/\bbnb\b/i, 'BNB'],
  [/\bhyperliquid\b|\bhype\b/i, 'HYPE'],
  [/\bcardano\b|\bada\b/i, 'ADA'],
];

export type CryptoKind = 'above' | 'below' | 'between' | 'reach' | 'dip';

export interface CryptoQuestion {
  symbol: string;
  kind: CryptoKind;
  k1: number;
  k2?: number;
}

const money = (s: string) => {
  const m = s.replace(/,/g, '').match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[2] ? v * (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : v;
};

export function parseCryptoQuestion(q: string): CryptoQuestion | null {
  const asset = ASSETS.find(([re]) => re.test(q));
  if (!asset) return null;
  const symbol = asset[1];
  const amounts = [...q.matchAll(/\$\s?([\d,]+(?:\.\d+)?\s*[kKmM]?)/g)].map((m) => money(m[1])).filter(Number.isFinite);
  if (!amounts.length) return null;
  if (/between/i.test(q) && amounts.length >= 2) return { symbol, kind: 'between', k1: Math.min(amounts[0], amounts[1]), k2: Math.max(amounts[0], amounts[1]) };
  if (/\b(dip|fall|drop)\b/i.test(q)) return { symbol, kind: 'dip', k1: amounts[0] };
  if (/\b(reach|hit|touch)\b/i.test(q)) return { symbol, kind: 'reach', k1: amounts[0] };
  if (/\b(below|under|less than)\b/i.test(q)) return { symbol, kind: 'below', k1: amounts[0] };
  if (/\b(above|over|greater than|higher than)\b/i.test(q)) return { symbol, kind: 'above', k1: amounts[0] };
  return null;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Driftless lognormal probabilities. sigma is annualised, years is the horizon. */
export function modelProbability(q: CryptoQuestion, spot: number, sigma: number, years: number): number {
  const s = Math.max(1e-6, sigma * Math.sqrt(Math.max(years, 1 / (365 * 24))));
  const pAbove = (k: number) => normCdf((Math.log(spot / k) - 0.5 * s * s) / s);
  switch (q.kind) {
    case 'above':
      return pAbove(q.k1);
    case 'below':
      return 1 - pAbove(q.k1);
    case 'between':
      return Math.max(0, pAbove(q.k1) - pAbove(q.k2!));
    case 'reach':
      return spot >= q.k1 ? 1 : Math.min(1, 2 * (1 - normCdf(Math.log(q.k1 / spot) / s)));
    case 'dip':
      return spot <= q.k1 ? 1 : Math.min(1, 2 * (1 - normCdf(Math.log(spot / q.k1) / s)));
  }
}

export interface CryptoContext {
  symbol: string;
  spot: number;
  at: string;
  vol30d: number;
  hoursLeft: number;
  question: CryptoQuestion;
  model: number;
  source: 'tatum';
}

export async function cryptoContext(question: string, now: Date, closes: Date): Promise<CryptoContext | null> {
  const q = parseCryptoQuestion(question);
  if (!q) return null;
  const spot = await priceAtTime(q.symbol, now);
  if (!spot) return null;
  const daily = await candles(q.symbol, new Date(now.getTime() - 31 * 86_400_000), 31, '1d');
  const closesD = daily.map((c) => c.close).filter((c) => c > 0);
  if (closesD.length < 10) return null;
  const rets = closesD.slice(1).map((c, i) => Math.log(c / closesD[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const vol30d = Math.sqrt(variance * 365);
  const hoursLeft = Math.max(0, (closes.getTime() - now.getTime()) / 3_600_000);
  const model = modelProbability(q, spot, vol30d, hoursLeft / (24 * 365));
  return { symbol: q.symbol, spot, at: now.toISOString(), vol30d, hoursLeft, question: q, model, source: 'tatum' };
}
