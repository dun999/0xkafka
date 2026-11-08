import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ForecastRow } from '@/src/agent/forecast';
import { hintsFor, insightsFor } from '@/src/agents/insights';
import { marketWindow } from '@/src/agents/views';
import { currentUser } from '@/src/auth/current';
import { config } from '@/src/config';
import { CATEGORY_LABEL, type Category } from '@/src/markets/categories';
import { priceHistory } from '@/src/markets/polymarket';
import { blobOf, isMock } from '@/src/memory/walrus';
import { lettersFor, phaseOf, type Phase } from '@/src/picks/board';
import { ownsSignal, signalList, type SignalItem } from '@/src/picks/signals';
import { isSealed, lessonsInForce, marketDetail, polymarketUrl, recalledOf } from '@/src/views';
import { Countdown } from '@/components/fx/motion';
import { PriceChart, ProbTrack } from '@/components/app/charts';
import { BuyCall, type Rail } from '@/components/app/chat-cards';
import { BlobLink, Chip, day, Delta, Empty, f3, Panel, pct, rel } from '@/components/app/ui';
import { LetterRow, Redacted } from '@/components/letters/letter';
import { PickSheet } from '@/components/letters/pick-sheet';
import { headlineOf, MarketIcon } from '@/components/letters/question-card';
import { Seal } from '@/components/letters/seal';
import { Stamp } from '@/components/letters/stamp';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = marketDetail((await params).id);
  return { title: d ? headlineOf(d.m) : 'Question' };
}

async function history(token: string | null, from: string | null, to: string | null) {
  if (!token) return [];
  const end = Math.floor(new Date(to ?? Date.now()).getTime() / 1000);
  const start = Math.floor(new Date(from ?? Date.now() - 3 * 86_400_000).getTime() / 1000) - 2 * 86_400;
  return priceHistory(token, start, Math.min(end, Math.floor(Date.now() / 1000)), 60).catch(() => []);
}

