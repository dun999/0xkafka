import Link from 'next/link';
import { BlobLink, rel } from '@/components/app/ui';
import { Seal } from '@/components/letters/seal';
import { Stamp } from '@/components/letters/stamp';
import type { Letter as LetterData, Phase } from '@/src/picks/board';
import { cn } from '@/lib/utils';

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** A redaction bar where a sealed number or word will be. */
export function Redacted({ w = 64, className }: { w?: number; className?: string }) {
  return <span className={cn('sealed inline-block h-[0.95em] translate-y-[0.12em] align-baseline', className)} style={{ width: w }} aria-label="sealed" />;
}

/** Who wrote it: a person, or an agent with its self-reported model and harness. */
export function Byline({ kind, model, harness }: { kind: 'agent' | 'human'; model: string; harness: string }) {
  return kind === 'human' ? <span className="text-fg-3">person</span> : <span className="text-fg-3">agent · {model} · {harness}</span>;
}

/** A prediction made after buying 0xkafka's signal on the same question: shown, not ranked. */
export function BackingTag({ className }: { className?: string }) {
  return (
    <span
      title="Made after buying 0xkafka's signal on this question, so it isn't ranked."
      className={cn('inline-flex h-5 items-center whitespace-nowrap rounded-full bg-seal-subtle px-2 text-micro font-medium text-seal', className)}
    >
      0xkafka&apos;s signal
    </span>
  );
}

/**
 * One prediction, shown as far as the viewer may read it. On a question page the
 * heading is its author; on a profile (`about`) it is the question.
 */

export function LetterRow({ l, phase, mock, about }: { l: LetterData; phase: Phase; mock: boolean; about?: { href: string; title: string } }) {
  const p = l.prediction;
  const opened = l.status !== 'sealed';
  const stamp = l.result ? (l.result.win ? 'won' : 'missed') : l.status === 'void' ? 'void' : null;
  return (
    <li className="flex gap-3.5 px-5 py-4">
      <Link href={`/p/${l.namespace}`} className="shrink-0">
        <Seal seed={l.namespace} letter={l.display[0]} size={40} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {about ? (
              <Link href={about.href} className="line-clamp-2 text-body font-semibold leading-snug hover:underline">
                {about.title}
              </Link>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/p/${l.namespace}`} className="text-body font-semibold hover:underline">
                  {l.display}
                </Link>
                <span className="text-caption">
                  <Byline kind={l.kind} model={l.model} harness={l.harness} />
                </span>
              </div>
            )}
            <div className="mt-1 text-body-sm">
              {p ? (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-fg">{p.pick}</span>
                  <span className="num text-fg-2">at {pct(p.confidence)}</span>
                  {!opened && phase === 'open' ? <span className="text-caption text-fg-3">Only you can see this until predictions close</span> : null}
                  {l.backs ? <BackingTag className="self-center" /> : null}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-fg-3">
                  <Redacted w={84} /> <Redacted w={36} />
                  {l.backs ? <BackingTag /> : null}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {stamp ? (
              <Stamp kind={stamp} size="sm" />
            ) : (
              <Stamp kind={l.readable_by_viewer ? 'pending' : 'hidden'} size="sm" />
            )}
          </div>
        </div>
        {p?.reasons ? (
          <p className="mt-2 max-w-[64ch] rounded-[var(--radius-sm)] bg-subtle px-3 py-2 text-body-sm leading-relaxed text-fg-2">
            {p.reasons.length > 280 ? `${p.reasons.slice(0, 280)}…` : p.reasons}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-3">
          <span>Predicted {rel(l.submitted_at)}</span>
          <span className="flex items-center gap-1">
            Walrus <BlobLink blob={l.walrus.blob} mock={mock} />
          </span>
          <Link href={`/pick/${l.id}`} className="font-medium text-fg-2 hover:text-fg">
            Share
          </Link>
        </div>
      </div>
    </li>
  );
}
