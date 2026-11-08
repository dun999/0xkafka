import type { Badge, BadgeArt, Streak } from '@/src/picks/badges';
import { cn } from '@/lib/utils';

// Badges drawn as game medals: each has its own frame, colours and emblem.
// Earned ones are in full colour; locked ones are greyed with their progress,
// the way an achievements screen shows them.

type Frame = 'medal' | 'shield' | 'hex' | 'burst' | 'laurel';

interface Look {
  frame: Frame;
  /** Face, rim, ribbon, and the emblem's detail colour. */
  face: string;
  rim: string;
  ribbon: string;
  ink: string;
}

const LOOK: Record<BadgeArt, Look> = {
  first: { frame: 'medal', face: '#F5B83D', rim: '#C2851A', ribbon: '#3D7BE0', ink: '#9A6410' },
  sports: { frame: 'shield', face: '#2FB45A', rim: '#1D8240', ribbon: '#1D8240', ink: '#17663A' },
  globe: { frame: 'hex', face: '#3D8BF2', rim: '#2564C4', ribbon: '#2564C4', ink: '#1E4F9C' },
  target: { frame: 'medal', face: '#EE5A52', rim: '#B83A34', ribbon: '#F5B83D', ink: '#B83A34' },
  flame: { frame: 'shield', face: '#FF8A2B', rim: '#D0601A', ribbon: '#D0601A', ink: '#C4501A' },
  underdog: { frame: 'hex', face: '#9A63E0', rim: '#7040B8', ribbon: '#7040B8', ink: '#5E35A0' },
  gem: { frame: 'burst', face: '#22B5A6', rim: '#138478', ribbon: '#138478', ink: '#0F6E64' },
  roll: { frame: 'shield', face: '#F2A93B', rim: '#C27A16', ribbon: '#C27A16', ink: '#B5650F' },
  regular: { frame: 'laurel', face: '#F5B83D', rim: '#C2851A', ribbon: '#D94F45', ink: '#9A6410' },
  insider: { frame: 'hex', face: '#E0559E', rim: '#AE3477', ribbon: '#AE3477', ink: '#962A65' },
  talker: { frame: 'medal', face: '#3AA6F0', rim: '#1F7CC0', ribbon: '#9A63E0', ink: '#1A68A3' },
  walrus: { frame: 'medal', face: '#2BB3C0', rim: '#17858F', ribbon: '#3D7BE0', ink: '#126E77' },
};

const hexPts = (r: number, cx = 48, cy = 48) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

const burstPts = (ro: number, ri: number, n = 12, cx = 48, cy = 46) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI / n) * i - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

const SHIELD = (s: number) => {
  // A heraldic shield, scaled about its centre (48, 48).
  const p = (x: number, y: number) => `${(48 + (x - 48) * s).toFixed(1)} ${(48 + (y - 48) * s).toFixed(1)}`;
  return `M${p(48, 6)} L${p(84, 17)} L${p(84, 44)} C${p(84, 67)} ${p(68, 83)} ${p(48, 92)} C${p(28, 83)} ${p(12, 67)} ${p(12, 44)} L${p(12, 17)} Z`;
};

/** Where the face sits, and the inner shape the shine is clipped to. */
function frameParts(f: Frame) {
  if (f === 'shield') return { cx: 48, cy: 46, outer: <path d={SHIELD(1)} />, inner: <path d={SHIELD(0.84)} /> };
  if (f === 'hex') return { cx: 48, cy: 48, outer: <polygon points={hexPts(42)} />, inner: <polygon points={hexPts(35)} /> };
  if (f === 'burst') return { cx: 48, cy: 46, outer: <polygon points={burstPts(42, 34)} />, inner: <circle cx="48" cy="46" r="28" /> };
  return { cx: 48, cy: 42, outer: <circle cx="48" cy="42" r="31" />, inner: <circle cx="48" cy="42" r="25" /> };
}

