'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ActionCard, CardView, type Card, type ChatAction, type ChatOps } from '@/components/app/chat-cards';
import { Seal } from '@/components/letters/seal';
import { cn } from '@/lib/utils';

/** A Walrus memory the answer was given (see src/chat/context.ts). */
type Source = { blob: string; ns: string; kind: string; label?: string; title: string; detail: string; owner: string; recalled?: boolean };
export type Turn = {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  done?: boolean;
  /** Buttons under a model answer: signals for sale, open questions, or a prediction form. */
  action?: ChatAction | null;
  /** A turn the app made itself: confirm a payment, a bought signal, an offer to post. */
  card?: Card;
  /** When it was said; questions count toward the daily streak. */
  at?: string;
};

const newChatId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const PUBLIC = [
  { title: 'Where do you beat the market?', prompt: 'Where do you beat the market, and where does it beat you?' },
  { title: 'Your latest lesson', prompt: 'What was your last lesson, and what changed because of it?' },
  { title: 'Who do you trust?', prompt: 'Whose predictions do you trust most, and why?' },
  { title: 'This week in sports', prompt: 'How did your sports signals go this week?' },
];

const PERSONAL = [
  { title: 'How am I doing?', prompt: 'How am I doing? Be honest.' },
  { title: 'Where is my edge?', prompt: 'Where do I have an edge, and where should I stop picking?' },
  { title: 'Am I overconfident?', prompt: 'Am I overconfident? Compare my confidence with my results.' },
  { title: 'What have you learned about me?', prompt: 'What have you learned about me?' },
];

const BLOB_GROUP = /(\[[^\]]*blob:[^\]]*\])/g;
const blobsIn = (group: string) => [...group.matchAll(/blob:([A-Za-z0-9_-]{6,})/g)].map((m) => m[1]);

/** Blob ids an answer cites, numbered in order of first citation. */
function citations(text: string): Map<string, number> {
  const n = new Map<string, number>();
  for (const g of text.match(BLOB_GROUP) ?? []) for (const b of blobsIn(g)) if (!n.has(b)) n.set(b, n.size + 1);
  return n;
}

const walruscan = (blob: string) => `https://walruscan.com/mainnet/blob/${blob}`;
const isMockBlob = (blob: string, mock: boolean) => mock || blob.startsWith('mock');

/** One numbered citation: links to the blob on Walruscan. */
function Cite({ blob, n, mock }: { blob: string; n: number; mock: boolean }) {
  const cls = 'mx-[1px] inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-memory-subtle px-1 align-[2px] text-[11px] font-semibold leading-none text-memory';
  return isMockBlob(blob, mock) ? (
    <span className={cls} title={`Memory ${blob} (dev mock, not on Walrus)`}>
      {n}
    </span>
  ) : (
    <a href={walruscan(blob)} target="_blank" rel="noreferrer" className={cn(cls, 'hover:bg-memory hover:text-white')} title={`Walrus blob ${blob}`}>
      {n}
    </a>
  );
}

/** "**bold**" and blob citations inside a line. */
function inline(text: string, cites: Map<string, number>, mock: boolean, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]*blob:[^\]]*\])/g).map((part, i) => {
    const k = `${key}-${i}`;
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={k} className="font-semibold text-fg">{bold[1]}</strong>;
    if (!/^\[[^\]]*blob:/.test(part)) return part;
    return (
      <span key={k} className="whitespace-nowrap">
        {blobsIn(part).map((b) => (
          <Cite key={b} blob={b} n={cites.get(b) ?? 0} mock={mock} />
        ))}
      </span>
    );
  });
}

