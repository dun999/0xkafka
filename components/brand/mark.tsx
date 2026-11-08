// 0xkafka's mark: Kafka's beetle, seen from above, on a red tile. Its two wing
// cases are the two sides of a question; one is filled in, the side it picked.
// Plain SVG with no classes, so the share-card renderer can draw it too.

export const MARK_RED = '#d23b33';

/** The beetle's shapes on a 64×64 grid, centred on the tile. */
export const BEETLE = {
  head: 'M27.6 21.2a4.4 4 0 0 1 8.8 0z',
  thorax: 'M25.6 22.6h12.8c1.2 0 2.3.7 2.7 1.8l1.9 4.6c.4 1-.3 2-1.4 2H22.4c-1.1 0-1.8-1-1.4-2l1.9-4.6c.4-1.1 1.5-1.8 2.7-1.8z',
  picked: 'M30.7 33H24.2c-3.1 0-5.2 2.3-5.2 5.6 0 7.2 3.8 13.4 11.7 17.4z',
  other: 'M33.3 33h6.5c3.1 0 5.2 2.3 5.2 5.6 0 7.2-3.8 13.4-11.7 17.4z',
  antennae: ['M30.2 17.6C29.4 13.4 27 10.2 22.8 9', 'M33.8 17.6c.8-4.2 3.2-7.4 7.4-8.6'],
} as const;

export function MarkSvg({ size = 28, color = MARK_RED, title }: { size?: number; color?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="64" height="64" rx="16" fill={color} />
      <g transform="translate(32 32.5) scale(1.08) translate(-32 -32.5)">
        <path d={BEETLE.head} fill="#ffffff" />
        <path d={BEETLE.thorax} fill="#ffffff" />
        <path d={BEETLE.picked} fill="#ffffff" />
        <path d={BEETLE.other} fill="#ffffff" fillOpacity={0.62} />
        <path d={BEETLE.antennae[0]} stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" fill="none" />
        <path d={BEETLE.antennae[1]} stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