function Ribbons({ color }: { color: string }) {
  return (
    <g fill={color}>
      <path d="M30 58 L20 92 L31 86 L38 94 L47 66 Z" />
      <path d="M66 58 L76 92 L65 86 L58 94 L49 66 Z" />
      <path d="M30 58 L20 92 L31 86 Z" fill="#000" opacity="0.15" />
      <path d="M66 58 L76 92 L65 86 Z" fill="#000" opacity="0.15" />
    </g>
  );
}

function Laurel({ color }: { color: string }) {
  // Two branches of leaves around the medal.
  const leaves = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (100 + i * 23);
    const x = 48 + 38 * Math.cos(a);
    const y = 44 + 38 * Math.sin(a);
    const rot = (a * 180) / Math.PI + 90;
    return { x, y, rot };
  });
  return (
    <g fill={color}>
      {leaves.map((l, i) => (
        <g key={i}>
          <ellipse cx={l.x.toFixed(1)} cy={l.y.toFixed(1)} rx="4" ry="8" transform={`rotate(${(l.rot - 25).toFixed(0)} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`} />
          <ellipse cx={(96 - l.x).toFixed(1)} cy={l.y.toFixed(1)} rx="4" ry="8" transform={`rotate(${(-(l.rot - 25)).toFixed(0)} ${(96 - l.x).toFixed(1)} ${l.y.toFixed(1)})`} />
        </g>
      ))}
    </g>
  );
}

