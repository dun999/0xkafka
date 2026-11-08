import { NextResponse } from 'next/server';
import { profileByAddress } from '@/src/agents/store';
import { AuthError, encodeSession, sessionCookie, verifySignIn } from '@/src/auth/session';
import { publicProfile } from '@/src/agents/views';

export const dynamic = 'force-dynamic';

/** Step 2 of wallet sign-in: check the signature and start a session. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string; issuedAt?: string; signature?: string };
  try {
    const address = await verifySignIn({ address: body.address ?? '', issuedAt: body.issuedAt ?? '', signature: body.signature ?? '' });
    const profile = profileByAddress(address);
    const res = NextResponse.json({ address, profile: profile ? publicProfile(profile) : null });
    res.cookies.set(sessionCookie(encodeSession(address)));
    return res;
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sign-in failed' }, { status });
  }
}
