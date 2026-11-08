import { NextResponse } from 'next/server';
import { currentUser } from '@/src/auth/current';
import { db, nowIso } from '@/src/db/client';

export const dynamic = 'force-dynamic';

/** The author shares their prediction: from now on everyone can read it, and the share card shows it. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await currentUser();
  if (!me?.profile) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const r = db().prepare('SELECT handle, shared_at FROM submissions WHERE id = ?').get(id) as { handle: string; shared_at: string | null } | undefined;
  if (!r) return NextResponse.json({ error: 'No such prediction' }, { status: 404 });
  if (r.handle !== me.profile.handle) return NextResponse.json({ error: 'Only its author can share it' }, { status: 403 });
  const at = r.shared_at ?? nowIso();
  if (!r.shared_at) db().prepare('UPDATE submissions SET shared_at = ? WHERE id = ?').run(at, id);
  return NextResponse.json({ id, shared_at: at });
}
