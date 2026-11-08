'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gsap, MOTION_OK, useGSAP } from './gsap';

/** Counts up to `value` when it scrolls into view. Server-rendered with the final value. */
export function CountUp({ value, decimals = 0, prefix = '', suffix = '', className }: { value: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (v: number) => `${prefix}${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const o = { v: 0 };
        el.textContent = fmt(0);
        gsap.to(o, {
          v: value,
          duration: 1.6,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 95%', once: true },
          onUpdate: () => {
            el.textContent = fmt(o.v);
          },
        });
      });
      return () => mm.revert();
    },
    { dependencies: [value] },
  );
  return (
    <span ref={ref} className={className}>
      {fmt(value)}
    </span>
  );
}

/** Children marked `data-reveal` rise in, staggered, when the block scrolls into view. */
export function Reveal({ children, className, stagger = 0.07 }: { children: ReactNode; className?: string; stagger?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = ref.current?.querySelectorAll('[data-reveal]');
        if (!items?.length) return;
        gsap.from(items, { opacity: 0, y: 16, duration: 0.9, ease: 'power3.out', stagger, scrollTrigger: { trigger: ref.current, start: 'top 86%', once: true } });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** A sealed probability: digits that never settle. Paused off-screen. */
export function SealedNumber({ className }: { className?: string }) {
  const [v, setV] = useState('··');
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!window.matchMedia(MOTION_OK).matches) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      id ??= setInterval(() => setV(String(Math.floor(Math.random() * 100)).padStart(2, '0')), 90);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()));
    if (ref.current) io.observe(ref.current);
    return () => {
      stop();
      io.disconnect();
    };
  }, []);
  return (
    <span ref={ref} className={className} aria-label="sealed until the question resolves">
      <span aria-hidden>{v}%</span>
    </span>
  );
}

/** Live countdown to `to` (ISO). `short` reads "8h 40m" instead of "08:40:12". */
export function Countdown({ to, className, short = false }: { to: string; className?: string; short?: boolean }) {
  const calc = () => {
    const s = Math.max(0, Math.floor((new Date(to).getTime() - Date.now()) / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (short) return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m` : s ? `${s}s` : 'now';
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return d ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  };
  const [t, setT] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  return (
    <span className={className} suppressHydrationWarning>
      {t}
    </span>
  );
}

export interface TermLine {
  text: string;
  tone?: 'cmd' | 'out' | 'ok' | 'pay' | 'mem' | 'dim';
}

const TONE: Record<NonNullable<TermLine['tone']>, string> = {
  cmd: 'text-fg',
  out: 'text-fg-2',
  ok: 'text-positive',
  pay: 'text-money',
  mem: 'text-memory',
  dim: 'text-fg-4',
};

/** Types its lines out once it scrolls into view. */
export function Terminal({ lines, className }: { lines: TermLine[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const els = [...root.querySelectorAll<HTMLElement>('[data-line]')];
        els.forEach((el) => (el.textContent = ''));
        const tl = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top 80%', once: true } });
        els.forEach((el, i) => {
          const full = lines[i].text;
          const o = { n: 0 };
          const typed = lines[i].tone === 'cmd';
          tl.to(o, {
            n: full.length,
            duration: typed ? Math.min(1.4, full.length * 0.028) : 0.18,
            ease: 'none',
            onUpdate: () => {
              el.textContent = full.slice(0, Math.round(o.n));
            },
          });
          tl.to({}, { duration: typed ? 0.35 : 0.22 });
        });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={className}>
      {lines.map((l, i) => (
        <div key={i} className={`min-h-[1.55em] whitespace-pre-wrap break-all ${TONE[l.tone ?? 'out']}`}>
          <span data-line>{l.text}</span>
        </div>
      ))}
      <span className="inline-block h-[1.05em] w-[0.55em] translate-y-[2px] animate-pulse bg-fg-3" aria-hidden />
    </div>
  );
}
