'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrambleTextPlugin, ScrollTrigger);

/** Characters used for every scramble in 0xkafka: plain ASCII, so they render in Plex Mono. */
export const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>';

export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

/** Same length and spacing as `text`, filled with noise: the starting frame of a decode. */
export function noise(text: string, chars = GLYPHS): string {
  return [...text].map((c) => (c === ' ' || c === '\n' ? c : chars[Math.floor(Math.random() * chars.length)])).join('');
}

export { gsap, ScrollTrigger, useGSAP };
