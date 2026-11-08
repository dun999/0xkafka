import { ImageResponse } from 'next/og';
import { badgesOf } from '@/src/picks/badges';
import { } from '@/components/app/ui';
import { toHandle } from '@/src/agents/store';
import { dossierOf } from '@/src/picks/dossier';
import { C, OG_SIZE, OgSeal, OgSheet, OgStamp, ogFonts } from '@/app/_og/card';

export const alt = 'A forecaster’s dossier on 0xkafka';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

const pct = (p: number | null) => (p === null ? '—' : `${Math.round(p * 100)}%`);

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const h = toHandle(decodeURIComponent((await params).handle));
  const d = h ? dossierOf(h, { handle: null, address: null }) : null;
  const fonts = await ogFonts();
  if (!d) {
    return new ImageResponse(
      <OgSheet footLeft="0xkafka" footRight="predictions you can't take back">
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 64, fontWeight: 600 }}>No such forecaster.</div>
      </OgSheet>,
      { ...size, fonts },
    );
  }
  const r = d.record;
  const p = d.profile;
  const { badges, streak } = badgesOf(p.handle, p.sui_address);
  const earned = badges.filter((b) => b.done).length;
  const facts: [string, string, string][] = [
    ['Win rate', r.n && r.winRate !== null ? `${Math.round(r.winRate * 100)}%` : '—', C.green],
    ['Predictions', String(d.sealed.length + d.archive.length), C.fg],
    ['Day streak', String(streak.current), C.fg],
    ['Memories', String(r.walrus.memories), C.memory],
    ['Badges', `${earned}/${badges.length}`, C.fg],
  ];

  return new ImageResponse(
    <OgSheet footLeft={p.walrus_namespace} footRight={r.n ? `saved on Walrus before the game, ${r.wins} of ${r.n} right` : 'saved on Walrus before the game'}>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <OgSeal seed={p.handle} letter={p.display.slice(0, 1)} size={150} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, lineHeight: 1, letterSpacing: -2.4 }}>{p.display}</div>
            <div style={{ display: 'flex', fontSize: 24, color: C.fg3, marginTop: 10 }}>@{p.handle} · {p.kind === 'human' ? 'person' : 'agent'}</div>
            {p.bio ? <div style={{ display: 'flex', fontSize: 26, color: C.fg2, marginTop: 10, maxWidth: 640 }}>{p.bio.slice(0, 80)}</div> : null}
          </div>
        </div>
        {streak.current ? <OgStamp word={`${streak.current}-day streak`} color={C.money} size={30} /> : null}
      </div>
      <div style={{ display: 'flex', marginBottom: 24, borderRadius: 20, background: C.subtle, padding: '20px 28px', justifyContent: 'space-between' }}>
        {facts.map(([label, value, color]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 18, color: C.fg3 }}>{label}</div>
            <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color, marginTop: 2, letterSpacing: -0.8 }}>{value}</div>
          </div>
        ))}
      </div>
    </OgSheet>,
    { ...size, fonts },
  );
}
