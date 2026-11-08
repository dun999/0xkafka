'use client';

import { useState, type ReactNode } from 'react';
import { AskChat, type Turn } from '@/components/app/ask-chat';
import { AssistantLessons, type LessonsData } from '@/components/app/assistant-lessons';
import { cn } from '@/lib/utils';

// Talk, with your past conversations on the side. Switching chats happens here,
// in the page, so a reply that is still streaming is never cut off by a reload.

export interface ChatItem {
  id: string;
  title: string;
  updated_at: string;
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function AskWorkspace({
  mock,
  me,
  footnote,
  chats: first,
  initial,
  lessons,
}: {
  mock: boolean;
  me: { handle: string; display: string } | null;
  footnote?: ReactNode;
  chats: ChatItem[];
  initial: { id: string; turns: Turn[] } | null;
  lessons: LessonsData | null;
}) {
  const [chats, setChats] = useState(first);
  const [session, setSession] = useState({ key: 0, id: initial?.id ?? null, turns: initial?.turns ?? [] });
  const [loading, setLoading] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const go = (url: string) => window.history.replaceState(null, '', url);

  function newChat() {
    setSession((s) => ({ key: s.key + 1, id: null, turns: [] }));
    setShowList(false);
    go('/ask');
  }

  async function open(id: string) {
    if (id === session.id) return setShowList(false);
    setLoading(id);
    const r = await fetch(`/api/v1/chats/${id}`).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { id: string; turns: Turn[] }) : null;
    setLoading(null);
    if (!j) return;
    setSession((s) => ({ key: s.key + 1, id: j.id, turns: j.turns }));
    setShowList(false);
    go(`/ask?c=${id}`);
  }

  async function remove(id: string) {
    const r = await fetch(`/api/v1/chats/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) return;
    setChats((c) => c.filter((x) => x.id !== id));
    if (id === session.id) newChat();
  }

  const saved = (id: string, title: string) => {
    setSession((s) => (s.id === id ? s : { ...s, id }));
    setChats((c) => [{ id, title, updated_at: new Date().toISOString() }, ...c.filter((x) => x.id !== id)]);
  };

  const list = (
    <nav aria-label="Your chats" className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={newChat}
        className="flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-body-sm font-medium text-fg transition-colors hover:bg-hover"
      >
        <PlusIcon /> New chat
      </button>
      <p className="mb-1 mt-5 px-2 text-caption font-medium text-fg-3">Your chats</p>
      {chats.length ? (
        <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {chats.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => void open(c.id)}
                aria-current={c.id === session.id ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[var(--radius-sm)] py-2 pl-2 pr-8 text-left text-body-sm transition-colors',
                  c.id === session.id ? 'bg-subtle text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{loading === c.id ? 'Opening…' : c.title}</span>
                <span className="shrink-0 text-micro text-fg-4 group-hover:hidden">{ago(c.updated_at)}</span>
              </button>
              <button
                type="button"
                onClick={() => void remove(c.id)}
                aria-label={`Delete "${c.title}"`}
                title="Delete this chat"
                className="absolute right-1 top-1/2 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-[6px] text-fg-4 hover:bg-subtle hover:text-negative group-hover:grid"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 text-caption text-fg-4">Your conversations are kept here.</p>
      )}
    </nav>
  );

  const chat = <AskChat key={session.key} mock={mock} me={me} footnote={footnote} chatId={session.id} initialTurns={session.turns} onSaved={saved} />;
  if (!me) return chat;
  const learned = lessons ? <AssistantLessons initial={lessons} mock={mock} /> : null;

  return (
    <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
      <aside className="sticky top-[var(--shell-h)] hidden h-[calc(100dvh-var(--shell-h))] flex-col py-6 lg:flex">
        <div className="flex min-h-0 flex-[1_1_40%] flex-col">{list}</div>
        {learned ? <div className="mt-4 min-h-0 flex-[0_1_auto] overflow-y-auto border-t border-line pt-4">{learned}</div> : null}
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 pt-4 lg:hidden">
          <button type="button" onClick={() => setShowList((v) => !v)} aria-expanded={showList} className="text-body-sm font-medium text-fg-2 hover:text-fg">
            Your chats ({chats.length}) {showList ? '▴' : '▾'}
          </button>
          <button type="button" onClick={newChat} className="flex items-center gap-1.5 text-body-sm font-medium text-fg-2 hover:text-fg">
            <PlusIcon /> New chat
          </button>
        </div>
        {showList ? (
          <div className="mt-3 flex max-h-[70dvh] flex-col overflow-y-auto rounded-[var(--radius-md)] border border-line bg-surface p-3 lg:hidden">
            {list}
            {learned ? <div className="mt-4 border-t border-line pt-4">{learned}</div> : null}
          </div>
        ) : null}
        {chat}
      </div>
    </div>
  );
}
