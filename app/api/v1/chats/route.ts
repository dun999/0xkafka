import { NextResponse } from 'next/server';
import { currentUser } from '@/src/auth/current';
import { listChats } from '@/src/chat/store';

export const dynamic = 'force-dynamic';

/** Your conversations with 0xkafka, newest first. Signed in only. */
export async function GET() {
  const me = await currentUser();
  if (!me?.profile) return NextResponse.json({ error: 'Sign in to keep your chats' }, { status: 401 });
  return NextResponse.json({ chats: listChats(me.profile.handle) });
}
