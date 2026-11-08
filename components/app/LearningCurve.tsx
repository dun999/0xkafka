'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface CurvePoint {
  i: number;
  at: string;
  k: number;
  b: number;
  m: number;
}

const SERIES = [
  { key: 'k', name: '0xkafka', note: 'with memory', color: 'var(--color-viz-1)' },
  { key: 'b', name: 'Blank', note: 'no memory', color: 'var(--color-viz-2)' },
  { key: 'm', name: 'Market', note: 'price at forecast', color: 'var(--color-viz-3)' },
] as const;

/** Rolling mean Brier score (lower is better) as questions resolve. Hover for values. */
export function LearningCurve({ data, window }: { data: CurvePoint[]; window: number }) {
  // Draw at the container's real width so text stays at its true size.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 240;
  const L = 40;
  const R = 104;
  const T = 12;
  const B = 26;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { yMin, yMax, ticks } = useMemo(() => {
    const vals = data.flatMap((d) => [d.k, d.b, d.m]);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 0.01) * 50) / 50);
    const hi = Math.ceil((Math.max(...vals) + 0.01) * 50) / 50;
    const step = hi - lo > 0.12 ? 0.04 : 0.02;
    const t: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) t.push(Math.round(v * 1000) / 1000);
    return { yMin: lo, yMax: hi, ticks: t };
  }, [data]);

  if (data.length < 2) return <div className="px-3 py-8 text-body-sm text-fg-3">The curve appears once {window} questions have resolved.</div>;

  const n0 = data[0].i;
  const n1 = data.at(-1)!.i;
  const x = (i: number) => L + ((i - n0) / Math.max(1, n1 - n0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const path = (key: 'k' | 'b' | 'm') => data.map((d, j) => `${j ? 'L' : 'M'}${x(d.i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const last = data.at(-1)!;
  // End labels, nudged apart so they never collide.
  const ends = SERIES.map((s) => ({ ...s, v: last[s.key], y: y(last[s.key]) })).sort((a, b) => a.y - b.y);
  for (let j = 1; j < ends.length; j++) if (ends[j].y - ends[j - 1].y < 13) ends[j].y = ends[j - 1].y + 13;
  const h = hover === null ? null : data[hover];

  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let j = 0; j < data.length; j++) if (Math.abs(x(data[j].i) - px) < Math.abs(x(data[best].i) - px)) best = j;
    setHover(best);
  };

  return (
    <div className="px-3 pb-3 pt-2">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-2">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4" style={{ background: s.color }} />
            {s.name} <span className="text-fg-3">{s.note}</span>
          </span>
        ))}
        <span className="ml-auto text-fg-3">Rolling mean Brier over the last {window} resolved · lower is better</span>
      </div>
      <div className="relative" ref={box}>
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block max-w-full touch-none select-none"
          role="img"
          aria-label={`Rolling Brier: 0xkafka ${last.k.toFixed(3)}, Blank ${last.b.toFixed(3)}, Market ${last.m.toFixed(3)}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-fg-3)" className="num">
                {t.toFixed(2)}
              </text>
            </g>
          ))}
          <text x={L} y={H - 6} fontSize="10" fill="var(--color-fg-3)">
            question {n0}
          </text>
          <text x={W - R} y={H - 6} textAnchor="end" fontSize="10" fill="var(--color-fg-3)">
            question {n1}
          </text>
          {SERIES.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {ends.map((e) => (
            <g key={e.key}>
              <circle cx={x(last.i)} cy={y(e.v)} r="4" fill={e.color} stroke="var(--color-surface)" strokeWidth="2" />
              <text x={x(last.i) + 9} y={e.y + 3.5} fontSize="11" fill="var(--color-fg)" className="num">
                {e.name} {e.v.toFixed(3)}
              </text>
            </g>
          ))}
          {h ? (
            <g pointerEvents="none">
              <line x1={x(h.i)} x2={x(h.i)} y1={T} y2={H - B} stroke="var(--color-fg-4)" strokeWidth="1" />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(h.i)} cy={y(h[s.key])} r="4" fill={s.color} stroke="var(--color-surface)" strokeWidth="2" />
              ))}
            </g>
          ) : null}
        </svg>
        {h ? (
          <div
            className="pointer-events-none absolute top-1 border border-line bg-surface px-2 py-1.5 text-micro shadow-none"
            style={{ left: `${Math.min(70, (x(h.i) / W) * 100 + 1.5)}%` }}
          >
            <div className="text-fg-3">
              After question {h.i} · {new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2" style={{ background: s.color }} />
                <span className="w-12">{s.name}</span>
                <span className="num">{h[s.key].toFixed(3)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
