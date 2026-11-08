'use client';

import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * The card that goes to X, shown as it will look, with the ways to send it: post
 * (X draws the card from the page's og:image), save the image, or copy the link.
 * When the author shares a prediction that is still hidden, sharing makes it public first.
 */
export function ShareCard({ id, text, path, reveal }: { id: string; text: string; path: string; reveal: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!reveal);
  const [v, setV] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const image = `/api/v1/picks/${id}/card${v ? `?v=${v}` : ''}`;
  const abs = (p: string) => (typeof window === 'undefined' ? p : `${window.location.origin}${p}`);

  async function makePublic(): Promise<boolean> {
    if (shown) return true;
    const r = await fetch(`/api/v1/picks/${id}/share`, { method: 'POST' }).catch(() => null);
    if (!r?.ok) {
      setErr('Could not share it. Try again.');
      return false;
    }
    setShown(true);
    setV(Date.now());
    return true;
  }

  async function post() {
    // Open the tab now, so the browser doesn't block it after the request.
    const w = window.open('', '_blank');
    if (w) w.opener = null;
    if (!(await makePublic())) return w?.close();
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(abs(path))}`;
    if (w) w.location.href = url;
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function save() {
    if (!(await makePublic())) return;
    const a = document.createElement('a');
    a.href = `/api/v1/picks/${id}/card?v=${Date.now()}`;
    a.download = `0xkafka-${id}.png`;
    a.click();
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
        <h2 className="text-title-3 font-semibold">Share card</h2>
        <span className="text-caption text-fg-3">This is what X shows</span>
      </div>
      <div className="px-5 pt-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="The share card" width={1200} height={630} className="aspect-[1200/630] w-full rounded-[var(--radius-sm)] border border-line bg-subtle" />
      </div>
      <p className="px-5 pt-3 text-body-sm text-fg-2">{text}</p>
      {!shown ? <p className="px-5 pt-2 text-caption text-fg-3">Sharing shows your pick to everyone now, before predictions close.</p> : null}
      {err ? <p className="px-5 pt-2 text-caption text-negative">{err}</p> : null}
      <div className="flex flex-wrap gap-2 px-5 pb-5 pt-4">
        <Button variant="primary" onClick={() => void post()}>
          Post to X
        </Button>
        <button type="button" onClick={() => void save()} className={buttonVariants({ variant: 'secondary' })}>
          Save image
        </button>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(abs(path)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>
    </section>
  );
}
