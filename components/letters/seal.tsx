import { MarkSvg } from '@/components/brand/mark';
import { cn } from '@/lib/utils';

// A forecaster's mark: a round avatar with their initial, its colour picked from
// their handle. 0xkafka's is always the seal red. `cracked` (an opened pick)
// draws it hollow.

const HUES = ['#2f64f5', '#7c3aed', '#0e9f6e', '#d9730d', '#db2777', '#0891b2', '#4f46e5', '#65a30d'] as const;
const KAFKA = '#d23b33';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A handle's colour. Kept under the old name for the OG card. */
export function waxFor(seed: string) {
  const base = seed === '0xkafka' ? KAFKA : HUES[hash(seed) % HUES.length];
  return { base, light: base, dark: base };
}

/** Kept for the OG card: a plain circle path in a 100×100 box. */
export function blobPath(_seed: string, r = 46): string {
  return `M ${50 - r} 50 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

export function Seal({
  seed,
  letter,
  size = 40,
  cracked = false,
  className,
  title,
}: {
  /** Usually the handle: picks the colour. */
  seed: string;
  /** One or two characters. Defaults to the seed's first letter. */
  letter?: string;
  size?: number;
  cracked?: boolean;
  className?: string;
  title?: string;
}) {
  // 0xkafka wears its mark, not an initial.
  if (seed === '0xkafka' && !cracked)
    return (
      <span title={title} className={cn('inline-flex shrink-0', className?.replace(/!?ring-\S+/g, ''))}>
        <MarkSvg size={size} color="var(--seal)" title={title ?? '0xkafka'} />
      </span>
    );
  const { base } = waxFor(seed);
  const mono = (letter ?? seed.replace(/^0x/, '').charAt(0) ?? '?').toUpperCase().slice(0, 2);
  return (
    <span
      role="img"
      aria-label={title ?? seed}
      title={title}
      className={cn('inline-grid shrink-0 select-none place-items-center rounded-full font-semibold leading-none ring-2 ring-surface', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * (mono.length > 1 ? 0.36 : 0.44)),
        background: cracked ? 'transparent' : base,
        color: cracked ? base : '#fff',
        boxShadow: cracked ? `inset 0 0 0 ${Math.max(1.5, size / 20)}px ${base}` : undefined,
      }}
    >
      {mono}
    </span>
  );
}
