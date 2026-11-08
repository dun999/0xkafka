import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CATEGORY_LABEL, type Category } from '@/src/markets/categories';

export const pct = (p: number | null | undefined, digits = 0) => (p === null || p === undefined ? '—' : `${(p * 100).toFixed(digits)}%`);
/** USDC for people: 0, 0.0001, 0.05, 1.20. Tiny amounts keep their digits instead of rounding to 0.00. */
export const usdc = (n: number) => (n === 0 ? '0' : n < 0.01 ? String(Number(n.toFixed(6))) : n.toFixed(2));
export const f3 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(3));
export const short = (s: string, head = 6, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

export function rel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - now;
  const a = Math.abs(ms);
  const unit = a < 3_600_000 ? `${Math.max(1, Math.round(a / 60_000))}m` : a < 172_800_000 ? `${Math.round(a / 3_600_000)}h` : `${Math.round(a / 86_400_000)}d`;
  return ms >= 0 ? `in ${unit}` : `${unit} ago`;
}

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) : '—';

/** Panel anatomy: header (title · meta), body, optional footer note. */
export function Panel({ title, meta, children, footer, className = '' }: { title: ReactNode; meta?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cn('panel', className)}>
      <div className="panel-h">
        <h3 className="text-body-sm font-semibold text-fg">{title}</h3>
        {meta ? <div className="min-w-0 truncate text-caption text-fg-3">{meta}</div> : null}
      </div>
      {children}
      {footer ? <div className="panel-f">{footer}</div> : null}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'mem' | 'usd' }) {
  return (
    <div className="min-w-0 px-4 py-4">
      <div className="label truncate">{label}</div>
      <div className={cn('num mt-1 truncate text-title-1 font-semibold', tone === 'mem' ? 'text-memory' : tone === 'usd' ? 'text-money' : 'text-fg')}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-micro text-fg-3">{sub}</div> : null}
    </div>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="panel grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-line [&>*]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r">{children}</div>;
}

export function CategoryTag({ c }: { c: string }) {
  return (
    <span className="inline-flex h-[var(--chip-h)] shrink-0 items-center rounded-full bg-subtle px-2.5 text-micro font-medium text-fg-2">
      {CATEGORY_LABEL[c as Category] ?? c}
    </span>
  );
}

/** A status chip: a label in a meaning colour. */
export function Chip({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'memory' | 'money' | 'positive' | 'negative'; children: ReactNode; title?: string }) {
  const color = { neutral: 'text-fg-2', memory: 'text-memory', money: 'text-money', positive: 'text-positive', negative: 'text-negative' }[tone];
  return (
    <span className={cn('inline-flex h-[var(--chip-h)] items-center rounded-full bg-subtle px-2.5 text-micro font-medium', color)} title={title}>
      {children}
    </span>
  );
}

/** Label-over-value pairs, for page header asides. */
export function MetaList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-caption text-fg-3">{i.label}</dt>
          <dd className="num mt-1 text-caption text-fg">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ModeTag({ mode }: { mode: string | null }) {
  if (mode !== 'backtest') return null;
  return (
    <span className="ml-1.5 inline-block rounded-full bg-subtle px-1.5 text-micro leading-5 text-fg-3" title="Forecast made in the walk-forward replay of already-resolved questions">
      replay
    </span>
  );
}

export function BlobLink({ blob, mock, label }: { blob: string | null | undefined; mock?: boolean; label?: string }) {
  if (!blob) return <span className="text-caption text-fg-4">queued</span>;
  if (mock || blob.startsWith('mock')) return <span className="num text-caption text-fg-3" title="Dev mock memory, not on Walrus">{label ?? short(blob)}</span>;
  return (
    <a href={`https://walruscan.com/mainnet/blob/${blob}`} target="_blank" rel="noreferrer" className="num text-caption text-memory hover:underline" title={`Walrus blob ${blob}`}>
      {label ?? short(blob)}
    </a>
  );
}

export function DigestLink({ digest }: { digest: string }) {
  return (
    <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer" className="num text-caption text-money hover:underline" title={digest}>
      {short(digest, 8, 6)}
    </a>
  );
}

export function SealedSlot({ width = 56 }: { width?: number }) {
  return <span className="sealed inline-block h-3 align-middle" style={{ width }} title="Sealed until the question resolves" aria-label="sealed" />;
}

/** Brier difference vs a reference: negative is better (green). */
export function Delta({ v, title }: { v: number | null | undefined; title?: string }) {
  if (v === null || v === undefined) return <span className="text-fg-4">—</span>;
  const better = v < -0.0005;
  const worse = v > 0.0005;
  return (
    <span className={`num ${better ? 'text-positive' : worse ? 'text-negative' : 'text-fg-3'}`} title={title}>
      {v > 0 ? '+' : v < 0 ? '−' : '±'}
      {Math.abs(v).toFixed(3)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-body-sm text-fg-3">{children}</div>;
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="block truncate hover:underline">
      {children}
    </Link>
  );
}
