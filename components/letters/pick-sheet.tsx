'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Seal } from '@/components/letters/seal';
import { Button } from '@/components/ui/button';
import { useSession } from '@/components/wallet/session';
import { cn } from '@/lib/utils';

// Make a prediction: choose a side, say how sure you are, add one line if you
// like. It is saved to Walrus, hidden from others until predictions close.

export interface SheetMarket {
  id: string;
  outcome_a: string;
  outcome_b: string;
  price: number | null;
  lock_at: string;
}

export interface Hint {
  text: string;
  tone: 'warn' | 'good' | 'info';
}

const sureWord = (c: number) => (c >= 90 ? 'Lock it in' : c >= 75 ? 'Confident' : c >= 60 ? 'Fairly sure' : 'A lean');

export function PickSheet({
  market,
  hints = [],
  initialSide = null,
  backing = false,
}: {
  market: SheetMarket;
  hints?: Hint[];
  initialSide?: 'a' | 'b' | null;
  /** The signed-in person bought 0xkafka's signal on this question: their prediction won't be ranked. */
  backing?: boolean;
}) {
  const { me, signIn, status } = useSession();
  const router = useRouter();
  const [side, setSide] = useState<'a' | 'b' | null>(initialSide);
  const [conf, setConf] = useState(65);
  const [take, setTake] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ id: string; pick: string; confidence: number } | null>(null);

  const signedIn = !!me.profile;
  const pA = market.price;
  const tile = (k: 'a' | 'b') => {
    const name = k === 'a' ? market.outcome_a : market.outcome_b;
    const p = pA === null ? null : k === 'a' ? pA : 1 - pA;
    const on = side === k;
    return (
      <button
        key={k}
        type="button"
        onClick={() => setSide(k)}
        aria-pressed={on}
        className={cn(
          'flex h-14 min-w-0 flex-col items-start justify-center rounded-[var(--radius-sm)] px-3.5 text-left transition-colors',
          k === 'a'
            ? on
              ? 'bg-side-a-solid text-white'
              : 'bg-side-a-subtle text-side-a hover:bg-side-a-solid/25'
            : on
              ? 'bg-side-b-solid text-white'
              : 'bg-side-b-subtle text-side-b hover:bg-side-b-solid/25',
        )}
      >
        <span className="w-full truncate text-body font-semibold leading-tight">{name}</span>
        <span className={cn('num mt-0.5 text-caption', on ? 'text-white/80' : 'opacity-75')}>market {p === null ? '—' : `${Math.round(p * 100)}%`}</span>
      </button>
    );
  };

  async function seal() {
    if (!side) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/v1/picks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ market_id: market.id, pick: side === 'a' ? market.outcome_a : market.outcome_b, confidence: conf, take }),
      });
      const j = (await r.json()) as { id?: string; pick?: string; confidence?: number; error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? 'Could not save the prediction');
      setSealed({ id: j.id, pick: j.pick!, confidence: j.confidence! });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the prediction');
    } finally {
      setBusy(false);
    }
  }

  if (sealed && me.profile) return <JustSealed id={sealed.id} handle={me.profile.handle} pick={sealed.pick} confidence={sealed.confidence} />;

  return (
    <div className="panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title-2 font-semibold">Your prediction</h2>
        <span className="text-caption text-fg-3">One per question, final</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">{[tile('a'), tile('b')]}</div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <label htmlFor="conf" className="text-body-sm font-medium text-fg-2">
            How sure are you?
          </label>
          <span className="flex items-baseline gap-2">
            <span className="text-caption text-fg-3">{sureWord(conf)}</span>
            <span className="num text-title-1 font-semibold">{conf}%</span>
          </span>
        </div>
        <input
          id="conf"
          type="range"
          min={50}
          max={99}
          value={conf}
          onChange={(e) => setConf(Number(e.target.value))}
          className="range mt-3 w-full"
          style={{ ['--fill' as string]: `${((conf - 50) / 49) * 100}%` }}
        />
        <div className="mt-1 flex justify-between text-caption text-fg-4">
          <span>50% coin flip</span>
          <span>99% certain</span>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="text-body-sm font-medium text-fg-2">
          Your take <span className="font-normal text-fg-4">· optional</span>
        </span>
        <textarea
          value={take}
          onChange={(e) => setTake(e.target.value.slice(0, 280))}
          rows={2}
          placeholder="Why? Shown with your prediction."
          className="mt-2 w-full resize-none rounded-[var(--radius-sm)] border border-line bg-subtle px-3 py-2.5 text-body-sm outline-none transition-colors placeholder:text-fg-4 focus:border-line-strong focus:bg-surface focus-visible:outline-none"
        />
      </label>

      {hints.length ? (
        <div className="mt-3 rounded-[var(--radius-sm)] bg-memory-subtle px-3.5 py-3 text-caption leading-snug">
          <p className="font-medium text-memory">From your memory on Walrus</p>
          <ul className="mt-1.5 space-y-1.5">
            {hints.map((h) => (
              <li key={h.text} className={cn(h.tone === 'warn' ? 'text-negative' : h.tone === 'good' ? 'text-positive' : 'text-fg-2')}>
                {h.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {err ? <p className="mt-3 text-caption text-negative">{err}</p> : null}

      <div className="mt-5">
        {signedIn ? (
          <>
          {backing ? <p className="mb-3 text-caption text-fg-3">You bought 0xkafka&apos;s signal here, so this one won&apos;t count toward your win rate.</p> : null}
          <Button variant="seal" size="lg" className="w-full" onClick={() => void seal()} disabled={!side || busy}>
            {busy ? 'Saving…' : side ? `Predict ${side === 'a' ? market.outcome_a : market.outcome_b} at ${conf}%` : 'Choose a side'}
          </Button>
          </>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={signIn} disabled={status === 'signing'}>
            {me.address ? 'Pick your handle' : 'Sign in to predict'}
          </Button>
        )}
        <p className="mt-3 text-center text-caption leading-snug text-fg-3">Saved on Walrus. Others see it when predictions close.</p>
      </div>
    </div>
  );
}

/** The moment after predicting: saved, then waiting for its Walrus blob, then share. */
function JustSealed({ id, handle, pick, confidence }: { id: string; handle: string; pick: string; confidence: number }) {
  const [blob, setBlob] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let n = 0;
    const tick = async () => {
      if (stop || n++ > 60) return;
      const r = await fetch(`/api/v1/picks/${id}`).then((x) => x.json()).catch(() => null);
      const b = r?.pick?.walrus?.blob as string | null | undefined;
      if (b) setBlob(b);
      else setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id]);


  return (
    <div className="panel">
      <div className="flex flex-col items-center px-6 pb-7 pt-9 text-center">
        <div className="seal-press relative">
          <Seal seed={handle} size={72} />
          <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-positive text-white ring-4 ring-surface" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.2 5 8.6l4.5-5" />
            </svg>
          </span>
        </div>
        <h2 className="mt-5 text-title-1 font-semibold">Prediction saved</h2>
        <p className="mt-2 text-body text-fg-2">
          <span className="font-medium text-fg">{pick}</span> at <span className="num">{Math.round(confidence * 100)}%</span>. Others see it when predictions close.
        </p>
        <div className="mt-4 flex items-center gap-2 text-caption">
          {blob ? (
            <a href={`https://walruscan.com/mainnet/blob/${blob}`} target="_blank" rel="noreferrer" className="num text-memory hover:underline">
              On Walrus · {blob.slice(0, 10)}…
            </a>
          ) : (
            <span className="text-fg-3">Writing to Walrus mainnet…</span>
          )}
        </div>
        <div className="mt-6 grid w-full gap-2">
          <Button href={`/pick/${id}`} variant="primary" size="lg">
            Share to X
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button href={`/p/${handle}`} variant="secondary">
              My profile
            </Button>
            <Button href="/desk" variant="secondary">
              Predict another
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
