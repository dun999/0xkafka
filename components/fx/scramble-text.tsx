'use client';

import { useRef } from 'react';
import { GLYPHS, gsap, MOTION_OK, noise, useGSAP } from './gsap';

type Tag = 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3';

/**
 * Text that decodes from noise. `load` runs on mount (hero), `view` when it scrolls in.
 * Screen readers get the final text; reduced motion shows it at once.
 */
export function ScrambleText({
  text,
  as: Tag = 'span',
  className,
  trigger = 'view',
  delay = 0,
  duration = 1.2,
  chars = GLYPHS,
}: {
  text: string;
  as?: Tag;
  className?: string;
  trigger?: 'load' | 'view';
  delay?: number;
  duration?: number;
  chars?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const inner = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = inner.current;
      const host = ref.current;
      if (!el || !host) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        el.textContent = noise(text, chars);
        host.style.visibility = 'visible';
        gsap.to(el, {
          duration,
          delay,
          ease: 'none',
          scrambleText: { text, chars, revealDelay: duration * 0.35, speed: 0.7, tweenLength: false },
          scrollTrigger: trigger === 'view' ? { trigger: host, start: 'top 90%', once: true } : undefined,
        });
      });
      mm.add('(prefers-reduced-motion: reduce)', () => {
        el.textContent = text;
        host.style.visibility = 'visible';
      });
      return () => mm.revert();
    },
    { dependencies: [text] },
  );

  return (
    <Tag ref={ref as never} className={className} aria-label={text} data-fx={trigger === 'load' ? 'load' : undefined}>
      <span ref={inner} aria-hidden>
        {text}
      </span>
    </Tag>
  );
}

/** Scrambles its text when the nearest link or button is hovered or focused. */
export function ScrambleHover({ text, chars = GLYPHS }: { text: string; chars?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    (_, contextSafe) => {
      const el = ref.current;
      const target = el?.closest('a,button');
      if (!el || !target || !contextSafe) return;
      if (!window.matchMedia(MOTION_OK).matches) return;
      const run = contextSafe(() => {
        gsap.killTweensOf(el);
        gsap.to(el, { duration: 0.55, ease: 'none', scrambleText: { text, chars, revealDelay: 0.12, speed: 1, tweenLength: false } });
      });
      target.addEventListener('mouseenter', run);
      target.addEventListener('focus', run);
      return () => {
        target.removeEventListener('mouseenter', run);
        target.removeEventListener('focus', run);
      };
    },
    { dependencies: [text] },
  );
  return (
    <span ref={ref} className="inline-block">
      {text}
    </span>
  );
}
