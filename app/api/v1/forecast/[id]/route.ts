import { NextResponse } from 'next/server';
import { marketWindow } from '@/src/agents/views';
import { config } from '@/src/config';
import { currentUser } from '@/src/auth/current';
import { db, logActivity } from '@/src/db/client';
import { fetchMarket, livePrice } from '@/src/markets/polymarket';
import { callNow, canCallNow, ownsSignal } from '@/src/picks/signals';
import { charge, recordSale } from '@/src/pay/mpp';
import { forecastPayload, isSealed, marketDetail, suiscanTx } from '@/src/views';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function priceNow(id: string, fallback: number | null) {
  const g = await Promise.race([fetchMarket(id).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  return g ? livePrice(g) : fallback;
}

/**
 * 0xkafka's call on one question, sold over MPP (USDC on Sui) until it resolves.
 *   no call yet          buying it makes the call now: 0xkafka reads the picks sealed so far
 *                        and its lessons from Walrus (too close to the decision: 425)
 *   call made            config.prices.signal USDC; half goes to the forecasters it read
 *   already bought       free again for the wallet that paid (signed-in session)
 *   resolved             free: it is part of the public record
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let d = marketDetail(id);
  if (!d || d.m.source === 'backtest') return NextResponse.json({ error: '0xkafka has no call for this question', markets: '/api/v1/markets' }, { status: 404 });
  const { m } = d;

  if (!d.f && !isSealed(m)) return NextResponse.json({ error: '0xkafka made no call on this question' }, { status: 404 });
  if (d.f && !isSealed(m)) {
    const outcome = m.outcome === null ? null : m.outcome ? m.outcome_a : m.outcome_b;
    return NextResponse.json({ sealed: false, outcome, ...forecastPayload(m, d.f, m.price) });
  }

  // Paid before, from this wallet: show it again for free.
  const me = await currentUser();
  if (d.f && me && ownsSignal(me.session.address, m.id)) {
    return NextResponse.json({ sealed: true, owned: true, picks_open: marketWindow(m).submissions_open, ...forecastPayload(m, d.f, await priceNow(m.id, m.price)) });
  }

  // A buyer whose call failed after paying can collect it here.
  const credit = req.headers.get('x-kafka-credit');
  if (credit && d.f && db().prepare('SELECT 1 FROM sales WHERE digest = ? AND market_id = ?').get(credit, m.id)) {
    return NextResponse.json({ sealed: true, credit, ...forecastPayload(m, d.f, await priceNow(m.id, m.price)) });
  }

  // No call yet: check it can be made before asking for any money.
  let price = m.price;
  if (!d.f) {
    if (!canCallNow(m)) {
      const w = marketWindow(m);
      return NextResponse.json({ error: 'Too close to the result for 0xkafka to make a fair call.', decides_at: w.lock_at }, { status: 425 });
    }
    if (!config.llm.apiKey && process.env.LLM_MOCK !== '1') return NextResponse.json({ error: '0xkafka cannot make calls right now' }, { status: 503 });
    price = (await priceNow(m.id, m.price)) ?? m.price;
    // Paid already, but the call failed: make it now without charging again.
    if (me && ownsSignal(me.session.address, m.id)) {
      try {
        await callNow(m, price!);
      } catch {
        return NextResponse.json({ error: '0xkafka could not make the call yet. Try again in a minute; you will not be charged again.' }, { status: 503 });
      }
      const fresh = marketDetail(id)!;
      return NextResponse.json({ sealed: true, owned: true, picks_open: marketWindow(m).submissions_open, ...forecastPayload(m, fresh.f!, price) });
    }
  }

  const paid = await charge(req, config.prices.signal, `0xkafka's call: ${m.question}`.slice(0, 200));
  if (!paid.paid) return paid.response;
  recordSale({ digest: paid.digest, payer: paid.payer, amount: config.prices.signal, endpoint: 'prediction', marketId: m.id });
  const receipt = { digest: paid.digest, suiscan: suiscanTx(paid.digest), payer: paid.payer, rail: 'mpp' as const, amount_usdc: config.prices.signal };

  if (!d.f) {
    try {
      await callNow(m, price!);
    } catch (e) {
      logActivity('error', `Call on request failed after payment ${paid.digest}: ${e instanceof Error ? e.message : e}`, m.id);
      return paid.withReceipt(
        NextResponse.json(
          {
            error: 'Paid, but 0xkafka could not make the call. Open it again in a minute; you will not be charged again.',
            collect: { url: `${config.publicUrl}/api/v1/forecast/${m.id}`, header: { 'x-kafka-credit': paid.digest } },
            receipt,
          },
          { status: 503 },
        ),
      );
    }
    d = marketDetail(id)!;
  }

  return paid.withReceipt(
    NextResponse.json({
      sealed: true,
      picks_open: marketWindow(m).submissions_open,
      ...forecastPayload(m, d.f!, await priceNow(m.id, m.price)),
      receipt,
    }),
  );
}
