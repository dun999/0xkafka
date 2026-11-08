import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, rateHit } from '@/src/agents/store';
import { currentUser } from '@/src/auth/current';
import { actionFromTag, type ChatAction } from '@/src/chat/actions';
import { ask, citedBlobs } from '@/src/chat/ask';
import { config } from '@/src/config';
import { logActivity } from '@/src/db/client';
import type { Source } from '@/src/chat/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PER_IP_HOUR = 20;
const GLOBAL_DAY = 600;

const Body = z.object({
  message: z.string().trim().min(2).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(12)
    .default([]),
});

/**
 * Free: talk to 0xkafka (DeepSeek V4 on Boundless). Answers from the public record and
 * Walrus memory; never sees anyone else's sealed pick. Signed in, it also reads your own
 * record and recalls your own Walrus memory. Streams text unless the client asks for JSON.
 * Nothing is stored beyond the rate-limit counters.
 */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Send JSON: {"message": "…", "history"?: [{role, content}]}' }, { status: 400 });
  if (!config.llm.apiKey && process.env.LLM_MOCK !== '1') return NextResponse.json({ error: 'Chat is unavailable right now' }, { status: 503 });
  if (!rateHit(`ask:${clientIp(req)}`, PER_IP_HOUR, 3_600_000)) {
    return NextResponse.json({ error: `At most ${PER_IP_HOUR} questions an hour. Try again later.` }, { status: 429 });
  }
  if (!rateHit('ask:all', GLOBAL_DAY, 86_400_000)) return NextResponse.json({ error: '0xkafka has answered all it can today. Try tomorrow.' }, { status: 429 });

  const user = await currentUser();
  let sources: Source[];
  let gen: AsyncGenerator<string>;
  let action: ChatAction | null;
  try {
    ({ sources, action, stream: gen } = await ask(body.data.message, body.data.history, user?.profile ? { handle: user.profile.handle, address: user.session.address } : null));
  } catch (e) {
    logActivity('error', `Ask failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: 'Could not reach memory. Try again.' }, { status: 502 });
  }

  if ((req.headers.get('accept') ?? '').includes('application/json')) {
    let answer = '';
    try {
      for await (const t of gen) answer += t;
    } catch (e) {
      logActivity('error', `Ask failed: ${e instanceof Error ? e.message : e}`);
      return NextResponse.json({ error: 'The model did not answer. Try again.' }, { status: 502 });
    }
    const cited = citedBlobs(answer);
    return NextResponse.json({ answer, cited, sources: sources.filter((x) => x.recalled || cited.includes(x.blob)), action: action ?? actionFromTag(answer) });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await gen.next();
        if (done) ctrl.close();
        else ctrl.enqueue(enc.encode(value));
      } catch (e) {
        logActivity('error', `Ask failed: ${e instanceof Error ? e.message : e}`);
        ctrl.enqueue(enc.encode('\n\n[The model stopped answering. Try again.]'));
        ctrl.close();
      }
    },
    cancel() {
      void gen.return(undefined);
    },
  });
  // The Walrus memories the model was given travel in a header, so the body stays plain text.
  const header = Buffer.from(
    JSON.stringify(sources.slice(0, 24).map(({ label: _label, ...x }) => ({ ...x, title: x.title.slice(0, 90), detail: x.detail.slice(0, 90) }))),
  ).toString('base64url');
  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-kafka-sources': header,
      // Buttons to show under the answer; the model may also end with a [[…]] tag.
      ...(action ? { 'x-kafka-action': Buffer.from(JSON.stringify({ ...action, q: 'q' in action ? action.q?.slice(0, 200) ?? null : undefined })).toString('base64url') } : {}),
    },
  });
}
