export const CATEGORIES = ['sports', 'politics', 'crypto', 'economy', 'culture'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Polymarket tag slugs 0xkafka scans, one query each. */
export const SCAN_TAGS = ['sports', 'crypto', 'politics', 'pop-culture', 'economy', 'business', 'tech'];

const CULTURE = new Set(['pop-culture', 'culture', 'tweets-markets', 'mentions', 'movies', 'music', 'awards', 'tv', 'youtube', 'celebrities', 'tech', 'ai', 'box-office', 'entertainment', 'gaming']);
const CRYPTO = new Set(['crypto', 'crypto-prices', 'bitcoin', 'ethereum', 'solana', 'xrp', 'sui', 'defi', 'memecoins', 'airdrops', 'stablecoins']);
const SPORTS = new Set(['sports', 'games', 'nba', 'nfl', 'soccer', 'mlb', 'nhl', 'tennis', 'esports', 'ufc', 'mma', 'boxing', 'golf', 'f1', 'cricket', 'basketball', 'baseball', 'hockey', 'cfb', 'ncaa', 'wnba', 'ucl', 'epl']);
const ECONOMY = new Set(['economy', 'fed', 'fed-rates', 'stocks', 'finance', 'business', 'earnings', 'commodities', 'inflation', 'gdp', 'macro', 'interest-rates', 'oil']);
const POLITICS = new Set(['politics', 'elections', 'us-election', 'geopolitics', 'world', 'midterms', 'trump', 'global-elections', 'senate-elections', 'congress']);

/** Tags that mark questions too short or too random to forecast. */
const SKIP = new Set(['up-or-down', '5M', '15M', '1H', 'hourly', '4h']);

/**
 * Maps a Polymarket event's tag slugs to one category.
 * Order matters: a tweet-count market tagged "politics" is a culture question,
 * and a crypto-price market tagged "economy" is a crypto question.
 */
export function categorize(tags: string[]): Category | null {
  const t = tags.map((s) => s.toLowerCase());
  if (t.some((s) => SKIP.has(s) || SKIP.has(s.toUpperCase()))) return null;
  if (t.includes('tweets-markets') || t.includes('mentions')) return 'culture';
  if (t.some((s) => CRYPTO.has(s))) return 'crypto';
  if (t.some((s) => SPORTS.has(s))) return 'sports';
  if (t.some((s) => ECONOMY.has(s))) return 'economy';
  if (t.some((s) => POLITICS.has(s))) return 'politics';
  if (t.some((s) => CULTURE.has(s))) return 'culture';
  return null;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  sports: 'Sports',
  politics: 'Politics',
  crypto: 'Crypto',
  economy: 'Economy',
  culture: 'Culture',
};
