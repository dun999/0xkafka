import { NextResponse } from 'next/server';
import { profileNs, nsName } from '@/src/config';
import { db } from '@/src/db/client';
import { AgentError, clientIp, rateHit, signIn, toHandle } from '@/src/agents/store';
import { recall, walruscanBlob, type RecallHit } from '@/src/memory/walrus';

export const dynamic = 'force-dynamic';

const RECALLS_PER_HOUR = 30;

/** A submission memory is public once its question resolved, or to its owner. */
function visible(hit: RecallHit, owner: string | null): boolean {
  if (hit.meta.kind !== 'submission') return true;
  if (owner && hit.meta.handle === owner) return true;
  const s = db().prepare('SELECT status FROM submissions WHERE id = ?').get(hit.meta.sub ?? '') as { status: string } | undefined;
  return !!s && s.status !== 'sealed';
}

/**
 * Free: recall resolved memories from Walrus by meaning, so an agent can learn
 * from how similar questions went before it predicts.
 *   ?q=<question>                         0xkafka's scored outcomes (every resolved question)
 *   &namespace=<agent>                    also that agent's results (public once resolved)
 *   &passcode=<passcode>                  also its own sealed submissions
 */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const q = (u.get('q') ?? '').trim();
  if (q.length < 3 || q.length > 300) return NextResponse.json({ error: 'Add ?q=<question or topic, 3–300 characters>' }, { status: 400 });
  const limit = Math.min(10, Math.max(1, Number(u.get('limit') ?? 5) || 5));
  if (!rateHit(`recall:${clientIp(req)}`, RECALLS_PER_HOUR, 3_600_000)) {
    return NextResponse.json({ error: `At most ${RECALLS_PER_HOUR} recalls an hour` }, { status: 429 });
  }

  let handle: string | null = null;
  let owner: string | null = null;
  const ns = u.get('namespace');
  if (ns) {
    handle = toHandle(ns);
    if (!handle) return NextResponse.json({ error: 'Unknown namespace' }, { status: 404 });
    const pass = u.get('passcode');
    if (pass) {
      try {
        owner = signIn(ns, pass, clientIp(req), new Date(), { create: false }).agent.handle;
      } catch (e) {
        if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: e.status });
        throw e;
      }
    }
  }

  const [outcomes, mine] = await Promise.all([
    recall('outcomes', q, { limit, maxDistance: 0.7 }),
    handle ? recall(profileNs(handle), q, { limit, maxDistance: 0.7 }) : Promise.resolve([]),
  ]);
  const shape = (namespace: string) => (h: RecallHit) => ({
    namespace,
    blob_id: h.blob_id,
    walruscan: walruscanBlob(h.blob_id),
    distance: Math.round(h.distance * 1000) / 1000,
    kind: h.meta.kind ?? 'outcome',
    text: h.text.split('\n').filter((l) => !l.startsWith('meta:')).join('\n'),
  });
  return NextResponse.json({
    query: q,
    memories: [
      ...mine.filter((h) => visible(h, owner)).map(shape(nsName(profileNs(handle ?? '')))),
      ...outcomes.map(shape(nsName('outcomes'))),
    ].sort((a, b) => a.distance - b.distance),
  });
}
