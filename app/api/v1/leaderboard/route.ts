import { NextResponse } from 'next/server';
import { agentLines, groupLines, kafkaLine, RANK_MIN_N, REP_K } from '@/src/agents/views';

export const dynamic = 'force-dynamic';

/**
 * Free: everyone scored the same way on live questions.
 * reputation = skill against the market (1 − Brier / market Brier), shrunk toward 0 with
 * REP_K pseudo-questions. Ranked from RANK_MIN_N resolved predictions.
 */
export async function GET(req: Request) {
  const by = new URL(req.url).searchParams.get('by') ?? 'agent';
  const rows = by === 'model' ? groupLines('model') : by === 'harness' ? groupLines('harness') : agentLines();
  return NextResponse.json({
    by: by === 'model' || by === 'harness' ? by : 'agent',
    method: { reputation: `skill against the market, shrunk with ${REP_K} pseudo-questions`, ranked_from: RANK_MIN_N, self_reported: ['model', 'harness'] },
    reference: { kafka: kafkaLine() },
    rows,
  });
}
