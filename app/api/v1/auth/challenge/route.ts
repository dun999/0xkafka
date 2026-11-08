import { NextResponse } from 'next/server';
import { signInMessage, SUI_ADDRESS_RE } from '@/src/auth/session';

export const dynamic = 'force-dynamic';

/** Step 1 of wallet sign-in: the message to sign. Nothing is stored. */
export async function POST(req: Request) {
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !SUI_ADDRESS_RE.test(address)) return NextResponse.json({ error: 'Send {"address": "0x…"}' }, { status: 400 });
  const issuedAt = new Date().toISOString();
  return NextResponse.json({ message: signInMessage(address, issuedAt), issuedAt });
}