/** Paragraphs and bullet lists; nothing else is interpreted. A half-streamed "[blob:…" is held back. */
function Rich({ text, mock }: { text: string; mock: boolean }) {
  const shown = text
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[[^\]]*$/, '')
    .replace(/\s*\[[^\]]*$/, (m) => (/blob|^\s*\[$/.test(m) ? '' : m));
  const cites = citations(shown);
  const blocks = shown.trim().split(/\n{2,}/);
  return (
    <div className="space-y-3.5">
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)))
          return (
            <ul key={bi} className="space-y-1.5 pl-5 [list-style:disc] marker:text-fg-4">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), cites, mock, `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li ? <br /> : null}
                {inline(l, cites, mock, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const KIND: Record<string, string> = {
  forecast: 'Forecast',
  outcome: 'Outcome',
  lesson: 'Lesson',
  submission: 'Prediction',
  result: 'Result',
  insight: 'Insight',
  note: 'Note',
  mind: 'Mind',
  trust: 'Lesson',
  assistant_lesson: 'Lesson',
  saved_signal: 'Saved signal',
};

function SourceRow({ src, n, mock, me }: { src: Source; n: number; mock: boolean; me: string | null }) {
  const mockBlob = isMockBlob(src.blob, mock);
  const yours = me !== null && src.owner === me;
  const body = (
    <>
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-memory-subtle text-[11px] font-semibold text-memory">{n}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-fg">{src.title || src.label}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-fg-3">
          <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium', yours ? 'bg-memory-subtle text-memory' : 'bg-subtle text-fg-2')}>
            {yours ? 'Your memory' : src.owner === '0xkafka' ? '0xkafka' : `@${src.owner}`}
          </span>
          <span className="shrink-0">{KIND[src.kind] ?? src.kind}</span>
          {src.detail ? <span className="truncate">{src.detail}</span> : null}
        </span>
      </span>
      <span className="mono mt-0.5 hidden shrink-0 text-caption text-fg-4 group-hover:text-memory sm:block">
        {src.blob.slice(0, 6)}…{mockBlob ? '' : ' ↗'}
      </span>
    </>
  );
  return (
    <li>
      {mockBlob ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-sm)] px-2.5 py-2">{body}</div>
      ) : (
        <a
          href={walruscan(src.blob)}
          target="_blank"
          rel="noreferrer"
          title={`Walrus blob ${src.blob} in ${src.ns}`}
          className="group flex items-start gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors hover:bg-hover"
        >
          {body}
        </a>
      )}
    </li>
  );
}

/**
 * Under an answer: the Walrus memories behind it. The ones the answer cites, numbered
 * as in the text; then, folded away, the rest recalled for this message.
 */
/** The Walrus memories the answer cites, numbered as in the text. Nothing it didn't use. */
function Sources({ text, sources, mock, me }: { text: string; sources: Source[]; mock: boolean; me: string | null }) {
  const cites = citations(text);
  const byBlob = new Map(sources.map((x) => [x.blob, x]));
  const cited = [...cites.entries()].map(([blob, n]) => ({
    n,
    src: byBlob.get(blob) ?? { blob, ns: 'Walrus', kind: 'memory', label: '', title: 'Memory cited by 0xkafka', detail: '', owner: '0xkafka' },
  }));
  if (!cited.length) return null;
  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 pb-1.5 pt-3 text-caption">
        <span className="font-semibold text-fg-2">From Walrus memory</span>
        <span className="text-fg-4">
          {cited.length} {cited.length === 1 ? 'memory' : 'memories'} used
        </span>
      </div>
      <ul className="px-1.5 pb-1.5">
        {cited.map(({ n, src }) => (
          <SourceRow key={src.blob} src={src} n={n} mock={mock} me={me} />
        ))}
      </ul>
    </div>
  );
}

const fromB64 = (h: string) => {
  const bin = atob(h.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
};

/** The buttons the server decided to show: base64url JSON in a header. */
function readAction(res: Response): ChatAction | null {
  const h = res.headers.get('x-kafka-action');
  try {
    return h ? (fromB64(h) as ChatAction) : null;
  } catch {
    return null;
  }
}

/** Or a tag the model ended its answer with: [[signals:sports]], [[picks]], [[pick:ID]]. */
function tagAction(answer: string): ChatAction | null {
  const t = /\[\[\s*(signals|picks|pick)(?::\s*([A-Za-z0-9_-]+))?\s*\]\]/.exec(answer);
  if (!t) return null;
  if (t[1] === 'pick') return t[2] ? { kind: 'pick', id: t[2] } : { kind: 'picks', category: null, q: null };
  return { kind: t[1] as 'signals' | 'picks', category: t[2]?.toLowerCase() ?? null, q: null };
}

/** The sources header: base64url JSON. Empty if missing or unreadable. */
function readSources(res: Response): Source[] {
  const h = res.headers.get('x-kafka-sources');
  if (!h) return [];
  try {
    return fromB64(h) as Source[];
  } catch {
    return [];
  }
}

/** What happened after an earlier card: was the signal paid for, was the offer answered. */
function pastOf(turns: Turn[], i: number): { paid: boolean; answer: 'yes' | 'no' | null } {
  const card = turns[i].card;
  const later = turns.slice(i + 1);
  const paid = card?.type === 'confirm' ? later.some((t) => t.card?.type === 'signal' && t.card.item.id === card.item.id) : false;
  const reply = later.find((t) => t.role === 'user')?.content;
  return { paid, answer: reply === 'Yes, post it' ? 'yes' : reply === 'No thanks' ? 'no' : null };
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  );
}

export function AskChat({
  mock,
  me,
  footnote,
  chatId = null,
  initialTurns = [],
  onSaved,
}: {
  mock: boolean;
  me: { handle: string; display: string } | null;
  footnote?: ReactNode;
  /** A saved conversation to continue, or null for a new one. */
  chatId?: string | null;
  initialTurns?: Turn[];
  onSaved?: (id: string, title: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  // Turns loaded from an earlier session: their payment cards are history, not live buttons.
  const loaded = useRef(initialTurns.length).current;
  const idRef = useRef<string | null>(chatId);
  const savedLen = useRef(initialTurns.length);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  // Keep the conversation for the signed-in person: after each reply, and after each card.
  useEffect(() => {
    if (!me || busy || turns.length === 0 || turns.length === savedLen.current) return;
    if (turns.some((t) => t.role === 'assistant' && !t.card && !t.done)) return;
    const t = setTimeout(() => {
      const id = (idRef.current ??= newChatId());
      if (!chatId && window.location.search !== `?c=${id}`) window.history.replaceState(null, '', `/ask?c=${id}`);
      const body = turns.map(({ role, content, sources, done, action, card, at }) => ({ role, content, sources, done, action, card, at }));
      void fetch(`/api/v1/chats/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turns: body }) })
        .then((r) => {
          if (!r.ok) return;
          savedLen.current = turns.length;
          onSaved?.(id, (turns.find((x) => x.role === 'user')?.content ?? 'New chat').replace(/\s+/g, ' ').slice(0, 80));
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [turns, busy, me, chatId, onSaved]);

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setInput('');
    requestAnimationFrame(fit);
    const history = turns
      .filter((t) => t.content)
      .slice(-12)
      .map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    setTurns([...turns, { role: 'user', content: text, at: new Date().toISOString() }, { role: 'assistant', content: '' }]);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
    try {
      const res = await fetch('/api/v1/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, history }) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const sources = readSources(res);
      const shown = readAction(res);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let answer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        setTurns((t) => [...t.slice(0, -1), { role: 'assistant', content: answer, sources }]);
        endRef.current?.scrollIntoView({ block: 'end' });
      }
      setTurns((t) => [...t.slice(0, -1), { role: 'assistant', content: answer, sources, done: true, action: shown ?? tagAction(answer) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTurns((t) => t.slice(0, -2));
      setInput(text);
    } finally {
      setBusy(false);
      boxRef.current?.focus();
    }
  }

  const ops: ChatOps = {
    mock,
    push: (...next) => {
      const at = new Date().toISOString();
      setTurns((t) => [...t, ...next.map((x) => ({ ...x, at, ...(x.role === 'assistant' ? { done: true } : {}) }))]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
    },
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const suggestions = me ? PERSONAL : PUBLIC;
  const empty = turns.length === 0;

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(input);
      }}
      className="rounded-[22px] border border-line-strong bg-surface p-2 shadow-[var(--shadow-lift)] transition-colors focus-within:border-fg-4"
    >
      <label htmlFor="ask" className="sr-only">
        Message your assistant
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="ask"
          ref={boxRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            fit();
          }}
          onKeyDown={onKey}
          maxLength={1000}
          placeholder={me ? 'Ask about your record, a question, or the board' : 'Ask about the board or a question'}
          className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-[11px] text-[15.5px] leading-[1.45] outline-none placeholder:text-fg-4 focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-action text-on-action transition-opacity hover:bg-action-hover disabled:opacity-25"
        >
          <SendIcon />
        </button>
      </div>
    </form>
  );

  if (empty)
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-var(--shell-h)-48px)] w-full max-w-[720px] flex-col justify-center py-12">
        <div className="text-center">
          <Seal seed="0xkafka" letter="K" size={52} className="!ring-0" />
          <h1 className="mt-5 text-headline font-semibold">{me ? `Hi ${me.display}, ask me anything.` : 'What do you want to know?'}</h1>
          <p className="mx-auto mt-2 max-w-[52ch] text-body text-fg-3">
            {me
              ? "I'm your own assistant. I learn from your predictions, results and questions, keep my lessons about you on Walrus, and use them when we talk."
              : 'I answer from the board and cite the Walrus memories I recall. Sign in and I learn about you.'}
          </p>
        </div>
        <div className="mt-8">{composer}</div>
        {error ? <p className="mt-3 text-center text-body-sm text-negative">{error}</p> : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => void send(s.prompt)}
              className="rounded-[var(--radius-md)] border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-hover"
            >
              <span className="block text-body-sm font-semibold text-fg">{s.title}</span>
              <span className="mt-0.5 block truncate text-caption text-fg-3">{s.prompt}</span>
            </button>
          ))}
        </div>
        {footnote ? <div className="mt-8 text-center text-caption text-fg-3">{footnote}</div> : null}
      </div>
    );

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--shell-h))] w-full max-w-[720px] flex-col">
      <div className="flex-1 space-y-8 pb-10 pt-10" aria-live="polite">
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] bg-subtle px-4 py-2.5 text-[15.5px] leading-[1.5]">{t.content}</div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-3.5">
              <Seal seed="0xkafka" letter="K" size={30} className="mt-0.5 !ring-0" />
              <div className="min-w-0 flex-1 text-[15.5px] leading-[1.65] text-fg-2">
                {t.card ? (
                  t.card.type === 'posted' ? (
                    <>
                      <Rich text={t.content} mock={mock} />
                      <CardView card={t.card} ops={ops} />
                    </>
                  ) : (
                    <CardView card={t.card} ops={ops} past={i < loaded ? pastOf(turns, i) : undefined} />
                  )
                ) : t.content ? (
                  <>
                    <Rich text={t.content} mock={mock} />
                    {t.done && t.action ? <ActionCard action={t.action} ops={ops} /> : null}
                    {t.done && t.sources && !(t.action && !/blob:/.test(t.content)) ? <Sources text={t.content} sources={t.sources} mock={mock} me={me?.handle ?? null} /> : null}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-2 text-fg-3">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-fg-4 border-t-transparent" aria-hidden />
                    Recalling from Walrus
                  </span>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-0 bg-gradient-to-t from-canvas from-70% to-transparent pb-5 pt-6">
        {error ? <p className="mb-2 text-center text-body-sm text-negative">{error}</p> : null}
        {composer}
        {footnote ? <div className="mt-2.5 text-center text-caption text-fg-4">{footnote}</div> : null}
      </div>
    </div>
  );
}
