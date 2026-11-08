'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// What your assistant has learned about you, from your own memory. Its own lessons,
// not 0xkafka's: they change as you predict, get results and talk to it.

export interface LessonView {
  n: number;
  kind: 'edge' | 'leak' | 'habit' | 'taste';
  statement: string;
  evidence: string;
  replaces: number | null;
  created_at: string;
  blob: string | null;
}
export interface EarlierView {
  n: number;
  statement: string;
  reason: string;
  retired_at: string;
}
export interface LessonsData {
  version: number;
  reflected_at: string | null;
  active: LessonView[];
  earlier: EarlierView[];
}

const KIND: Record<LessonView['kind'], { label: string; tone: string }> = {
  edge: { label: 'Where you do well', tone: 'text-positive' },
  leak: { label: 'Where you lose', tone: 'text-negative' },
  habit: { label: 'How you predict', tone: 'text-memory' },
  taste: { label: 'What you care about', tone: 'text-fg-2' },
};

const FRESH_MS = 30 * 60_000;

export function AssistantLessons({ initial, mock }: { initial: LessonsData; mock: boolean }) {
  const [data, setData] = useState(initial);
  const [showEarlier, setShowEarlier] = useState(false);

  // The assistant reflects in the background; pick up what it learned without a reload.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const r = await fetch('/api/v1/me/lessons').catch(() => null);
      if (r?.ok) setData((await r.json()) as LessonsData);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section aria-label="Your assistant's lessons" className="min-h-0">
      <div className="flex items-baseline justify-between gap-2 px-2">
        <h2 className="text-caption font-semibold text-fg-2">What I learned about you</h2>
        {data.version ? <span className="text-micro text-fg-4">v{data.version}</span> : null}
      </div>
      <p className="mt-0.5 px-2 text-micro text-fg-4">My own lessons, from your memory. Separate from 0xkafka&apos;s.</p>
      {data.active.length ? (
        <ol className="mt-2 space-y-1">
          {data.active.map((l) => {
            const fresh = Date.now() - Date.parse(l.created_at) < FRESH_MS;
            return (
              <li key={l.n} className="rounded-[var(--radius-sm)] px-2 py-2 hover:bg-hover" title={`Evidence: ${l.evidence}`}>
                <p className="flex items-center gap-1.5 text-micro font-medium">
                  <span className={KIND[l.kind].tone}>{KIND[l.kind].label}</span>
                  <span className="text-fg-4">A{l.n}</span>
                  {fresh ? <span className="rounded-full bg-memory-subtle px-1.5 text-memory">New</span> : null}
                </p>
                <p className="mt-0.5 text-caption leading-snug text-fg">{l.statement}</p>
                <p className="mt-1 flex flex-wrap gap-x-2 text-micro text-fg-4">
                  {l.replaces ? <span>Replaces A{l.replaces}</span> : null}
                  {l.blob && !mock ? (
                    <a href={`https://walruscan.com/mainnet/blob/${l.blob}`} target="_blank" rel="noreferrer" className="hover:text-memory">
                      On Walrus ↗
                    </a>
                  ) : (
                    <span>Saving to Walrus</span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-2 px-2 text-caption text-fg-3">Nothing yet. I learn from your predictions, your results and what you ask me.</p>
      )}
      {data.earlier.length ? (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            aria-expanded={showEarlier}
            className="w-full px-2 py-1.5 text-left text-micro font-medium text-fg-3 hover:text-fg"
          >
            Changed my mind ({data.earlier.length}) {showEarlier ? '▴' : '▾'}
          </button>
          {showEarlier ? (
            <ol className="space-y-1.5 px-2 pb-1">
              {data.earlier.map((l) => (
                <li key={l.n} className="text-micro text-fg-4">
                  <span className={cn('text-fg-3 line-through decoration-fg-4/60')}>
                    A{l.n} {l.statement}
                  </span>{' '}
                  {l.reason}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
