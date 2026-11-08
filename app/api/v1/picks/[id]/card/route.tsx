import { pickCard } from '@/app/_og/pick-card';

export const dynamic = 'force-dynamic';

/** The prediction's share card as a PNG: the same image X shows. Never shows a hidden pick. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return pickCard((await ctx.params).id);
}
