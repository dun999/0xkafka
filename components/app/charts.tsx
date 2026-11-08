// Server-rendered SVG charts. Thin marks, hairline grid, text in ink tokens,
// series colours from the validated slots (s1 0xkafka, s2 Blank, s3 Market).

export function Sparkline({ points, width = 260, height = 44, mark: refLine }: { points: { t: number; p: number }[]; width?: number; height?: number; mark?: number | null }) {
  if (points.length < 2) return <div className="text-caption text-fg-4">No price history</div>;
  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (width - 8) + 4;
  const y = (p: number) => (1 - p) * (height - 8) + 4;
  const d = points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join('');
  const last = points.at(-1)!;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-label={`Market price from ${Math.round(points[0].p * 100)}% to ${Math.round(last.p * 100)}%`}>
      <line x1="0" x2={width} y1={y(0.5)} y2={y(0.5)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray="3 3" />
      {refLine != null ? <line x1="0" x2={width} y1={y(refLine)} y2={y(refLine)} stroke="var(--color-viz-1)" strokeWidth="1" strokeDasharray="0" opacity="0.5" /> : null}
      <path d={d} fill="none" stroke="var(--side-a)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.t)} cy={y(last.p)} r="3" fill="var(--color-fg)" stroke="var(--color-surface)" strokeWidth="2" />
    </svg>
  );
}

/** The question page's price chart: P(outcome A) over time, area under the line, gridlines at quarters. */
export function PriceChart({ points, label, mark }: { points: { t: number; p: number }[]; label: string; mark?: number | null }) {
  const W = 720;
  const H = 220;
  const L = 8;
  const R = 44;
  const T = 12;
  const B = 28;
  if (points.length < 2) return <div className="grid h-[180px] place-items-center text-body-sm text-fg-4">No price history yet</div>;
  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (p: number) => T + (1 - p) * (H - T - B);
  const line = points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
  const last = points.at(-1)!;
  const fmt = (t: number) => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" role="img" aria-label={`${label}: from ${Math.round(points[0].p * 100)}% to ${Math.round(last.p * 100)}%`}>
      <defs>
        <linearGradient id="pc-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--side-a)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--side-a)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--border-default)" strokeDasharray={g === 0 || g === 1 ? undefined : '3 4'} />
          <text x={W - R + 8} y={y(g) + 4} fontSize="11" fill="var(--fg-quaternary)" className="num">
            {g * 100}%
          </text>
        </g>
      ))}
      {mark != null ? <line x1={L} x2={W - R} y1={y(mark)} y2={y(mark)} stroke="var(--seal)" strokeWidth="1.5" strokeDasharray="5 4" /> : null}
      <path d={area} fill="url(#pc-fill)" />
      <path d={line} fill="none" stroke="var(--side-a)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.t)} cy={y(last.p)} r="4.5" fill="var(--side-a)" stroke="var(--bg-surface)" strokeWidth="2.5" />
      <text x={L} y={H - 8} fontSize="11" fill="var(--fg-quaternary)">
        {fmt(t0)}
      </text>
      <text x={W - R} y={H - 8} fontSize="11" fill="var(--fg-quaternary)" textAnchor="end">
        {fmt(t1)}
      </text>
    </svg>
  );
}

export interface TrackMark {
  key: string;
  label: string;
  p: number;
  color: string;
  strong?: boolean;
}

