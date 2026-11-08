import { NextResponse } from 'next/server';
import { marketWindow } from '@/src/agents/views';
import { config } from '@/src/config';
import { db } from '@/src/db/client';
import { CATEGORIES } from '@/src/markets/categories';
import type { MarketRow } from '@/src/markets/polymarket';
import { blobOf, walruscanBlob } from '@/src/memory/walrus';
import { lettersFor, phaseOf } from '@/src/picks/board';
import { polymarketUrl } from '@/src/views';

export const dynamic = 'force-dynamic';

/**
 * Free: every open question on 0xkafka's list.
 *   ?q=real madrid   search the question and event
 *   ?category=sports one of sports, politics, crypto, economy, culture (esports counts as sports)
 *   ?open=1          only questions still taking submissions
 * Each question lists its predictions: who made them and when, and the prediction
 * itself once predictions close (free).
 */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const q = (u.get('q') ?? '').trim().slice(0, 100);
  const cat = u.get('category');
  const category = cat && (CATEGORIES as readonly string[]).includes(cat) ? cat : null;
  const rows = db()
    .prepare(
      `SELECT m.*, f.memory_id f_memory, f.made_at f_made_at FROM markets m
       LEFT JOIN forecasts f ON f.market_id = m.id AND f.mode = 'live'
       WHERE m.status IN ('open','closed') AND m.source IN ('live','demand')
         ${q ? `AND (m.question LIKE @q OR m.event_title LIKE @q OR m.slug LIKE @q)` : ''}
         ${category ? 'AND m.category = @category' : ''}
       ORDER BY COALESCE(m.start_time, m.end_date) LIMIT 300`,
    )
    .all({ q: `%${q}%`, category }) as (MarketRow & { f_memory: number | null; f_made_at: string | null })[];

  const base = config.publicUrl;
  const markets = rows
    .map((m) => {
      const w = marketWindow(m);
      const blob = blobOf(m.f_memory);
      const phase = phaseOf(m);
      const picks = lettersFor(m.id, { handle: null })
        .filter((l) => l.status === 'sealed')
        .map((l) => ({
          id: l.id,
          by: l.namespace,
          display: l.display,
          kind: l.kind,
          at: l.submitted_at,
          prediction: l.prediction ? { pick: l.prediction.pick, confidence: l.prediction.confidence } : null,
          url: `${base}/api/v1/picks/${l.id}`,
        }));
      return {
        id: m.id,
        question: m.question,
        event: m.event_title,
        category: m.category,
        outcome_a: m.outcome_a,
        outcome_b: m.outcome_b,
        market_price: m.price,
        decides_at: m.start_time ?? m.end_date,
        submissions_close: w.lock_at,
        submissions_open: w.submissions_open,
        submissions: w.submissions,
        polymarket: polymarketUrl(m),
        page: `${base}/m/${m.id}`,
        forecast: { sealed: true, made_at: m.f_made_at, walrus_blob: blob, walruscan: blob ? walruscanBlob(blob) : null },
        prediction: { status: w.prediction, buy: `${base}/api/v1/forecast/${m.id}`, price_usdc: config.prices.signal },
        picks,
      };
    })
    .filter((m) => u.get('open') !== '1' || m.submissions_open);
  return NextResponse.json({ markets, count: markets.length, submit: { method: 'POST', url: `${base}/api/v1/submissions` } });
}
