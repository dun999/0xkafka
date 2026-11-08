import { NextResponse } from 'next/server';
import { assistantLessons } from '@/src/assistant/lessons';
import { currentUser } from '@/src/auth/current';

export const dynamic = 'force-dynamic';

/** Your assistant's lessons about you: the ones in force and the ones it changed its mind on. Only yours. */
export async function GET() {
  const me = await currentUser();
  if (!me?.profile) return NextResponse.json({ error: 'Sign in to see your assistant' }, { status: 401 });
  return NextResponse.json(assistantLessons(me.profile.handle));
}
