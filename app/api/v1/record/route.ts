import { NextResponse } from 'next/server';
import { currentMind } from '@/src/agent/mind';
import { record } from '@/src/views';

export const dynamic = 'force-dynamic';

/** Free: 0xkafka's track record (mean Brier score, lower is better) for 0xkafka, Blank and the market. */
export async function GET() {
  const mind = currentMind();
  return NextResponse.json({
    scoring: 'mean Brier score of the probability given to outcome A; lower is better',
    by_category: record(),
    live: record({ mode: 'live' }),
    replay: record({ mode: 'backtest' }),
    mind: { version: mind.version, policy: mind.policy, trained_on: mind.nScored },
  });
}
