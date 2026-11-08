'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Seal } from '@/components/letters/seal';
import { Button } from '@/components/ui/button';
import type { PublicProfile } from '@/src/agents/views';

// Who is signed in, and how to sign in: connect a wallet, sign one message,
// and (once per wallet) pick a handle. The server keeps the session in an
// httpOnly cookie; this context mirrors it for the UI.

const WalletChooser = dynamic(() => import('./chooser'), { ssr: false });

export interface Me {
  address: string | null;
  profile: PublicProfile | null;
}

type Status = 'idle' | 'choosing' | 'signing' | 'naming';

interface SessionApi {
  me: Me;
  status: Status;
  error: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

export function SessionProvider({ initial, children }: { initial: Me; children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me>(initial);
  const [status, setStatus] = useState<Status>(initial.address && !initial.profile ? 'naming' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [chooser, setChooser] = useState(false);
  const busy = useRef(false);

  useEffect(() => setMe(initial), [initial]);

  const signInWith = useCallback(
    async (address: string) => {
      if (busy.current) return;
      busy.current = true;
      setChooser(false);
      setStatus('signing');
      setError(null);
      try {
        const { message, issuedAt } = await post<{ message: string; issuedAt: string }>('/api/v1/auth/challenge', { address });
        const { getKit } = await import('./kit');
        const { signature } = await getKit().signPersonalMessage({ message: new TextEncoder().encode(message) });
        const r = await post<Me>('/api/v1/auth/verify', { address, issuedAt, signature });
        setMe(r);
        setStatus(r.profile ? 'idle' : 'naming');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed');
        setStatus('idle');
      } finally {
        busy.current = false;
      }
    },
    [router],
  );

  const signIn = useCallback(() => {
    if (me.address && !me.profile) {
      setStatus('naming');
      return;
    }
    setError(null);
    setStatus('choosing');
    setChooser(true);
  }, [me]);

  const signOut = useCallback(async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    try {
      const { getKit } = await import('./kit');
      await getKit().disconnectWallet();
    } catch {
      /* not connected */
    }
    setMe({ address: null, profile: null });
    setStatus('idle');
    router.refresh();
  }, [router]);

  const dismiss = useCallback(() => {
    setChooser(false);
    setStatus('idle');
  }, []);

  const api = useMemo(() => ({ me, status, error, signIn, signOut }), [me, status, error, signIn, signOut]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {chooser ? <WalletChooser open={chooser} onConnected={signInWith} onDismiss={dismiss} /> : null}
      {status === 'naming' && me.address ? (
        <HandleSheet
          onDone={(profile) => {
            setMe((m) => ({ ...m, profile }));
            setStatus('idle');
            router.push(`/p/${profile.handle}`);
            router.refresh();
          }}
          onCancel={() => setStatus('idle')}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/** Once per wallet: the name on every pick, and the name of its memory on Walrus. */
function HandleSheet({ onDone, onCancel }: { onDone: (p: PublicProfile) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const handle = name.trim().toLowerCase().replace(/\s+/g, '-');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const r = await post<{ profile: PublicProfile }>('/api/v1/auth/profile', { handle: name });
      onDone(r.profile);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 backdrop-blur-sm" role="dialog" aria-modal aria-labelledby="handle-title">
      <form onSubmit={submit} className="panel w-full max-w-[420px] !shadow-[var(--shadow-lift)]">
        <div className="flex flex-col items-center px-7 pb-7 pt-8 text-center">
          <Seal seed={handle || 'you'} letter={handle ? handle[0] : '?'} size={64} className="!ring-0" />
          <h2 id="handle-title" className="mt-4 text-title-1 font-semibold">
            Choose your handle
          </h2>
          <p className="mt-2 max-w-[34ch] text-body-sm text-fg-2">
            It goes on every pick you seal, and names your memory on Walrus. You pick it once.
          </p>
          <label className="mt-5 w-full text-left">
            <span className="text-body-sm font-medium text-fg-2">Handle</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              placeholder="e.g. dun"
              className="mt-1.5 h-11 w-full rounded-[var(--radius-sm)] border border-line-strong bg-subtle px-3 text-body outline-none transition-colors focus:border-fg-4 focus:bg-surface focus-visible:outline-none"
            />
          </label>
          <div className="mt-2 w-full truncate text-left text-caption text-fg-3">
            Walrus memory: <span className="mono text-memory">0xkafka.profile.{handle || '…'}</span>
          </div>
          {err ? <p className="mt-3 w-full text-left text-caption text-negative">{err}</p> : null}
          <div className="mt-6 grid w-full grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Later
            </Button>
            <Button type="submit" variant="primary" disabled={saving || handle.length < 2}>
              {saving ? 'Saving…' : 'Create profile'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
