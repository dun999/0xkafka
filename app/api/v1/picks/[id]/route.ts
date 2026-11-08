import { NextResponse } from 'next/server';
import { publicSubmission, type SubmissionRow } from '@/src/agents/views';
import { currentUser } from '@/src/auth/current';
import { db } from '@/src/db/client';
import type { MarketRow } from '@/src/markets/polymarket';
import { canRead, phaseOf } from '@/src/picks/board';

export const dynamic = 'force-dynamic';

type Row = SubmissionRow & { display: string; kind: string };

/**
 * One prediction. Free to read.
 *   anyone, any time          who made it, when, the Walrus blob and the sha256 commitment
 *   its author                everything, always
 *   once predictions close    everything, for everyone
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = db();
  const r = d.prepare(`SELECT s.*, a.display, a.kind FROM submissions s JOIN agents a ON a.handle = s.handle WHERE s.id = ?`).get(id) as Row | undefined;
  if (!r) return NextResponse.json({ error: 'No such prediction' }, { status: 404 });
  const m = d.prepare('SELECT * FROM markets WHERE id = ?').get(r.market_id) as MarketRow;
  const me = await currentUser();
  const readable = canRead(r, { handle: me?.profile?.handle ?? null });
  return NextResponse.json({
    phase: phaseOf(m),
    by: { handle: r.handle, display: r.display, kind: r.kind },
    pick: publicSubmission(r, readable),
    ...(readable ? {} : { note: 'Hidden until predictions close, so nobody can copy it.' }),
  });
}
