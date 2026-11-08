import { categorize, type Category } from './categories';

// Polymarket is only a source of questions and a price to beat. 0xkafka never trades.
const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

export interface GammaTag {
  slug?: string;
  label?: string;
}

export interface GammaMarket {
  id: string;
  slug: string;
  question: string;
  description?: string;
  outcomes?: string; // JSON string array
  outcomePrices?: string; // JSON string array
  clobTokenIds?: string; // JSON string array
  endDate?: string;
  gameStartTime?: string | null;
  closed?: boolean;
  active?: boolean;
  closedTime?: string | null;
  umaResolutionStatus?: string | null;
  volumeNum?: number;
  volume?: string | number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  image?: string;
  events?: GammaEvent[];
}

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  description?: string;
  endDate?: string;
  tags?: GammaTag[];
  markets?: GammaMarket[];
  image?: string;
  volume?: number;
}

export interface MarketRow {
  id: string;
  slug: string;
  event_slug: string | null;
  event_title: string | null;
  question: string;
  rules: string | null;
  category: Category;
  tags: string;
  outcome_a: string;
  outcome_b: string;
  yes_token: string | null;
  end_date: string | null;
  start_time: string | null;
  volume: number | null;
  image: string | null;
  price: number | null;
  price_at: string | null;
  status: 'open' | 'closed' | 'resolved' | 'void';
  outcome: number | null;
  closed_at: string | null;
  source: 'live' | 'backtest' | 'demand';
  added_at: string;
}

