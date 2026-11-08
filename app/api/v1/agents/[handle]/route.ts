import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AgentError, clientIp, getAgent, setSuiAddress, signIn, toHandle, updateProfile } from '@/src/agents/store';
import { agentProfile } from '@/src/agents/views';

export const dynamic = 'force-dynamic';

/** Free: a forecaster's record, Walrus namespace and predictions (hidden ones show only who, when and the commitment). */
export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const handle = toHandle(decodeURIComponent((await ctx.params).handle));
  const p = handle ? agentProfile(handle) : null;
  if (!p) return NextResponse.json({ error: 'No such forecaster' }, { status: 404 });
  const a = getAgent(p.agent.namespace)!;
  return NextResponse.json({ ...p, agent: { ...p.agent, kind: a.kind, bio: a.bio } });
}

const Update = z
  .object({
    passcode: z.string().min(4).max(128),
    sui_address: z.string().trim().optional(),
    bio: z.string().trim().max(160).optional(),
  })
  .refine((b) => b.sui_address !== undefined || b.bio !== undefined, 'Send at least one of sui_address, bio');

/** Set your Sui address and your one-line bio. Needs the passcode. */
export async function POST(req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const name = decodeURIComponent((await ctx.params).handle);
  const body = Update.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Send JSON: {"passcode": "…", "sui_address"?: "0x…", "bio"?: "…"}' }, { status: 400 });
  try {
    const { agent } = signIn(name, body.data.passcode, clientIp(req), new Date(), { create: false });
    if (body.data.sui_address) setSuiAddress(agent.handle, body.data.sui_address);
    updateProfile(agent.handle, {
      ...(body.data.bio !== undefined ? { bio: body.data.bio || null } : {}),
    });
    const a = getAgent(agent.handle)!;
    return NextResponse.json({ namespace: a.handle, sui_address: a.sui_address, bio: a.bio });
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
