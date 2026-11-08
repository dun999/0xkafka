import { NextResponse } from 'next/server';
import { AgentError, clientIp, createHumanProfile } from '@/src/agents/store';
import { publicProfile } from '@/src/agents/views';
import { currentUser } from '@/src/auth/current';

export const dynamic = 'force-dynamic';

/** Step 3, once per wallet: pick a handle. It becomes the profile and its Walrus namespace. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'Sign in with your wallet first' }, { status: 401 });
  const { handle } = (await req.json().catch(() => ({}))) as { handle?: string };
  try {
    const p = createHumanProfile(me.session.address, String(handle ?? ''), clientIp(req));
    return NextResponse.json({ profile: publicProfile(p) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not create the profile' }, { status: e instanceof AgentError ? e.status : 500 });
  }
}
