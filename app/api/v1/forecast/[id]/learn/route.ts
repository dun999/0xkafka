import { NextResponse } from 'next/server';
import { assistantLessons, reflect } from '@/src/assistant/lessons';
import { saveSignal, savedSignal } from '@/src/assistant/saved';
import { currentUser } from '@/src/auth/current';
import { logActivity } from '@/src/db/client';
import { ownsSignal } from '@/src/picks/signals';
import { isSealed, marketDetail } from '@/src/views';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// "Learn from this signal": save 0xkafka's signal to your own Walrus memory, and let your
// assistant learn from it right away. Only for a signal you bought, or one made public by
// its result. Private to you.

async function who() {
  const me = await currentUser();
  return me?.profile ? { handle: me.profile.handle, display: me.profile.display, address: me.session.address } : null;
}

/** Whether you saved it, and its Walrus blob once written. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await who();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const s = savedSignal(me.handle, (await ctx.params).id);
  return NextResponse.json(s ? { saved: true, ...s } : { saved: false });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await who();
  if (!me) return NextResponse.json({ error: 'Sign in to save it to your memory' }, { status: 401 });
  const id = (await ctx.params).id;
  const d = marketDetail(id);
  if (!d?.f || d.m.source === 'backtest') return NextResponse.json({ error: '0xkafka has no signal on this question' }, { status: 404 });
  if (isSealed(d.m) && !ownsSignal(me.address, d.m.id)) return NextResponse.json({ error: 'Buy the signal first' }, { status: 403 });

  const saved = saveSignal(me, d.m, d.f);
  const before = new Map(assistantLessons(me.handle).active.map((l) => [l.n, l]));
  let changed: { added: number[]; retired: number[]; version: number } | null = null;
  if (saved.fresh) {
    try {
      changed = await Promise.race([reflect(me.handle), new Promise<null>((r) => setTimeout(() => r(null), 90_000))]);
    } catch (e) {
      logActivity('error', `Assistant could not reflect for ${me.handle}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const after = assistantLessons(me.handle);
  return NextResponse.json({
    saved: true,
    memory_id: saved.memory_id,
    blob: saved.blob,
    learned: {
      version: after.version,
      added: after.active.filter((l) => changed?.added.includes(l.n)),
      retired: (changed?.retired ?? []).map((n) => ({ n, statement: before.get(n)?.statement ?? '', reason: after.earlier.find((e) => e.n === n)?.reason ?? '' })),
      reflected: changed !== null,
    },
  });
}