async function getJson<T>(url: string, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return null as T;
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

const parseArr = (s?: string): string[] => {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export function outcomesOf(m: GammaMarket): [string, string] | null {
  const o = parseArr(m.outcomes);
  return o.length === 2 ? [o[0], o[1]] : null;
}

/** 1 if the first outcome won, 0 if the second won, 'void' for a 50/50 or cancelled close, null if still open. */
export function parseResolution(m: GammaMarket): 1 | 0 | 'void' | null {
  if (!m.closed) return null;
  const p = parseArr(m.outcomePrices).map(Number);
  if (p.length !== 2) return null;
  if (p[0] >= 0.99 && p[1] <= 0.01) return 1;
  if (p[1] >= 0.99 && p[0] <= 0.01) return 0;
  if (m.umaResolutionStatus === 'resolved') return 'void';
  return null; // closed for trading, waiting for the oracle
}

/** Mid of the book when it is tight, else last trade, else the listed price. Price of the first outcome. */
export function livePrice(m: GammaMarket): number | null {
  const bid = Number(m.bestBid);
  const ask = Number(m.bestAsk);
  if (bid > 0 && ask > 0 && ask - bid <= 0.1) return (bid + ask) / 2;
  if (m.lastTradePrice && m.lastTradePrice > 0) return Number(m.lastTradePrice);
  const p = parseArr(m.outcomePrices).map(Number);
  return p.length === 2 && Number.isFinite(p[0]) ? p[0] : null;
}

const volumeOf = (m: GammaMarket) => Number(m.volumeNum ?? m.volume ?? 0) || 0;

/** The main question of an event: its highest-volume two-outcome market. */
export function pickMarket(ev: GammaEvent): GammaMarket | null {
  if (/more markets/i.test(ev.title)) return null;
  const ms = (ev.markets ?? []).filter((m) => outcomesOf(m) && !/up or down/i.test(m.question));
  if (!ms.length) return null;
  return ms.reduce((a, b) => (volumeOf(b) > volumeOf(a) ? b : a));
}

export function tagSlugs(ev: GammaEvent): string[] {
  return (ev.tags ?? []).map((t) => (t.slug ?? t.label ?? '').toLowerCase()).filter(Boolean);
}

export function toRow(ev: GammaEvent, m: GammaMarket, source: MarketRow['source'], now = new Date()): MarketRow | null {
  const outs = outcomesOf(m);
  const tags = tagSlugs(ev);
  const category = categorize(tags);
  if (!outs || !category) return null;
  const tokens = parseArr(m.clobTokenIds);
  const res = parseResolution(m);
  return {
    id: String(m.id),
    slug: m.slug,
    event_slug: ev.slug ?? null,
    event_title: ev.title ?? null,
    question: m.question,
    rules: (m.description || ev.description || '').slice(0, 4000) || null,
    category,
    tags: JSON.stringify(tags),
    outcome_a: outs[0],
    outcome_b: outs[1],
    yes_token: tokens[0] ?? null,
    end_date: m.endDate ?? ev.endDate ?? null,
    start_time: m.gameStartTime ? new Date(m.gameStartTime.replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString() : null,
    volume: volumeOf(m),
    image: m.image ?? ev.image ?? null,
    price: livePrice(m),
    price_at: now.toISOString(),
    status: res === null ? (m.closed ? 'closed' : 'open') : res === 'void' ? 'void' : 'resolved',
    outcome: res === 1 ? 1 : res === 0 ? 0 : null,
    closed_at: m.closedTime ? new Date(m.closedTime.replace(' ', 'T').replace(/\+00(:00)?$/, 'Z')).toISOString() : null,
    source,
    added_at: now.toISOString(),
  };
}

export interface EventQuery {
  closed: boolean;
  endMin: Date;
  endMax: Date;
  tag?: string;
  limit?: number;
  order?: 'volume' | 'volume24hr';
}

export async function fetchEvents(q: EventQuery): Promise<GammaEvent[]> {
  const p = new URLSearchParams({
    closed: String(q.closed),
    end_date_min: q.endMin.toISOString(),
    end_date_max: q.endMax.toISOString(),
    limit: String(q.limit ?? 100),
    order: q.order ?? 'volume',
    ascending: 'false',
  });
  if (q.tag) p.set('tag_slug', q.tag);
  if (!q.closed) p.set('active', 'true');
  return (await getJson<GammaEvent[]>(`${GAMMA}/events?${p}`)) ?? [];
}

export async function fetchMarket(id: string): Promise<GammaMarket | null> {
  return getJson<GammaMarket | null>(`${GAMMA}/markets/${encodeURIComponent(id)}`);
}

export async function fetchMarketBySlug(slug: string): Promise<GammaMarket | null> {
  return getJson<GammaMarket | null>(`${GAMMA}/markets/slug/${encodeURIComponent(slug)}`);
}

export async function fetchEventBySlug(slug: string): Promise<GammaEvent | null> {
  return getJson<GammaEvent | null>(`${GAMMA}/events/slug/${encodeURIComponent(slug)}`);
}

export interface PricePoint {
  t: number; // unix seconds
  p: number;
}

export async function priceHistory(token: string, startTs: number, endTs: number, fidelityMin = 60): Promise<PricePoint[]> {
  const p = new URLSearchParams({ market: token, startTs: String(startTs), endTs: String(endTs), fidelity: String(fidelityMin) });
  const r = await getJson<{ history?: PricePoint[] }>(`${CLOB}/prices-history?${p}`);
  return r?.history ?? [];
}

/** Last traded price of the first outcome at or before `at` (searching 12h back). */
export async function priceAt(token: string, at: Date): Promise<number | null> {
  const end = Math.floor(at.getTime() / 1000);
  const hist = await priceHistory(token, end - 12 * 3600, end, 30);
  const last = hist.filter((h) => h.t <= end).at(-1);
  return last ? last.p : null;
}

/** Accepts a Polymarket URL, an event slug, or a market slug. Returns the event and the chosen market. */
export async function resolveMarketRef(ref: string): Promise<{ ev: GammaEvent; m: GammaMarket } | null> {
  const s = ref.trim();
  const slug = s.includes('polymarket.com') ? s.replace(/[?#].*$/, '').split('/').filter(Boolean).at(-1) ?? '' : s;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;
  const m = await fetchMarketBySlug(slug).catch(() => null);
  if (m && outcomesOf(m)) {
    const evSlug = m.events?.[0]?.slug;
    const ev = evSlug ? await fetchEventBySlug(evSlug).catch(() => null) : null;
    if (ev) return { ev, m };
  }
  const ev = await fetchEventBySlug(slug).catch(() => null);
  if (!ev) return null;
  const pick = pickMarket(ev);
  return pick ? { ev, m: pick } : null;
}
