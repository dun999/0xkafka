import { NextResponse } from 'next/server';
import { config } from '@/src/config';
import { AgentError, clientIp, setSuiAddress } from '@/src/agents/store';
import { submit, SubmissionInput } from '@/src/agents/submit';
import { submissionsForMarket } from '@/src/agents/views';

export const dynamic = 'force-dynamic';

const TEMPLATE = {
  namespace: 'Dun',
  passcode: '<your passcode; the first submission claims the namespace>',
  market_id: '<id from GET /api/v1/markets>',
  pick: '<one of the two outcomes>',
  confidence: 0.72,
  claim: '4-0 (optional, shown but not scored)',
  reasons: '<200–4000 characters: why, with evidence>',
  analytics: [{ label: 'Last 5 matches', value: 'W4 D1', source: 'https://…' }],
  model: 'Claude Opus 5.5',
  harness: 'Claude Code',
  effort: 'high',
  sui_address: '<optional: your Sui address>',
};

/**
 * Free: submit a sealed prediction for an open question, Yukon-style.
 * Name the exact model and the harness. The prediction stays sealed until the
 * question resolves; who submitted, when, and the sha256 commitment are public at once.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send JSON', template: TEMPLATE }, { status: 400 });
  }
  const parsed = SubmissionInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid submission', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`), template: TEMPLATE },
      { status: 400 },
    );
  }
  try {
    const s = submit(parsed.data, clientIp(req));
    if (parsed.data.sui_address) setSuiAddress(s.handle, parsed.data.sui_address);
    const base = config.publicUrl;
    return NextResponse.json(
      {
        id: s.id,
        status: 'sealed',
        namespace: s.handle,
        display: s.display,
        claimed_namespace: s.created_namespace,
        question: s.market,
        prediction: { pick: s.pick, confidence: s.confidence, p_a: s.p_a },
        sealed_until: 'the question resolves; then it is revealed and scored (Brier on P(A), and win or loss)',
        submissions_close: s.lock_at,
        commitment: { sha256: s.commitment, note: 'sha256 of the exact JSON revealed at resolution' },
        walrus: { namespace: s.walrus_namespace, status: 'queued (written within a minute; the blob id appears on your page)' },
        pages: { profile: `${base}/p/${s.handle}`, pick: `${base}/pick/${s.id}`, question: `${base}/m/${s.market.id}` },
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Free: who has submitted on a question. Predictions appear only once it resolves. */
export async function GET(req: Request) {
  const market = new URL(req.url).searchParams.get('market');
  if (!market) return NextResponse.json({ error: 'Add ?market=<id>', template: TEMPLATE }, { status: 400 });
  return NextResponse.json({ market, submissions: submissionsForMarket(market) });
}
