import { cn } from '@/lib/utils';

// A prediction's status, as a pill: Called it when it won, Missed when it
// didn't, Hidden until predictions close, Pending until the result, Void.

export type StampKind = 'won' | 'missed' | 'hidden' | 'pending' | 'void';

const WORD: Record<StampKind, string> = { won: 'Called it', missed: 'Missed', hidden: 'Hidden', pending: 'Pending', void: 'Void' };

function Icon({ kind }: { kind: StampKind }) {
  const p = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (kind === 'won') return <svg {...p}><path d="M2.5 6.2 5 8.6l4.5-5" /></svg>;
  if (kind === 'missed') return <svg {...p}><path d="M3 3l6 6M9 3 3 9" /></svg>;
  if (kind === 'pending') return <svg {...p}><path d="M6 3.2V6l1.8 1.2" /><circle cx="6" cy="6" r="4.2" /></svg>;
  if (kind === 'hidden')
    return (
      <svg {...p}>
        <rect x="2.5" y="5.2" width="7" height="5" rx="1.2" />
        <path d="M4.2 5.2V4a1.8 1.8 0 0 1 3.6 0v1.2" />
      </svg>
    );
  return <svg {...p}><path d="M3 6h6" /></svg>;
}

export function Stamp({ kind, className, size = 'md' }: { kind: StampKind; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      data-stamp={kind}
      className={cn(
        'stamp select-none',
        kind === 'won' ? 'stamp-won' : kind === 'missed' ? 'stamp-missed' : 'stamp-sealed',
        size === 'sm' ? '!h-[22px] !min-w-0 !px-2 !text-[12px]' : size === 'lg' ? '!h-9 !px-4 !text-[15px]' : '',
        className,
      )}
    >
      <Icon kind={kind} />
      {WORD[kind]}
    </span>
  );
}