export default async function MarketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ side?: string }> }) {
  const { id } = await params;
  const sideParam = (await searchParams).side;
  const d = marketDetail(id);
  if (!d) notFound();
  const { m, f } = d;
  const sealed = isSealed(m);
  const mock = isMock();
  const pts = await history(m.yes_token, f?.made_at ?? null, m.closed_at);
  const recalled = f ? recalledOf(f) : [];
  const lessons = f ? lessonsInForce(m.category, f.mind_version) : [];
  const blob = f ? blobOf(f.memory_id) : null;
  const won = m.outcome === null ? null : (m.outcome as 0 | 1);
  const listed = m.source !== 'backtest';
  const w = listed ? marketWindow(m) : null;
  const phase = phaseOf(m);
  const me = await currentUser();
  const viewer = { handle: me?.profile?.handle ?? null, address: me?.session.address ?? null };
  const letters = listed ? lettersFor(m.id, viewer) : [];
  const myLetter = viewer.handle ? (letters.find((l) => l.namespace === viewer.handle) ?? null) : null;
  const hints = viewer.handle ? hintsFor(insightsFor(viewer.handle), m.category).map((i) => ({ text: i.text, tone: i.tone })) : [];
  const title = headlineOf(m);
  const last = pts.at(-1)?.p ?? m.price;

  return (
    <div className="pb-6">
      <nav className="flex items-center gap-2 pt-8 text-body-sm text-fg-3" aria-label="Breadcrumb">
        <Link href="/desk" className="hover:text-fg">
          Predict
        </Link>
        <span className="text-fg-4">›</span>
        <Link href={`/desk?c=${m.category}`} className="hover:text-fg">
          {CATEGORY_LABEL[m.category as Category] ?? m.category}
        </Link>
        {!listed ? <Chip>Replay</Chip> : null}
      </nav>

      <header className="mt-4 flex items-start gap-4">
        <MarketIcon src={m.image} category={m.category} size={64} />
        <div className="min-w-0">
          <h1 className="text-balance text-headline font-semibold">{title}</h1>
          {title !== m.question ? <p className="mt-1 text-body text-fg-2">{m.question}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-fg-3">
            <span>
              {m.start_time ? 'Starts' : 'Closes'} <span className="num text-fg-2">{day(m.start_time ?? m.end_date)} UTC</span>
            </span>
            {won !== null ? (
              <span>
                Resolved <span className="font-semibold text-fg">{won ? m.outcome_a : m.outcome_b}</span>
              </span>
            ) : null}
            <a href={polymarketUrl(m)} target="_blank" rel="noreferrer" className="hover:text-fg">
              Polymarket ↗
            </a>
          </div>
        </div>
      </header>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="panel p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-body-sm font-medium text-fg-2">{m.outcome_a}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="num text-display-sm font-semibold text-side-a">{pct(last)}</span>
                  <span className="text-body text-fg-3">chance</span>
                </div>
              </div>
              <span className="text-caption text-fg-3">Polymarket price, hourly</span>
            </div>
            <div className="mt-4">
              <PriceChart points={pts} label={`P(${m.outcome_a}) on Polymarket`} mark={sealed ? null : f?.final_p} />
            </div>
            {!sealed && f ? (
              <div className="mt-2 flex items-center gap-2 text-caption text-fg-3">
                <span className="h-0 w-4 border-t-[1.5px] border-dashed border-seal" aria-hidden /> 0xkafka said {pct(f.final_p)}
              </div>
            ) : null}
          </section>

          {listed ? (
            <section className="panel">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-1 pt-5">
                <h2 className="text-title-2 font-semibold">
                  Predictions <span className="num font-normal text-fg-3">{letters.length}</span>
                </h2>
                <span className="text-body-sm text-fg-3">
                  {phase === 'open' ? 'Hidden until predictions close' : phase === 'closed' || phase === 'awaiting' ? 'Waiting for the result' : 'Scored'}
                </span>
              </div>
              {letters.length ? (
                <ul className="divide-y divide-line">
                  {letters.map((l) => (
                    <LetterRow key={l.id} l={l} phase={phase} mock={mock} />
                  ))}
                </ul>
              ) : (
                <Empty>{phase === 'open' ? 'No predictions yet. Yours could be the first.' : 'Nobody predicted this question.'}</Empty>
              )}
            </section>
          ) : null}

          {f && !sealed ? (
            <Panel title="How 0xkafka got there" meta={`${day(f.made_at)} UTC · mind v${f.mind_version}`}>
              <div className="px-4 pt-3">
                <ProbTrack
                  outcome={won}
                  marks={[
                    ...(f.blank_p === null ? [] : [{ key: 'b', label: 'Blank', p: f.blank_p, color: 'var(--color-viz-2)' }]),
                    { key: 'm', label: 'Market', p: f.market_p, color: 'var(--color-viz-3)' },
                    { key: 'k', label: '0xkafka', p: f.final_p, color: 'var(--color-viz-1)', strong: true },
                  ]}
                />
              </div>
              <div className="overflow-x-auto border-t border-line">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>What happened</th>
                      <th className="r">P(A)</th>
                      <th className="r">Brier</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="whitespace-nowrap">Blank view</td>
                      <td className="text-fg-2">Same model and question, no memory</td>
                      <td className="num r">{pct(f.blank_raw)}</td>
                      <td className="num r text-fg-3">—</td>
                    </tr>
                    <tr>
                      <td className="whitespace-nowrap">Raw view</td>
                      <td className="text-fg-2">With {recalled.length} recalled outcomes from Walrus</td>
                      <td className="num r">{pct(f.raw_p)}</td>
                      <td className="num r text-fg-3">{won === null ? '—' : f3((f.raw_p - won) ** 2)}</td>
                    </tr>
                    <tr>
                      <td className="whitespace-nowrap">Trust</td>
                      <td className="text-fg-2">
                        Keep {Math.round(f.trust * 100)}% of my view, {Math.round((1 - f.trust) * 100)}% market ({pct(f.market_p)})
                      </td>
                      <td className="num r">{pct(f.blend_p)}</td>
                      <td className="num r text-fg-3">—</td>
                    </tr>
                    <tr>
                      <td className="whitespace-nowrap">Calibration</td>
                      <td className="text-fg-2">{f.calib === 1 ? 'None in force' : `×${f.calib.toFixed(2)} on log-odds`}</td>
                      <td className="num r font-semibold">{pct(f.final_p)}</td>
                      <td className="num r">{won === null ? '—' : f3((f.final_p - won) ** 2)}</td>
                    </tr>
                    <tr>
                      <td className="whitespace-nowrap text-fg-3">Benchmarks</td>
                      <td className="text-fg-3">Blank at half trust · Market price at forecast time</td>
                      <td className="num r whitespace-nowrap text-fg-3">
                        {pct(f.blank_p)} · {pct(f.market_p)}
                      </td>
                      <td className="num r whitespace-nowrap text-fg-3">{won === null ? '—' : `${f.blank_p === null ? '—' : f3((f.blank_p - won) ** 2)} · ${f3((f.market_p - won) ** 2)}`}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {won !== null ? (
                <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-body-sm">
                  <span>
                    vs market <Delta v={(f.final_p - won) ** 2 - (f.market_p - won) ** 2} />
                  </span>
                  {f.blank_p !== null ? (
                    <span>
                      vs blank <Delta v={(f.final_p - won) ** 2 - (f.blank_p - won) ** 2} />
                    </span>
                  ) : null}
                  <span className="text-fg-3">Brier difference; negative means 0xkafka was closer.</span>
                </div>
              ) : null}
            </Panel>
          ) : null}

          {f && !sealed ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Panel title="0xkafka's reason, with memory">
                <p className="px-4 py-3.5 text-body-sm leading-relaxed">{f.reason}</p>
              </Panel>
              <Panel title="Blank's reason, no memory">
                <p className="px-4 py-3.5 text-body-sm leading-relaxed text-fg-2">{f.blank_reason}</p>
              </Panel>
            </div>
          ) : null}

          {f && !sealed && f.context ? (
            <Panel title="Price data from Tatum">
              <CryptoCtx json={f.context} />
            </Panel>
          ) : null}

          {f ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Memory recalled" meta={sealed ? 'shown after it resolves' : `${recalled.length} from Walrus`}>
              {sealed ? (
                <p className="px-4 py-4 text-body-sm text-fg-3">0xkafka recalled {recalled.length} past outcomes for this call. They show once it resolves.</p>
              ) : recalled.length === 0 ? (
                <p className="px-4 py-4 text-body-sm text-fg-3">Nothing similar enough in memory yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {recalled.map((r) => (
                    <li key={r.blob_id} className="px-4 py-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="num text-caption text-fg-3">distance {r.distance.toFixed(2)}</span>
                        <BlobLink blob={r.blob_id} mock={mock} />
                      </div>
                      <p className="text-body-sm leading-snug text-fg-2">{r.text.split('\n').slice(0, 2).join(' ')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Lessons in force" meta={f ? `mind v${f.mind_version}` : null}>
              {lessons.length === 0 ? (
                <p className="px-4 py-4 text-body-sm text-fg-3">No lessons applied: trust {f ? f.trust.toFixed(2) : '0.50'}, the starting value.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {lessons.map((l) => (
                    <li key={l.id} className="px-4 py-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="num text-caption text-fg-3">Lesson {l.id}</span>
                        <BlobLink blob={l.blob_id} mock={mock} />
                      </div>
                      <p className="text-body-sm leading-snug">{l.statement}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          {listed && phase === 'open' ? (
            myLetter ? (
              <section className="panel p-5">
                <div className="flex items-center gap-3">
                  <Seal seed={myLetter.namespace} size={40} />
                  <div>
                    <div className="text-body font-semibold">Your prediction is in</div>
                    <div className="text-caption text-fg-3">Only you can see it until predictions close.</div>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between rounded-[var(--radius-sm)] bg-subtle px-4 py-3">
                  <span className="font-semibold">{myLetter.prediction?.pick}</span>
                  <span className="num text-title-2 font-semibold">{myLetter.prediction ? pct(myLetter.prediction.confidence) : ''}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-caption text-fg-3">
                  <span>
                    Closes in <Countdown to={w!.lock_at} short className="num font-medium text-fg-2" />
                  </span>
                  <Link href={`/pick/${myLetter.id}`} className="font-medium text-fg-2 hover:text-fg">
                    Share →
                  </Link>
                </div>
              </section>
            ) : (
              <>
                <PickSheet
                  market={{ id: m.id, outcome_a: m.outcome_a, outcome_b: m.outcome_b, price: m.price, lock_at: w!.lock_at }}
                  hints={hints}
                  initialSide={sideParam === 'a' || sideParam === 'b' ? sideParam : null}
                  backing={!!me && ownsSignal(me.session.address, m.id)}
                />
                <p className="flex items-center justify-center gap-1.5 text-caption text-fg-3">
                  Predictions close in <Countdown to={w!.lock_at} short className="num font-medium text-fg-2" />
                </p>
              </>
            )
          ) : listed ? (
            <section className="panel p-5">
              <div className="text-body-sm text-fg-3">{won !== null ? 'Resolved' : m.status === 'void' ? 'Voided' : 'Predictions closed'}</div>
              <div className="mt-1 text-title-1 font-semibold">
                {won !== null ? (won ? m.outcome_a : m.outcome_b) : m.status === 'void' ? 'No result' : 'Waiting for the result'}
              </div>
              <p className="mt-2 text-body-sm text-fg-2">
                {won !== null ? 'Every prediction is scored and on its owner’s record.' : 'Every prediction is open to read now. Scored when the result is in.'}
              </p>
            </section>
          ) : (
            <section className="panel p-5">
              <div className="text-title-2 font-semibold">A replayed question</div>
              <p className="mt-2 text-body-sm text-fg-2">0xkafka forecast this in its walk-forward replay of resolved questions, to learn before going live.</p>
            </section>
          )}
          {listed ? (
            <KafkaLetter
              phase={phase}
              f={f}
              won={won}
              outcomeA={m.outcome_a}
              blob={blob}
              mock={mock}
              sale={signalList({ id: m.id, address: me?.session.address ?? null, handle: me?.profile?.handle ?? null })[0] ?? null}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function CryptoCtx({ json }: { json: string }) {
  const c = JSON.parse(json) as { symbol: string; spot: number; at: string; vol30d: number; hoursLeft: number; model: number };
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 text-body-sm sm:grid-cols-4">
      <div>
        <div className="label">Spot</div>
        <div className="num">
          {c.symbol} ${c.spot.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </div>
      </div>
      <div>
        <div className="label">30d volatility</div>
        <div className="num">{(c.vol30d * 100).toFixed(0)}% / yr</div>
      </div>
      <div>
        <div className="label">Horizon</div>
        <div className="num">{c.hoursLeft.toFixed(0)}h</div>
      </div>
      <div>
        <div className="label">Lognormal P(A)</div>
        <div className="num">{pct(c.model)}</div>
      </div>
    </div>
  );
}

/** 0xkafka's signal: made at close from its lessons and the predictions, sold until the result, then opened. */
function KafkaLetter({
  phase,
  f,
  won,
  outcomeA,
  blob,
  mock,
  sale,
}: {
  phase: Phase;
  f: ForecastRow | null;
  won: 0 | 1 | null;
  outcomeA: string;
  blob: string | null;
  mock: boolean;
  /** On sale over MPP, until the question resolves. */
  sale: SignalItem | null;
}) {
  const rail: Rail = { protocol: 'MPP', name: 'Machine Payments Protocol', network: 'Sui mainnet', currency: 'USDC', pay_to: config.payTo ?? null };
  const opened = won !== null && f;
  const right = opened ? (f.final_p >= 0.5 ? 1 : 0) === won : null;
  return (
    <section className="panel p-5">
      <div className="flex items-center gap-3">
        <Seal seed="0xkafka" letter="K" size={40} className="!ring-0" />
        <div className="min-w-0">
          <div className="text-body font-semibold">0xkafka&apos;s signal</div>
          <div className="truncate text-caption text-fg-3">House forecaster · memory on Walrus</div>
        </div>
      </div>
      {opened ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-subtle px-4 py-3">
          <div>
            <div className="num text-title-1 font-semibold">{pct(f.final_p)}</div>
            <div className="text-caption text-fg-3">{outcomeA}</div>
          </div>
          <Stamp kind={right ? 'won' : 'missed'} />
        </div>
      ) : f ? (
        <>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-subtle px-4 py-3">
            <span className="flex items-center gap-2 text-body-sm text-fg-3">
              <Redacted w={44} /> {outcomeA}
            </span>
            <Stamp kind="hidden" size="sm" />
          </div>
          <p className="mt-3 text-body-sm text-fg-2">Made {rel(f.made_at)} from its lessons and the predictions here, weighed by each person&apos;s record.</p>
          <p className="mt-2 flex items-center gap-1 text-caption text-fg-3">
            Walrus <BlobLink blob={blob} mock={mock} />
          </p>
          {sale ? <BuyCall item={sale} price={config.prices.signal} rail={rail} mock={mock} /> : null}
        </>
      ) : (
        <>
          <p className="mt-3 text-body-sm text-fg-2">
            {sale
              ? 'No signal yet. It makes one when predictions close, or right away if you buy it, from the predictions so far and its lessons on Walrus.'
              : phase === 'open'
                ? 'Makes its signal when predictions close, after reading every prediction here and its lessons on Walrus.'
                : 'Making its signal now.'}
          </p>
          {sale ? <BuyCall item={sale} price={config.prices.signal} rail={rail} mock={mock} /> : null}
        </>
      )}
    </section>
  );
}
