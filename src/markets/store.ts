import { db } from '../db/client';
import type { MarketRow } from './polymarket';

export function upsertMarket(m: MarketRow): void {
  db()
    .prepare(
      `INSERT INTO markets (id, slug, event_slug, event_title, question, rules, category, tags, outcome_a, outcome_b, yes_token, end_date, start_time, volume, image, price, price_at, status, outcome, closed_at, source, added_at)
       VALUES (@id, @slug, @event_slug, @event_title, @question, @rules, @category, @tags, @outcome_a, @outcome_b, @yes_token, @end_date, @start_time, @volume, @image, @price, @price_at, @status, @outcome, @closed_at, @source, @added_at)
       ON CONFLICT(id) DO UPDATE SET
         price = excluded.price, price_at = excluded.price_at, volume = excluded.volume,
         status = excluded.status, outcome = excluded.outcome, closed_at = excluded.closed_at,
         end_date = excluded.end_date, start_time = excluded.start_time`,
    )
    .run(m);
}

export function getMarket(id: string): MarketRow | undefined {
  return db().prepare('SELECT * FROM markets WHERE id = ?').get(id) as MarketRow | undefined;
}

export function updateMarketState(id: string, patch: Partial<Pick<MarketRow, 'price' | 'price_at' | 'status' | 'outcome' | 'closed_at'>>): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db()
    .prepare(`UPDATE markets SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`)
    .run({ ...patch, id });
}
