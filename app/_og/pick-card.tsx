import { ImageResponse } from 'next/og';
import { pickDetail } from '@/src/picks/board';
import { headline, marketForPick, sealedLead } from '@/src/picks/share';
import { C, OG_SIZE, OgRedacted, OgSeal, OgSheet, OgStamp, ogFonts } from '@/app/_og/card';

// The share card for one prediction: what X shows, and what "Save image" saves.

const pct = (p: number) => `${Math.round(p * 100)}%`;
const size = OG_SIZE;

// What anyone sees: the pick only once it has opened. Never the sealed side or number.
export async function pickCard(id: string): Promise<ImageResponse> {
  const d = pickDetail(id, { handle: null, address: null });
  const fonts = await ogFonts();
  if (!d) {
    return new ImageResponse(
      <OgSheet footLeft="0xkafka" footRight="picks you can't take back">
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 64, fontWeight: 600 }}>No such pick.</div>
      </OgSheet>,
      { ...size, fonts },
    );
  }
  const { letter: l, m } = d;
  const p = l.prediction;
  const title = headline(m);
  const mk = marketForPick(d);
  const lead = sealedLead(d);
  const stamp = l.result ? { word: l.result.win ? 'Called it' : 'Missed' } : p ? null : { word: 'Hidden' };

  return new ImageResponse(
    <OgSheet footLeft={`${l.walrus.namespace}${l.walrus.blob ? ` · ${l.walrus.blob.slice(0, 12)}…` : ''}`} footRight={`sha256 ${l.commitment.sha256.slice(0, 16)}`}>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34 }}>
        <div style={{ display: 'flex', fontSize: title.length > 40 ? 46 : 56, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1.4, maxWidth: 940 }}>{title}</div>
        {title !== m.question ? <div style={{ display: 'flex', marginTop: 10, fontSize: 21, color: C.fg3, maxWidth: 940 }}>{m.question.slice(0, 110)}</div> : null}
      </div>

      <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '26px 32px',
            borderRadius: 22,
            background: l.result ? (l.result.win ? C.greenBg : C.redBg) : C.subtle,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <OgSeal seed={l.namespace} letter={l.display.slice(0, 1)} size={92} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 26, fontWeight: 600, color: C.fg2 }}>{l.display}</div>
              {p ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 2 }}>
                  <span style={{ fontSize: 54, fontWeight: 700, letterSpacing: -1.2 }}>{p.pick.slice(0, 24)}</span>
                  <span style={{ fontSize: 38, fontWeight: 600, color: C.fg2 }}>{pct(p.confidence)}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <OgRedacted w={240} h={42} />
                  <OgRedacted w={90} h={42} />
                </div>
              )}
              <div style={{ display: 'flex', marginTop: 8, fontSize: 19, color: C.fg3 }}>
                {p
                  ? [mk === null ? null : `market said ${pct(mk)}`, lead ? `predicted ${lead}` : null].filter(Boolean).join(', ')
                  : `predicted${lead ? ` ${lead}` : ''}, opens when predictions close`}
              </div>
            </div>
          </div>
          {stamp ? <OgStamp word={stamp.word} size={30} bg={C.card} /> : null}
        </div>
      </div>
    </OgSheet>,
    { ...size, fonts },
  );
}
