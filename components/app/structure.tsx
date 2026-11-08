import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Every product page opens the same way:
 *   eyebrow   section name or breadcrumb
 *   title     one line saying what this page is
 *   lede      what you can do or learn here
 *   aside     the page's key facts
 * (`index` is accepted for older callers and not shown.)
 */
export function PageHeader({ eyebrow, title, lede, aside }: { index?: string; eyebrow: ReactNode; title: ReactNode; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="pb-2 pt-10">
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-fg-3">{eyebrow}</div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div className="min-w-0 max-w-[820px]">
          <h1 className="text-headline font-semibold">{title}</h1>
          {lede ? <p className="mt-2 text-body text-fg-2">{lede}</p> : null}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </div>
    </header>
  );
}

/** A band of the page: title, optional note on the right, then its content. */
export function Section({ title, aside, children, className }: { index?: string; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-title-1 font-semibold">{title}</h2>
        {aside ? <div className="min-w-0 text-body-sm text-fg-3">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** The page body: header, then sections spaced on one rhythm. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="space-y-10 pb-6">{children}</div>;
}
