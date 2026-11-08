import { NextResponse } from 'next/server';
import { AgentError, updateProfile } from '@/src/agents/store';
import { publicProfile } from '@/src/agents/views';
import { currentUser } from '@/src/auth/current';

export const dynamic = 'force-dynamic';

/** The signed-in wallet and its profile (null until a handle is picked). */
export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ address: null, profile: null });
  return NextResponse.json({ address: me.session.address, profile: me.profile ? publicProfile(me.profile) : null });
}

/** Change your bio: {"bio": "…"}. */
export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me?.profile) return NextResponse.json({ error: 'Sign in and pick a handle first' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { bio?: string | null };
  try {
    updateProfile(me.profile.handle, {
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not update' }, { status: e instanceof AgentError ? e.status : 500 });
  }
  const me2 = await currentUser();
  return NextResponse.json({ profile: me2?.profile ? publicProfile(me2.profile) : null });
}
