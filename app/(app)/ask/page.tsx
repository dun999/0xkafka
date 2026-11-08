import Link from 'next/link';
import type { Turn } from '@/components/app/ask-chat';
import { AskWorkspace } from '@/components/app/ask-workspace';
import { assistantLessons } from '@/src/assistant/lessons';
import { CHAT_ID, getChat, listChats } from '@/src/chat/store';
import { currentUser } from '@/src/auth/current';
import { nsName, profileNs } from '@/src/config';
import { db } from '@/src/db/client';
import { isMock } from '@/src/memory/walrus';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Talk' };

export default async function TalkPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const me = await currentUser();
  const profile = me?.profile ? { handle: me.profile.handle, display: me.profile.display } : null;
  const ns = profile ? nsName(profileNs(profile.handle)) : null;
  const mine = ns ? (db().prepare(`SELECT COUNT(*) n FROM memories WHERE namespace = ? AND status = 'done'`).get(ns) as { n: number }).n : 0;

  const footnote = profile ? (
    <>
      Your assistant reads your {mine} {mine === 1 ? 'memory' : 'memories'} in <span className="mono text-memory">{ns}</span> and learns its own lessons about you. Never
      reveals anyone else&apos;s hidden prediction.
    </>
  ) : (
    <>
      Never reveals a hidden prediction or gives betting advice.{' '}
      <Link href="/me" className="font-medium text-fg-2 underline-offset-2 hover:underline">
        Sign in
      </Link>{' '}
      to talk about your own record.
    </>
  );

  const chats = profile ? listChats(profile.handle) : [];
  const open = profile && c && CHAT_ID.test(c) ? getChat(profile.handle, c) : null;
  return (
    <AskWorkspace
      mock={isMock()}
      me={profile}
      footnote={footnote}
      chats={chats}
      initial={open ? { id: open.id, turns: open.turns as unknown as Turn[] } : null}
      lessons={profile ? assistantLessons(profile.handle) : null}
    />
  );
}