/** The picture in the middle of each badge, drawn around (0, 0) in a 36-unit box. */
function Emblem({ art, ink }: { art: BadgeArt; ink: string }) {
  const W = '#FFFFFF';
  switch (art) {
    case 'first':
      return (
        <g>
          <path d="M0 -17 L4.6 -6.3 L16.2 -5.3 L7.4 2.3 L10 13.7 L0 7.7 L-10 13.7 L-7.4 2.3 L-16.2 -5.3 L-4.6 -6.3 Z" fill={W} />
          <path d="M-2.6 -4.5 L1.8 -6.5 L1.8 7 M-2.8 7 H6" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      );
    case 'sports':
      return (
        <g>
          <circle r="15" fill={W} />
          <polygon points="0,-5.5 5.2,-1.7 3.2,4.4 -3.2,4.4 -5.2,-1.7" fill={ink} />
          <g stroke={ink} strokeWidth="1.8" strokeLinecap="round">
            <path d="M0 -5.5 V-12 M5.2 -1.7 L11.6 -3.8 M3.2 4.4 L7.2 10 M-3.2 4.4 L-7.2 10 M-5.2 -1.7 L-11.6 -3.8" />
          </g>
          <path d="M-4 -14.4 L0 -12 L4 -14.4 A15 15 0 0 0 -4 -14.4 Z M14.3 -4.6 L11.6 -3.8 L12.6 1 A15 15 0 0 0 14.3 -4.6 Z M-14.3 -4.6 L-11.6 -3.8 L-12.6 1 A15 15 0 0 1 -14.3 -4.6 Z" fill={ink} />
        </g>
      );
    case 'globe':
      return (
        <g>
          <circle r="15" fill={W} />
          <g fill="none" stroke={ink} strokeWidth="1.9">
            <ellipse rx="6.5" ry="15" />
            <path d="M-15 0 H15 M-13 -7.5 H13 M-13 7.5 H13 M0 -15 V15" />
          </g>
        </g>
      );
    case 'target':
      return (
        <g>
          <circle r="15" fill={W} />
          <circle r="10.5" fill={ink} />
          <circle r="6" fill={W} />
          <circle r="2.6" fill={ink} />
          <path d="M2 -2 L15 -15" stroke="#3A2A1A" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M12 -18 L15 -15 L18 -12 L19 -19 Z" fill="#3A2A1A" />
        </g>
      );
    case 'flame':
      return (
        <g>
          <path d="M0 -17 C7 -9 13 -4 13 5 C13 12.5 7 17 0 17 C-7 17 -13 12.5 -13 5 C-13 -1 -9.5 -5 -7 -9 C-6 -4 -4 -2 -1.5 -1 C-2.5 -7 -2.5 -12 0 -17 Z" fill={W} />
          <path d="M0 0 C3.5 3.5 6 6 6 9.5 C6 13 3.2 15 0 15 C-3.2 15 -6 13 -6 9.5 C-6 6.5 -3 4 0 0 Z" fill={ink} />
        </g>
      );
    case 'underdog':
      return (
        <g>
          <path d="M-15 12 L-5 1 L1.5 7.5 L12 -5" stroke={W} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M5 -10 L17 -12 L15 0 Z" fill={W} />
          <path d="M-16 -9 L-10 -9 M-16 -3 L-12 -3" stroke={W} strokeWidth="2.6" strokeLinecap="round" opacity="0.7" />
        </g>
      );
    case 'gem':
      return (
        <g>
          <path d="M-15 -5 L-9 -13 L9 -13 L15 -5 L0 15 Z" fill={W} />
          <path d="M-15 -5 H15 M-9 -13 L-4.5 -5 L0 15 M9 -13 L4.5 -5 L0 15 M-4.5 -5 L0 -13 L4.5 -5" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" fill="none" />
        </g>
      );
    case 'roll':
    case 'regular':
      return (
        <g>
          <rect x="-14" y="-13" width="28" height="28" rx="4.5" fill={W} />
          <path d="M-14 -8.5 A4.5 4.5 0 0 1 -9.5 -13 H9.5 A4.5 4.5 0 0 1 14 -8.5 V-5 H-14 Z" fill={ink} />
          <path d="M-7 -16 V-10 M7 -16 V-10" stroke={W} strokeWidth="3" strokeLinecap="round" />
          <text y="11.5" textAnchor="middle" fontSize="16" fontWeight="800" fill={ink} fontFamily="inherit">
            {art === 'roll' ? '3' : '7'}
          </text>
        </g>
      );
    case 'insider':
      return (
        <g>
          <circle cx="-6" cy="-6" r="8.5" fill={W} />
          <circle cx="-6" cy="-6" r="3.4" fill={ink} />
          <path d="M-0.5 -0.5 L14 14" stroke={W} strokeWidth="5.2" strokeLinecap="round" />
          <path d="M8 8 L4 12 M12 12 L8.5 15.5" stroke={W} strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    case 'talker':
      return (
        <g>
          <path d="M-15 -11 A4 4 0 0 1 -11 -15 H11 A4 4 0 0 1 15 -11 V5 A4 4 0 0 1 11 9 H-2 L-9 15 V9 H-11 A4 4 0 0 1 -15 5 Z" fill={W} />
          <path d="M-9 -7 H9 M-9 -1 H4" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
        </g>
      );
    case 'walrus':
      return (
        <g>
          <ellipse cx="0" cy="-2" rx="15" ry="13.5" fill="#8A5A3C" />
          <path d="M-5.5 5 L-6.5 17 L-3 6 Z M5.5 5 L6.5 17 L3 6 Z" fill={W} />
          <ellipse cx="-4.6" cy="3" rx="5.6" ry="4.6" fill="#C08A63" />
          <ellipse cx="4.6" cy="3" rx="5.6" ry="4.6" fill="#C08A63" />
          <ellipse cx="0" cy="-1.5" rx="2.6" ry="1.8" fill="#3A2418" />
          <ellipse cx="-6" cy="-7.5" rx="1.7" ry="2.1" fill="#2A1A10" />
          <ellipse cx="6" cy="-7.5" rx="1.7" ry="2.1" fill="#2A1A10" />
          <path d="M-9 2 H-14 M-9 4.5 H-13.5 M9 2 H14 M9 4.5 H13.5" stroke="#3A2418" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      );
  }
}

/** One badge, drawn. `locked` greys it out; it still shows what it will look like. */
export function BadgeArtwork({ art, size = 72, locked = false, className }: { art: BadgeArt; size?: number; locked?: boolean; className?: string }) {
  const look = LOOK[art];
  const { cx, cy, outer, inner } = frameParts(look.frame);
  const clip = `badge-shine-${art}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden
      className={cn('shrink-0', locked && 'opacity-55', className)}
      style={{ filter: locked ? 'grayscale(1)' : 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.25))' }}
    >
      <defs>
        <clipPath id={clip}>{inner}</clipPath>
      </defs>
      {look.frame === 'medal' ? <Ribbons color={look.ribbon} /> : null}
      {look.frame === 'laurel' ? <Laurel color="#3FA45B" /> : null}
      <g fill={look.rim}>{outer}</g>
      <g fill={look.face}>{inner}</g>
      <g clipPath={`url(#${clip})`}>
        <ellipse cx={cx - 14} cy={cy - 20} rx="30" ry="16" fill="#FFFFFF" opacity="0.18" transform={`rotate(-28 ${cx - 14} ${cy - 20})`} />
      </g>
      <g transform={`translate(${cx} ${cy})`}>
        <Emblem art={art} ink={look.ink} />
      </g>
    </svg>
  );
}

/** Earned first (newest first), then the closest to earning. */
export function sortBadges(badges: Badge[]): Badge[] {
  return [...badges].sort((a, b) => Number(b.done) - Number(a.done) || (b.at ?? '').localeCompare(a.at ?? '') || b.progress / b.goal - a.progress / a.goal);
}

const earnedOn = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The achievements grid: art on top, name, how to earn it, then the date or the progress. */
export function BadgeGrid({ badges }: { badges: Badge[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {sortBadges(badges).map((b) => (
        <li
          key={b.id}
          className={cn('flex flex-col items-center rounded-[var(--radius-md)] border px-3 pb-4 pt-5 text-center', b.done ? 'border-line bg-surface' : 'border-line bg-subtle/50')}
        >
          <BadgeArtwork art={b.id} size={76} locked={!b.done} />
          <div className={cn('mt-3 text-body-sm font-semibold', b.done ? 'text-fg' : 'text-fg-2')}>{b.name}</div>
          <div className="mt-0.5 min-h-[2.6em] text-caption leading-snug text-fg-3">{b.how}</div>
          {b.done ? (
            <div className="mt-2 text-micro font-medium text-positive">{b.at ? `Earned ${earnedOn(b.at)}` : 'Earned'}</div>
          ) : (
            <div className="mt-2 flex w-full items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-fg-3" style={{ width: `${(b.progress / b.goal) * 100}%` }} />
              </span>
              <span className="num text-micro text-fg-3">
                {b.progress}/{b.goal}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The few earned badges shown next to a name, like a showcase. */
export function BadgeShowcase({ badges, max = 4 }: { badges: Badge[]; max?: number }) {
  const earned = sortBadges(badges).filter((b) => b.done).slice(0, max);
  if (!earned.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {earned.map((b) => (
        <span key={b.id} title={`${b.name}: ${b.how}`}>
          <BadgeArtwork art={b.id} size={30} />
        </span>
      ))}
    </span>
  );
}

/** The daily streak as a drawn flame with the day count, like a game's streak counter. */
export function StreakFlame({ streak, size = 34 }: { streak: Streak; size?: number }) {
  const on = streak.current > 0;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className={cn('shrink-0', !on && 'opacity-40 grayscale')}>
      <path d="M20 2 C28 11 34 16 34 25 C34 33 27.5 38 20 38 C12.5 38 6 33 6 25 C6 18 10.5 13.5 13 9 C14 14 16 16.5 18.5 17.5 C17.5 11 17.5 6.5 20 2 Z" fill="#FF8A2B" />
      <path d="M20 17 C24.5 21.5 27.5 24.5 27.5 28.5 C27.5 33 24 36 20 36 C16 36 12.5 33 12.5 28.5 C12.5 25 15.5 22 20 17 Z" fill="#FFC44D" />
      <path d="M20 27 C22 29 23 30.3 23 32 C23 34 21.6 35 20 35 C18.4 35 17 34 17 32 C17 30.3 18 29 20 27 Z" fill="#FFF1C2" />
    </svg>
  );
}
