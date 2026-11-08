'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Seal } from '@/components/letters/seal';
import { cn } from '@/lib/utils';
import { useSession } from './session';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The header's sign-in button, or your seal and a small menu once signed in. */
export function WalletButton({ className }: { className?: string }) {
  const { me, status, error, signIn, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!me.address || !me.profile) {
    const label = status === 'choosing' ? 'Choose a wallet…' : status === 'signing' ? 'Sign in your wallet…' : me.address ? 'Pick your handle' : 'Sign in';
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {error ? <span className="hidden max-w-[220px] truncate text-micro text-negative lg:inline" title={error}>{error}</span> : null}
        <button
          type="button"
          onClick={signIn}
          disabled={status === 'signing'}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-action px-4 text-body-sm font-semibold text-on-action transition-colors hover:bg-action-hover disabled:opacity-60"
        >
          <WalletGlyph />
          {label}
        </button>
      </div>
    );
  }

  const p = me.profile;
  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-full pl-1 pr-3 text-body-sm hover:bg-subtle"
      >
        <Seal seed={p.handle} letter={p.display[0]} size={28} />
        <span className="font-semibold">{p.display}</span>
      </button>
      {open ? (
        <div className="envelope absolute right-0 top-[calc(100%+8px)] z-30 w-64 p-1.5 !shadow-[var(--shadow-lift)]">
          <div className="px-2.5 py-2">
            <div className="text-title-3 font-semibold">{p.display}</div>
            <div className="num text-micro text-fg-3">{short(me.address)}</div>
          </div>
          <div className="rule my-1" />
          <MenuLink href={`/p/${p.handle}`} onClick={() => setOpen(false)}>
            My profile
          </MenuLink>
          <MenuLink href="/desk" onClick={() => setOpen(false)}>
            Make a prediction
          </MenuLink>
          <MenuLink href="/ask" onClick={() => setOpen(false)}>
            Talk to 0xkafka
          </MenuLink>
          <div className="rule my-1" />
          <button type="button" onClick={() => void signOut()} className="w-full rounded-[var(--radius-xs)] px-2.5 py-1.5 text-left text-body-sm text-fg-3 hover:bg-subtle hover:text-fg">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, children, onClick }: { href: string; children: string; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="block rounded-[var(--radius-xs)] px-2.5 py-1.5 text-body-sm hover:bg-subtle">
      {children}
    </Link>
  );
}

function WalletGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
      <rect x="1" y="3" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1 5.5h12" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="8.5" r="1" fill="currentColor" />
    </svg>
  );
}
