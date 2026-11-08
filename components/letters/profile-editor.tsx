'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

// Owner-only: your one-line bio.

export function ProfileEditor({ bio }: { bio: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [b, setB] = useState(bio ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const r = await fetch('/api/v1/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bio: b.trim() || null }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? 'Could not save');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="u text-caption text-fg-3 hover:text-fg">
        Edit bio
      </button>
    );

  return (
    <div className="mt-3 space-y-3 rounded-[var(--radius-sm)] border border-line bg-raised p-3">
      <label className="block">
        <span className="label">Bio, one line</span>
        <input
          value={b}
          onChange={(e) => setB(e.target.value.slice(0, 160))}
          placeholder="Premier League, fading favourites since 2019"
          className="mt-1 w-full rounded-[var(--radius-xs)] border border-line-strong bg-surface px-2.5 py-1.5 text-body outline-none focus:border-line-ink"
        />
      </label>
      {err ? <p className="text-caption text-negative">{err}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
