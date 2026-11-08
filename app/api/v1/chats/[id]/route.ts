import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/src/auth/current';
import { CHAT_ID, deleteChat, getChat, MAX_TURNS, saveChat, type StoredTurn } from '@/src/chat/store';

export const dynamic = 'force-dynamic';

// One conversation with 0xkafka. Only the person who had it can read, save or delete it.

const Turns = z.object({
  turns: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }).passthrough()).max(MAX_TURNS),
});

async function owner() {
  const me = await currentUser();
  return me?.profile?.handle ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const handle = await owner();
  if (!handle) return NextResponse.json({ error: 'Sign in to see your chats' }, { status: 401 });
  const c = getChat(handle, (await ctx.params).id);
  return c ? NextResponse.json(c) : NextResponse.json({ error: 'No such chat' }, { status: 404 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const handle = await owner();
  if (!handle) return NextResponse.json({ error: 'Sign in to keep your chats' }, { status: 401 });
  const { id } = await ctx.params;
  if (!CHAT_ID.test(id)) return NextResponse.json({ error: 'Bad chat id' }, { status: 400 });
  const body = Turns.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Send {"turns": [{role, content, …}]}' }, { status: 400 });
  try {
    if (!saveChat(handle, id, body.data.turns as StoredTurn[])) return NextResponse.json({ error: 'No such chat' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save' }, { status: 413 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const handle = await owner();
  if (!handle) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  return deleteChat(handle, (await ctx.params).id) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'No such chat' }, { status: 404 });
}
