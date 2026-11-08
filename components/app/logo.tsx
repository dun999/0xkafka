import Link from 'next/link';
import { MarkSvg } from '@/components/brand/mark';
import { cn } from '@/lib/utils';

/** The mark: Kafka's beetle on a red tile. */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0', className)}>
      <MarkSvg size={size} color="var(--seal)" title="0xkafka" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-[18px] font-semibold leading-none tracking-[-0.02em]', className)}>
      <span className="text-fg-3">0x</span>kafka
    </span>
  );
}

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2.5 text-fg', className)} aria-label="0xkafka home">
      <Mark />
      <Wordmark />
    </Link>
  );
}
