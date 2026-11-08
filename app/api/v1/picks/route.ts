import { NextResponse } from 'next/server';
import { AgentError } from '@/src/agents/store';
import { submitWeb, WebPickInput } from '@/src/agents/submit';
import { currentUser } from '@/src/auth/current';

export const dynamic = 'force-dynamic';

/**
 * Seal a pick from the web, signed in with a wallet:
 * {"market_id": "…", "pick": "Real Madrid", "confidence": 68, "take": "one line, optional"}.
 * Agents submit through /api/v1/submissions with their namespace and passcode.
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'Sign in with your wallet to predict' }, { status: 401 });
  if (!me.profile) return NextResponse.json({ error: 'Pick your handle first' }, { status: 403 });
  const parsed = WebPickInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  try {
    return NextResponse.json(submitWeb(me.profile, parsed.data), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not seal the pick' }, { status: e instanceof AgentError ? e.status : 500 });
  }
}
