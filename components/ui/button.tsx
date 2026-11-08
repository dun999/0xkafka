import { cva, type VariantProps } from 'class-variance-authority';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ScrambleHover } from '@/components/fx/scramble-text';
import { cn } from '@/lib/utils';

/**
 * 0xkafka's button.
 *   primary    high contrast: the main action of a view
 *   seal       wax red: only for sealing a pick or paying to open one
 *   secondary  quiet fill
 *   ghost      text only, for tertiary actions
 * `scramble` decodes the label on hover; `arrow` adds a trailing arrow that nudges on hover.
 */
export const buttonVariants = cva(
  'group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium outline-none transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'rounded-[var(--radius-sm)] bg-action font-semibold text-on-action hover:bg-action-hover',
        seal: 'rounded-[var(--radius-sm)] bg-seal font-semibold text-on-seal hover:bg-seal-hover',
        secondary: 'rounded-[var(--radius-sm)] border border-line bg-subtle text-fg hover:border-line-strong hover:bg-muted',
        ghost: 'rounded-[var(--radius-sm)] text-fg-2 hover:bg-subtle hover:text-fg',
      },
      size: {
        sm: 'h-[var(--button-h-sm)] px-3 text-body-sm',
        md: 'h-[var(--button-h-md)] px-4 text-body-sm',
        lg: 'h-[var(--button-h-lg)] px-5 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type Props = VariantProps<typeof buttonVariants> & {
  children: string;
  href?: string;
  arrow?: boolean;
  scramble?: boolean;
  className?: string;
  icon?: ReactNode;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
};

export function Button({ children, href, arrow, scramble, variant, size, className, icon, type = 'button', disabled, onClick }: Props) {
  const cls = cn(buttonVariants({ variant, size }), className);
  const body = (
    <>
      {icon}
      {scramble ? <ScrambleHover text={children} /> : <span>{children}</span>}
      {arrow ? <Arrow /> : null}
    </>
  );
  if (!href)
    return (
      <button type={type} disabled={disabled} className={cls} onClick={onClick}>
        {body}
      </button>
    );
  if (/^https?:/.test(href))
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {body}
      </a>
    );
  return (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="transition-transform duration-200 group-hover/btn:translate-x-0.5">
      <path d="M1 6h9M6.5 2.5 10 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}
