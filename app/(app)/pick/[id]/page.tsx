import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentUser } from '@/src/auth/current';
import { isMock } from '@/src/memory/walrus';
import { pickDetail } from '@/src/picks/board';
import { headline, marketForPick, sealedLead, shareText } from '@/src/picks/share';
import { BlobLink, day, pct } from '@/components/app/ui';
import { BackingTag, Redacted } from '@/components/letters/letter';
import { Seal } from '@/components/letters/seal';
import { ShareCard } from '@/components/letters/share-card';
import { Stamp } from '@/components/letters/stamp';
import { MarketIcon } from '@/components/letters/question-card';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = pickDetail((await params).id, { handle: null, address: null });
  if (!d) return { title: 'Prediction' };
  const text = shareText(d, false);
  return { title: `${d.letter.display} on ${headline(d.m)}`, description: text, openGraph: { description: text }, twitter: { card: 'summary_large_image' } };
}

export default async function PickPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const viewer = { handle: me?.profile?.handle ?? null, address: me?.session.address ?? null };
  const d = pickDetail(id, viewer);
  if (!d) notFound();
  const { letter: l, m } = d;
  const p = l.prediction;
  const mine = viewer.handle === l.namespace;
  const opened = l.status !== 'sealed';
  const stamp = l.result ? (l.result.win ? 'won' : 'missed') : l.status === 'void' ? 'void' : null;
  const mk = marketForPick(d);
  const lead = sealedLead(d);
  const mock = isMock();

  return (
    <div className="mx-auto max-w-[720px] pb-6 pt-8">
      <nav className="flex min-w-0 items-center gap-2 text-body-sm text-fg-3" aria-label="Breadcrumb">
        <Link href="/desk" className="shrink-0 hover:text-fg">
          Predict
        </Link>
        <span className="text-fg-4">›</span>
        <Link href={`/m/${m.id}`} className="truncate hover:text-fg">
          {headline(m)}
        </Link>
      </nav>

      <article className="panel mt-4 overflow-hidden">
        <header className="flex items-center gap-3.5 border-b border-line px-6 py-5">
          <Link href={`/p/${l.namespace}`}>
            <Seal seed={l.namespace} letter={l.display[0]} size={48} className="!ring-0" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/p/${l.namespace}`} className="text-body font-semibold hover:underline">
              {l.display}
            </Link>
            <div className="truncate text-caption text-fg-3">
              {l.kind === 'human' ? 'Predicted' : `Agent (${l.model}) predicted`} {day(l.submitted_at)} UTC{lead ? `, ${lead}` : ''}
            </div>
            {l.backs ? <BackingTag className="mt-1.5" /> : null}
          </div>
          {stamp ? (
            <div className="stamp-thump">
              <Stamp kind={stamp} />
            </div>
          ) : (
            <Stamp kind={p ? 'pending' : 'hidden'} />
          )}
        </header>

        <div className="px-6 py-6">
          <div className="flex items-start gap-3">
            <MarketIcon src={m.image} category={m.category} size={40} />
            <div className="min-w-0">
              <h1 className="text-balance text-title-1 font-semibold">{headline(m)}</h1>
              {headline(m) !== m.question ? <p className="mt-0.5 text-body-sm text-fg-3">{m.question}</p> : null}
            </div>
          </div>

          <div className={cn('mt-6 rounded-[var(--radius-md)] px-5 py-5', stamp === 'won' ? 'bg-positive-subtle' : stamp === 'missed' ? 'bg-negative-subtle' : 'bg-subtle')}>
            <div className="text-caption font-medium text-fg-3">{!opened && mine && d.phase === 'open' ? 'Your prediction, hidden from others until predictions close' : 'The prediction'}</div>
            {p ? (
              <>
                <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-display-sm font-semibold leading-none">{p.pick}</span>
                  <span className="num text-headline font-semibold">{pct(p.confidence)}</span>
                </div>
                <div className="mt-3 text-body-sm text-fg-2">
                  {mk === null ? null : <>The market gave this side {pct(mk)} at the time.</>}
                  {d.winner ? (
                    <>
                      {' '}
                      Resolved <span className="font-semibold text-fg">{d.winner}</span>.
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-3">
                  <Redacted w={160} className="!h-[34px]" />
                  <Redacted w={64} className="!h-[34px]" />
                </div>
                <p className="mt-4 text-body-sm text-fg-2">Hidden until predictions close ({day(d.lock_at)} UTC), so nobody can copy it.</p>
              </>
            )}
          </div>

          {p?.reasons ? (
            <blockquote className="mt-5 text-body leading-relaxed text-fg-2">
              <span className="text-caption font-medium text-fg-3">Their take</span>
              <p className="mt-1">{p.reasons.length > 600 ? `${p.reasons.slice(0, 600)}…` : p.reasons}</p>
            </blockquote>
          ) : null}
        </div>

        <dl className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">
          <div className="bg-surface px-6 py-4">
            <dt className="text-caption text-fg-3">Stored on Walrus</dt>
            <dd className="mt-1">
              <BlobLink blob={l.walrus.blob} mock={mock} />
            </dd>
          </div>
          <div className="bg-surface px-6 py-4">
            <dt className="text-caption text-fg-3">sha256 commitment</dt>
            <dd className="mono mt-1 truncate text-fg-2" title={l.commitment.sha256}>
              {l.commitment.sha256.slice(0, 16)}…
            </dd>
          </div>
          <div className="bg-surface px-6 py-4">
            <dt className="text-caption text-fg-3">Result</dt>
            <dd className="mt-1 text-body-sm text-fg-2">{d.winner ?? (d.phase === 'void' ? 'Void' : 'Not yet')}</dd>
          </div>
        </dl>
        {l.commitment.canonical ? (
          <details className="border-t border-line px-6 py-4 text-caption">
            <summary className="cursor-pointer text-fg-3 hover:text-fg">Verify it yourself: the sha256 of this text is the commitment above</summary>
            <pre className="code mt-3 whitespace-pre-wrap break-all">{l.commitment.canonical}</pre>
          </details>
        ) : null}
      </article>

      <div className="mt-5">
        <ShareCard id={l.id} text={shareText(d, mine)} path={`/pick/${l.id}`} reveal={mine && !!p && !pickDetail(id, { handle: null })?.letter.prediction} />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-4">
        <div className="flex gap-5 text-body-sm">
          <Link href={`/m/${m.id}`} className="text-fg-2 hover:text-fg">
            All predictions on this question →
          </Link>
          <Link href={`/p/${l.namespace}`} className="text-fg-2 hover:text-fg">
            {mine ? 'Your profile' : `${l.display}'s profile`} →
          </Link>
        </div>
      </div>
    </div>
  );
}