/** One 0–100% track with labelled marks: how Blank, raw, market and final relate. */
export function ProbTrack({ marks, outcome }: { marks: TrackMark[]; outcome?: 0 | 1 | null }) {
  const W = 560;
  const H = 74;
  const x = (p: number) => 16 + p * (W - 32);
  const sorted = [...marks].sort((a, b) => a.p - b.p);
  // Alternate labels above/below when marks crowd.
  const placed = sorted.map((m, i) => ({ ...m, up: i % 2 === 0 }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" style={{ maxWidth: W }} role="img" aria-label={marks.map((m) => `${m.label} ${Math.round(m.p * 100)}%`).join(', ')}>
      <line x1={x(0)} x2={x(1)} y1="37" y2="37" stroke="var(--color-line-strong)" strokeWidth="1" />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1="33" y2="41" stroke="var(--color-line-strong)" strokeWidth="1" />
          <text x={x(t)} y={H - 2} textAnchor="middle" fontSize="10" fill="var(--color-fg-4)" className="num">
            {Math.round(t * 100)}
          </text>
        </g>
      ))}
      {outcome !== null && outcome !== undefined ? (
        <g>
          <rect x={x(outcome) - 5} y="32" width="10" height="10" rx="2" fill={outcome ? 'var(--color-positive)' : 'var(--color-negative)'} />
        </g>
      ) : null}
      {placed.map((m) => (
        <g key={m.key}>
          <circle cx={x(m.p)} cy="37" r={m.strong ? 6 : 4.5} fill={m.color} stroke="var(--color-surface)" strokeWidth="2" />
          <text x={x(m.p)} y={m.up ? 22 : 58} textAnchor="middle" fontSize="11" fill={m.strong ? 'var(--color-fg)' : 'var(--color-fg-2)'} fontWeight={m.strong ? 600 : 400}>
            {m.label} {Math.round(m.p * 100)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function TrustBar({ value, prior = 0.5 }: { value: number; prior?: number }) {
  return (
    <div className="relative h-2 w-full rounded-full bg-subtle" title={`Trust ${value.toFixed(2)}`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-side-a" style={{ width: `${value * 100}%` }} />
      <div className="absolute inset-y-[-3px] w-px bg-fg-4" style={{ left: `${prior * 100}%` }} title="Starting trust 0.50" />
    </div>
  );
}

export function MiniLine({ values, width = 120, height = 22, max = 1 }: { values: number[]; width?: number; height?: number; max?: number }) {
  if (values.length < 2) return <span className="text-micro text-fg-4">—</span>;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => (1 - v / max) * (height - 4) + 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" aria-hidden>
      <line x1="0" x2={width} y1={y(0.5)} y2={y(0.5)} stroke="var(--color-line)" strokeWidth="1" />
      <path d={values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')} fill="none" stroke="var(--color-fg-2)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="2.5" fill="var(--color-fg)" />
    </svg>
  );
}

interface RelPoint {
  mid: number;
  n: number;
  said: number | null;
  happened: number | null;
}

/** Reliability diagram: what 0xkafka said vs how often it happened, 0xkafka and Blank. */
export function Reliability({ kafka, blank }: { kafka: RelPoint[]; blank: RelPoint[] }) {
  const S = 250;
  const P = 36;
  const x = (v: number) => P + v * (S - P - 8);
  const y = (v: number) => S - P - v * (S - P - 8);
  const series = [
    { name: '0xkafka', pts: kafka, color: 'var(--color-viz-1)' },
    { name: 'Blank', pts: blank, color: 'var(--color-viz-2)' },
  ];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width="100%" className="block" style={{ maxWidth: S }} role="img" aria-label="Reliability: forecast probability against observed frequency">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
          <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} stroke="var(--color-line)" />
          <text x={x(t)} y={S - P + 14} textAnchor="middle" fontSize="10" fill="var(--color-fg-3)">
            {t * 100}%
          </text>
          <text x={P - 5} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-fg-3)">
            {t * 100}%
          </text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--color-fg-4)" strokeWidth="1" />
      {series.map((s) => {
        const pts = s.pts.filter((p) => p.n > 0 && p.said !== null && p.happened !== null);
        return (
          <g key={s.name}>
            <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.said!)},${y(p.happened!)}`).join('')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            {pts.map((p) => (
              <circle key={p.mid} cx={x(p.said!)} cy={y(p.happened!)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth="2">
                <title>{`${s.name}: said ${Math.round(p.said! * 100)}%, happened ${Math.round(p.happened! * 100)}% (n=${p.n})`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
