import { readFile } from 'node:fs/promises';
import { MarkSvg } from '@/components/brand/mark';
import { join } from 'node:path';
import { waxFor } from '@/components/letters/seal';

// Share images in the app's own style: drawn with Satori (flexbox only, TTF
// fonts), 1200×630, for X and anything else that reads og:image.

export const OG_SIZE = { width: 1200, height: 630 };

export const C = {
  bg: '#0d0f13',
  card: '#15181e',
  subtle: '#1f242d',
  line: '#242a33',
  fg: '#eef0f4',
  fg2: '#b6bdc9',
  fg3: '#8a93a3',
  fg4: '#5e6674',
  seal: '#ef5a4f',
  green: '#3dd68c',
  greenBg: '#13281d',
  red: '#ff6b70',
  redBg: '#2e1719',
  blue: '#6b96ff',
  memory: '#5fd0dc',
  money: '#f4c15a',
};

const dir = join(process.cwd(), 'app/_og/fonts');
type Font = { name: string; data: Buffer; style: 'normal'; weight: 400 | 500 | 600 | 700 };
let fonts: Promise<Font[]> | null = null;

/** Inter for everything, Plex Mono for hashes and blob ids. */
export function ogFonts() {
  const f = (file: string, name: string, weight: Font['weight']) => readFile(join(dir, file)).then((data): Font => ({ name, data, style: 'normal', weight }));
  fonts ??= Promise.all([
    f('Inter-Regular.ttf', 'Inter', 400),
    f('Inter-Medium.ttf', 'Inter', 500),
    f('Inter-SemiBold.ttf', 'Inter', 600),
    f('Inter-Bold.ttf', 'Inter', 700),
    f('IBMPlexMono-Regular.ttf', 'Mono', 400),
  ]);
  return fonts;
}

/** A forecaster's round avatar with their initial; hollow once the pick is opened. */
export function OgSeal({ seed, letter, size, cracked = false }: { seed: string; letter: string; size: number; cracked?: boolean }) {
  if (seed === '0xkafka' && !cracked) return <MarkSvg size={size} />;
  const { base } = waxFor(seed);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size,
        background: cracked ? 'transparent' : base,
        border: cracked ? `${Math.max(3, size / 22)}px solid ${base}` : 'none',
        color: cracked ? base : '#ffffff',
        fontSize: size * 0.44,
        fontWeight: 600,
      }}
    >
      {letter.toUpperCase()}
    </div>
  );
}

const PILL: Record<string, { fg: string; bg: string }> = {
  'Called it': { fg: C.green, bg: C.greenBg },
  Missed: { fg: C.red, bg: C.redBg },
};

/** A status pill: Called it, Missed, Sealed, or a tier name. */
export function OgStamp({ word, color, size = 30, bg }: { word: string; color?: string; size?: number; bg?: string }) {
  const t = PILL[word] ?? { fg: color ?? C.fg2, bg: C.subtle };
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: size * 1.9, padding: `0 ${size * 0.8}px`, borderRadius: size * 2, background: bg ?? t.bg, color: t.fg, fontSize: size, fontWeight: 600 }}>
      {word}
    </div>
  );
}

/** A striped bar where a sealed word or number will be. */
export function OgRedacted({ w, h = 30 }: { w: number; h?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        width: w,
        height: h,
        borderRadius: 8,
        backgroundImage: `repeating-linear-gradient(-45deg, ${C.line} 0px, ${C.line} 8px, ${C.subtle} 8px, ${C.subtle} 16px)`,
      }}
    />
  );
}

/** The frame every card is drawn in: the brand, the content, and a footer line. */
export function OgSheet({ children, footLeft, footRight }: { children: React.ReactNode; footLeft: string; footRight: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: C.bg, padding: 40, fontFamily: 'Inter', color: C.fg }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: C.card,
          border: `1px solid ${C.line}`,
          borderRadius: 28,
          padding: '36px 48px 30px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <OgSeal seed="0xkafka" letter="K" size={40} />
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, letterSpacing: -0.6 }}>
              <span style={{ color: C.fg3 }}>0x</span>kafka
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 18, color: C.fg3 }}>Saved on Walrus</div>
        </div>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>{children}</div>
        <div style={{ display: 'flex', height: 1, background: C.line, marginBottom: 16 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, color: C.fg3, fontFamily: 'Mono' }}>
          <span style={{ color: C.memory }}>{footLeft}</span>
          <span>{footRight}</span>
        </div>
      </div>
    </div>
  );
}
