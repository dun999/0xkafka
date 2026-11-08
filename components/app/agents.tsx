import Link from 'next/link';
import type { PublicSubmission } from '@/src/agents/views';
import { BlobLink, Chip, f3, pct, rel, SealedSlot, short } from '@/components/app/ui';
import { cn } from '@/lib/utils';

/** Reputation is skill against the market: positive beats it. */
export function Rep({ v, n, className }: { v: number; n?: number; className?: string }) {
  if (n === 0)
    return (
      <span className={cn('num text-fg-4', className)} title="Nothing resolved yet">
        —
      </span>
    );
  const tone = Math.abs(v) < 0.005 ? 'text-fg-3' : v > 0 ? 'text-positive' : 'text-negative';
  return (
    <span className={cn('num', tone, className)} title={n !== undefined ? `Skill against the market over ${n} resolved, shrunk toward 0` : undefined}>
      {v > 0 ? '+' : ''}
      {v.toFixed(3)}
    </span>
  );
}

export function AgentLink({ ns, display }: { ns: string; display?: string }) {
  return (
    <Link href={`/p/${ns}`} className="font-medium text-fg hover:underline">
      {display ?? ns}
    </Link>
  );
}

export function Attribution({ model, harness, effort }: { model: string; harness: string; effort?: string | null }) {
  return (
    <span className="text-caption text-fg-3">
      <span className="text-fg-2">{harness}</span> · {model}
      {effort ? ` · ${effort}` : ''}
    </span>
  );
}

/** One submission. Sealed: who, when, where it's committed. Revealed: the prediction, its reasons and its score. */
export function SubmissionItem({ s, mock, showQuestion = false }: { s: PublicSubmission; mock: boolean; showQuestion?: boolean }) {
  const p = s.prediction;
  const r = s.result;
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showQuestion ? (
          <Link href={`/m/${s.market_id}`} className="min-w-0 flex-1 truncate text-body hover:underline">
            {s.question ?? `#${s.market_id}`}
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <AgentLink ns={s.namespace} display={s.display} />
            <Attribution model={s.model} harness={s.harness} effort={s.effort} />
          </span>
        )}
        <span className="num text-micro text-fg-4" title={s.submitted_at}>
          {rel(s.submitted_at)}
        </span>
        {s.status === 'sealed' ? (
          <Chip tone="neutral">Sealed</Chip>
        ) : s.status === 'void' ? (
          <Chip tone="neutral">Void</Chip>
        ) : r ? (
          <Chip tone={r.win ? 'positive' : 'negative'}>{r.win ? 'Win' : 'Loss'}</Chip>
        ) : null}
      </div>

      {showQuestion ? (
        <div className="mt-0.5">
          <Attribution model={s.model} harness={s.harness} effort={s.effort} />
        </div>
      ) : null}

      {p ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-body-sm">
            <span>
              <span className="label mr-1.5">Pick</span>
              <span className="font-medium">{p.pick}</span> <span className="num">{pct(p.confidence)}</span>
            </span>
            {p.claim ? (
              <span>
                <span className="label mr-1.5">Claim</span>
                {p.claim}
              </span>
            ) : null}
            {r ? (
              <span>
                <span className="label mr-1.5">Brier</span>
                <span className="num">{f3(r.brier)}</span>
                {r.brier_market !== null ? <span className="num text-fg-3"> · market {f3(r.brier_market)}</span> : null}
              </span>
            ) : null}
          </div>
          <details className="group">
            <summary className="cursor-pointer select-none text-caption text-fg-3 hover:text-fg">Reasons and analytics</summary>
            <p className="mt-1.5 whitespace-pre-line text-body-sm leading-relaxed text-fg-2">{p.reasons}</p>
            {p.analytics.length ? (
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-caption sm:grid-cols-2">
                {p.analytics.map((a, i) => (
                  <div key={i} className="flex min-w-0 gap-2">
                    <dt className="shrink-0 text-fg-3">{a.label}</dt>
                    <dd className="min-w-0 truncate">
                      {a.source ? (
                        <a href={a.source} target="_blank" rel="noreferrer nofollow" className="u">
                          {a.value}
                        </a>
                      ) : (
                        a.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </details>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-3">
          <SealedSlot width={64} />
          <span className="num" title={`sha256 ${s.commitment.sha256}`}>
            sha256 {short(s.commitment.sha256, 8, 6)}
          </span>
          <BlobLink blob={s.walrus.blob} mock={mock} />
        </div>
      )}
    </li>
  );
}

export function SubmissionList({ subs, mock, showQuestion, empty }: { subs: PublicSubmission[]; mock: boolean; showQuestion?: boolean; empty: string }) {
  if (!subs.length) return <div className="px-3 py-4 text-body-sm text-fg-3">{empty}</div>;
  return (
    <ul className="divide-y divide-line">
      {subs.map((s) => (
        <SubmissionItem key={s.id} s={s} mock={mock} showQuestion={showQuestion} />
      ))}
    </ul>
  );
}
