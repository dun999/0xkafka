import { NextResponse } from 'next/server';
import { runForecast, decidesAt } from '@/src/agent/forecast';
import { config } from '@/src/config';
import { db, logActivity } from '@/src/db/client';
import { resolveMarketRef, toRow } from '@/src/markets/polymarket';
import { getMarket, upsertMarket } from '@/src/markets/store';
import { charge, recordSale } from '@/src/pay/mpp';
import { forecastPayload, marketDetail, suiscanTx } from '@/src/views';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * On demand: 0xkafka forecasts any open two-outcome Polymarket question.
 * 0.005 USDC over MPP on Sui. The question is checked before any payment is asked for,
 * and it joins 0xkafka's watchlist, so it is scored and learned from when it resolves.
 */
export async function POST(req: Request) {
  let ref = '';
  try {
    ref = String(((await req.clone().json()) as { market?: unknown }).market ?? '');
  } catch {
    return bad('Send JSON: {"market": "<polymarket url or slug>"}');
  }
  if (!ref) return bad('Send JSON: {"market": "<polymarket url or slug>"}');
  if (!config.llm.apiKey && process.env.LLM_MOCK !== '1') return bad('0xkafka cannot forecast right now', 503);

  const found = await resolveMarketRef(ref).catch(() => null);
  if (!found) return bad('No open two-outcome Polymarket question found for that reference');
  const row = toRow(found.ev, found.m, 'demand');
  if (!row) return bad('0xkafka covers sports, politics, crypto, economy and culture questions with two outcomes');
  if (row.status !== 'open') return bad('That question is closed');
  if (row.price === null) return bad('That question has no market price yet');
  if (decidesAt(row).getTime() < Date.now() + 15 * 60_000) return bad('That question is decided too soon to forecast fairly');

  const existing = db().prepare(`SELECT id FROM forecasts WHERE market_id = ? AND mode = 'live'`).get(row.id);
  if (existing) {
    return NextResponse.json(
      { error: '0xkafka already has a forecast for this question', buy: `${config.publicUrl}/api/v1/signal/${row.id}`, price_usdc: config.prices.signal },
      { status: 409 },
    );
  }

  const paid = await charge(req, config.prices.onDemand, `0xkafka on-demand forecast: ${row.question}`.slice(0, 200));
  if (!paid.paid) return paid.response;
  recordSale({ digest: paid.digest, payer: paid.payer, amount: config.prices.onDemand, endpoint: 'forecast-on-demand', marketId: row.id });

  if (!getMarket(row.id)) upsertMarket(row);
  try {
    await runForecast({ market: row, marketP: row.price, now: new Date(), mode: 'live' });
  } catch (e) {
    logActivity('error', `On-demand forecast failed after payment ${paid.digest}: ${e instanceof Error ? e.message : e}`, row.id);
    return paid.withReceipt(
      NextResponse.json(
        {
          error: 'Paid, but the forecast failed. Collect it later with this header; it costs nothing more.',
          collect: { url: `${config.publicUrl}/api/v1/forecast/${row.id}`, header: { 'x-kafka-credit': paid.digest } },
          receipt: { digest: paid.digest, suiscan: suiscanTx(paid.digest) },
        },
        { status: 503 },
      ),
    );
  }
  const d = marketDetail(row.id)!;
  return paid.withReceipt(
    NextResponse.json({ sealed: true, ...forecastPayload(d.m, d.f!, row.price), receipt: { digest: paid.digest, suiscan: suiscanTx(paid.digest), payer: paid.payer } }),
  );
}
