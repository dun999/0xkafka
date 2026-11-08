'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MarketIcon } from '@/components/letters/question-card';
import { PickSheet } from '@/components/letters/pick-sheet';
import { Seal } from '@/components/letters/seal';
import { Button } from '@/components/ui/button';
import { mppFetch, NotConnected, payError, shortAddr, suiscanTx, type PayStep } from '@/components/wallet/mpp';
import { useSession } from '@/components/wallet/session';
import { cn } from '@/lib/utils';

// What the chat can do besides talk. Buy 0xkafka's signal: pick one from a list,
// confirm the MPP payment, approve it in the wallet, read the signal, and post it
// to your profile if you like. Or make your own prediction on an open question.
// Each step is a turn in the conversation, so the chat reads top to bottom.

export type ListAction = { kind: 'signals' | 'picks'; category: string | null; q: string | null };
export type ChatAction = ListAction | { kind: 'pick'; id: string };

export interface SignalItem {
  id: string;
  title: string;
  question: string;
  category: string;
  image: string | null;
  outcome_a: string;
  outcome_b: string;
  market_price: number | null;
  decides_at: string;
  lock_at: string;
  picks_open: boolean;
  picks: number;
  state: 'ready' | 'on_request';
  owned: boolean;
  picked: boolean;
}

export interface Rail {
  protocol: string;
  name: string;
  network: string;
  currency: string;
  pay_to: string | null;
}

interface ListResponse {
  price_usdc: string;
  rail: Rail;
  record: { category: string | null; label: string; n: number; right: number; hit_rate: number | null };
  signals: SignalItem[];
}

/** 0xkafka's call as /api/v1/forecast/<id> returns it. */
export interface Bought {
  owned?: boolean;
  picks_open?: boolean;
  market: { id: string; question: string; outcome_a: string; outcome_b: string };
  forecast: {
    p: number;
    market_at_forecast: number;
    market_now: number | null;
    reason: string;
    walrus: { blob_id: string; url: string; namespace: string } | null;
  };
  memory_used: { recalled: { blob_id: string; memory: string }[]; lessons: { id: string; lesson: string; blob_id: string | null }[] };
  receipt?: { digest: string; suiscan: string; amount_usdc: string };
  shared_with?: { namespace: string; usdc: number }[];
}

export type Card =
  | { type: 'confirm'; item: SignalItem; price: string; rail: Rail }
  | { type: 'signal'; item: SignalItem; bought: Bought }
  | { type: 'offer'; item: SignalItem; pick: string; confidence: number }
  | { type: 'posted'; id: string; handle: string }
  | { type: 'pickform'; item: SignalItem };

export interface CardTurn {
  role: 'user' | 'assistant';
  /** What the model reads in later turns. */
  content: string;
  card?: Card;
}

export interface ChatOps {
  push: (...turns: CardTurn[]) => void;
  mock: boolean;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function until(iso: string): string {
  const m = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (m <= 0) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.round(h / 24)}d`;
}

const isYesNo = (it: Pick<SignalItem, 'outcome_a' | 'outcome_b'>) => /^yes$/i.test(it.outcome_a) && /^no$/i.test(it.outcome_b);
const marketOf = (it: SignalItem) => (it.market_price === null ? null : isYesNo(it) ? `Market Yes ${pct(it.market_price)}` : `${it.outcome_a} ${pct(it.market_price)}`);

/** 0xkafka's side, how sure it is, and the market on that side. */
export function callOf(b: Bought) {
  const a = b.forecast.p >= 0.5;
  const mA = b.forecast.market_now ?? b.forecast.market_at_forecast;
  const conf = a ? b.forecast.p : 1 - b.forecast.p;
  const market = a ? mA : 1 - mA;
  return { pick: a ? b.market.outcome_a : b.market.outcome_b, conf, market, edge: conf - market };
}

/** The turns after a call is bought or reopened: the call, then the offer to post it. */
export function afterBuy(item: SignalItem, b: Bought): CardTurn[] {
  const c = callOf(b);
  const turns: CardTurn[] = [
    {
      role: 'assistant',
      content: `Here is my signal on "${item.title}": ${c.pick} at ${pct(c.conf)}, market ${pct(c.market)}.${b.receipt ? ` Paid ${b.receipt.amount_usdc} USDC over MPP, tx ${b.receipt.digest}.` : ''}`,
      card: { type: 'signal', item, bought: b },
    },
  ];
  if ((b.picks_open ?? item.picks_open) && !item.picked) {
    turns.push({ role: 'assistant', content: 'Want me to post this prediction on your profile?', card: { type: 'offer', item, pick: c.pick, confidence: clamp(Math.round(c.conf * 100), 50, 99) } });
  }
  return turns;
}

/** The payment rail, named every time money moves. */
export function MppBadge({ className }: { className?: string }) {
  return (
    <span
      title="MPP, the Machine Payments Protocol: USDC on Sui, sent from your wallet and verified on chain"
      className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-micro font-medium text-fg-2', className)}
    >
      <span className="font-semibold tracking-wide text-fg">MPP</span>
      <span className="text-fg-4">·</span>
      USDC on Sui
    </span>
  );
}

function Shell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface text-[15px] leading-[1.5]', className)}>{children}</div>;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-5 text-body-sm text-fg-3">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-fg-4 border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

function useList(params: string) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/v1/signals?${params}`)
      .then((r) => (r.ok ? (r.json() as Promise<ListResponse>) : Promise.reject(new Error())))
      .then((j) => live && setData(j))
      .catch(() => live && setErr('Could not load the list. Try again.'));
    return () => {
      live = false;
    };
  }, [params]);
  return { data, err };
}

function Row({ it, meta, children }: { it: SignalItem; meta: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <MarketIcon src={it.image} category={it.category} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-medium text-fg">{it.title}</p>
        <p className="mt-0.5 truncate text-caption text-fg-3">{meta}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}


/** 0xkafka's signals for sale, with its record and a buy button on each. */
function SignalsList({ action, ops }: { action: ListAction; ops: ChatOps }) {
  const params = new URLSearchParams({ limit: '6', ...(action.category ? { category: action.category } : {}), ...(action.q ? { q: action.q } : {}) }).toString();
  const { data, err } = useList(params);
  const [chosen, setChosen] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  if (err) return <p className="text-body-sm text-negative">{err}</p>;
  if (!data) return <Shell>{<Loading label="Loading 0xkafka's signals" />}</Shell>;
  const r = data.record;

  const buy = (it: SignalItem) => {
    setChosen(it.id);
    ops.push(
      { role: 'user', content: `Buy 0xkafka's signal on "${it.title}"` },
      { role: 'assistant', content: `Confirm: ${data.price_usdc} USDC over MPP for my signal on "${it.title}".`, card: { type: 'confirm', item: it, price: data.price_usdc, rail: data.rail } },
    );
  };
  // Bought before from this wallet: open it again for free.
  const reopen = async (it: SignalItem) => {
    setOpening(it.id);
    const res = await fetch(`/api/v1/forecast/${it.id}`).catch(() => null);
    const j = res?.ok ? ((await res.json()) as Bought) : null;
    setOpening(null);
    if (!j?.forecast) return buy(it);
    setChosen(it.id);
    ops.push({ role: 'user', content: `Show the signal I bought on "${it.title}"` }, ...afterBuy(it, j));
  };

  return (
    <Shell>
      <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-fg">0xkafka&apos;s signals{action.category ? ` · ${r.label}` : ''}</p>
          <p className="mt-0.5 text-caption text-fg-3">
            {r.n && r.hit_rate !== null ? (
              <>
                Right on <span className="num text-fg-2">{r.right} of {r.n}</span> resolved {r.category ? `${r.label.toLowerCase()} ` : ''}questions ({pct(r.hit_rate)})
              </>
            ) : (
              'No resolved record here yet'
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="num text-body-sm font-semibold text-money">
            {data.price_usdc} USDC <span className="font-normal text-fg-3">each</span>
          </span>
          <MppBadge />
        </div>
      </header>
      {data.signals.length ? (
        <ul className="divide-y divide-line">
          {data.signals.map((it) => (
            <li key={it.id}>
              <Row
                it={it}
                meta={
                  <>
                    {it.state === 'ready' ? 'Signal ready' : 'Made when you buy'}, {until(it.decides_at)} to go{marketOf(it) ? `, ${marketOf(it)}` : ''}
                  </>
                }
              >
                {it.owned ? (
                  <Button size="sm" variant="secondary" onClick={() => void reopen(it)} disabled={opening === it.id}>
                    {opening === it.id ? 'Opening…' : 'Yours · View'}
                  </Button>
                ) : (
                  <Button size="sm" variant={chosen === it.id ? 'secondary' : 'primary'} onClick={() => buy(it)} disabled={chosen === it.id}>
                    {chosen === it.id ? 'Chosen' : `Buy · ${data.price_usdc} USDC`}
                  </Button>
                )}
              </Row>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-body-sm text-fg-3">Nothing for sale{action.category ? ` in ${r.label}` : ''} right now. New questions arrive through the day.</p>
      )}
      <footer className="border-t border-line px-4 py-2.5 text-caption text-fg-4">
        Paid over MPP: USDC goes from your wallet straight to 0xkafka, checked on Sui. Half is credited to the forecasters it read.
      </footer>
    </Shell>
  );
}

/** Open questions where you can make your own prediction. */
function PicksList({ action, ops }: { action: ListAction; ops: ChatOps }) {
  const params = new URLSearchParams({ for: 'pick', limit: '6', ...(action.category ? { category: action.category } : {}), ...(action.q ? { q: action.q } : {}) }).toString();
  const { data, err } = useList(params);
  const [chosen, setChosen] = useState<string | null>(null);
  if (err) return <p className="text-body-sm text-negative">{err}</p>;
  if (!data) return <Shell>{<Loading label="Loading open questions" />}</Shell>;

  const choose = (it: SignalItem) => {
    setChosen(it.id);
    ops.push({ role: 'user', content: `I want to pick on "${it.title}"` }, { role: 'assistant', content: `Here is the pick form for "${it.title}".`, card: { type: 'pickform', item: it } });
  };
  return (
    <Shell>
      <header className="border-b border-line px-4 py-3.5">
        <p className="text-body-sm font-semibold text-fg">Open for picks{action.category ? ` · ${data.record.label}` : ''}</p>
        <p className="mt-0.5 text-caption text-fg-3">Free. One prediction per question, and it can&apos;t be changed.</p>
      </header>
      {data.signals.length ? (
        <ul className="divide-y divide-line">
          {data.signals.map((it) => (
            <li key={it.id}>
              <Row it={it} meta={`Closes in ${until(it.lock_at)}${marketOf(it) ? `, ${marketOf(it)}` : ''}, ${it.picks} ${it.picks === 1 ? 'prediction' : 'predictions'}`}>
                {it.picked ? (
                  <Button size="sm" variant="secondary" disabled>
                    Predicted
                  </Button>
                ) : (
                  <Button size="sm" variant={chosen === it.id ? 'secondary' : 'primary'} onClick={() => choose(it)} disabled={chosen === it.id}>
                    {chosen === it.id ? 'Chosen' : 'Predict'}
                  </Button>
                )}
              </Row>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-body-sm text-fg-3">No questions open for picks{action.category ? ` in ${data.record.label}` : ''} right now.</p>
      )}
    </Shell>
  );
}

/** The pick form for one question, right in the chat. */
function PickForm({ item }: { item: SignalItem }) {
  const { me } = useSession();
  return (
    <div className="max-w-[440px]">
      <div className="mb-2.5 flex items-center gap-2.5">
        <MarketIcon src={item.image} category={item.category} size={28} />
        <p className="truncate text-body-sm font-semibold text-fg">{item.title}</p>
      </div>
      <PickSheet
        market={{ id: item.id, outcome_a: item.outcome_a, outcome_b: item.outcome_b, price: item.market_price, lock_at: item.lock_at }}
        backing={item.owned}
      />
    </div>
  );
}

function PickById({ id }: { id: string }) {
  const { data, err } = useList(new URLSearchParams({ for: 'pick', id }).toString());
  if (err) return <p className="text-body-sm text-negative">{err}</p>;
  if (!data) return <Shell>{<Loading label="Loading the question" />}</Shell>;
  const it = data.signals[0];
  if (!it) return <p className="text-body-sm text-fg-3">Predictions on that question are closed.</p>;
  if (it.picked) return <p className="text-body-sm text-fg-3">You already predicted &ldquo;{it.title}&rdquo;. Predictions can&apos;t be changed.</p>;
  return <PickForm item={it} />;
}

/** Buttons the model's answer asked for, shown under it. */
export function ActionCard({ action, ops }: { action: ChatAction; ops: ChatOps }) {
  return (
    <div className="mt-4">
      {action.kind === 'pick' ? <PickById id={action.id} /> : action.kind === 'signals' ? <SignalsList action={action} ops={ops} /> : <PicksList action={action} ops={ops} />}
    </div>
  );
}

type ConfirmStep = 'idle' | PayStep | 'done' | 'cancelled';

const STEPS: { key: PayStep; label: string }[] = [
  { key: 'wallet', label: 'Approve the payment in your wallet' },
  { key: 'proof', label: 'Sign the MPP payment proof' },
  { key: 'verifying', label: 'Payment checked on Sui' },
];

/** "Confirm transaction": what is paid, to whom, over which rail; then the wallet. */
function Confirm({ item, price, rail, ops }: { item: SignalItem; price: string; rail: Rail; ops: ChatOps }) {
  const { me, signIn } = useSession();
  const [step, setStep] = useState<ConfirmStep>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const busy = step === 'wallet' || step === 'proof' || step === 'verifying';

  async function confirm() {
    if (!me.address) {
      signIn();
      return;
    }
    setErr(null);
    setStep('wallet');
    try {
      const res = await mppFetch(`/api/v1/forecast/${item.id}`, setStep);
      const j = (await res.json().catch(() => ({}))) as Partial<Bought> & { error?: string };
      if (j.receipt?.digest) setDigest(j.receipt.digest);
      if (!res.ok || !j.forecast) throw new Error(j.error ?? `Payment failed (${res.status})`);
      setStep('done');
      ops.push(...afterBuy(item, j as Bought));
    } catch (e) {
      if (e instanceof NotConnected) {
        signIn();
        setStep('idle');
        return;
      }
      setErr(payError(e));
      setStep('idle');
    }
  }

  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <Shell>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
        <p className="text-body-sm font-semibold text-fg">Confirm transaction</p>
        <MppBadge />
      </header>
      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <MarketIcon src={item.image} category={item.category} size={36} />
          <div className="min-w-0">
            <p className="text-caption text-fg-3">0xkafka&apos;s signal on</p>
            <p className="truncate text-body-sm font-medium text-fg">{item.title}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-body-sm">
          <dt className="text-fg-3">Amount</dt>
          <dd className="num text-right font-semibold text-money">{price} USDC</dd>
          <dt className="text-fg-3">To</dt>
          <dd className="truncate text-right text-fg">
            0xkafka {rail.pay_to ? <span className="mono text-caption text-fg-3">{shortAddr(rail.pay_to)}</span> : null}
          </dd>
          <dt className="text-fg-3">Payment rail</dt>
          <dd className="text-right text-fg">MPP · Machine Payments Protocol</dd>
          <dt className="text-fg-3">Network</dt>
          <dd className="text-right text-fg">Sui mainnet · gas in SUI</dd>
        </dl>
        {item.state === 'on_request' ? (
          <p className="mt-4 rounded-[var(--radius-sm)] bg-subtle px-3 py-2.5 text-caption text-fg-2">
            0xkafka hasn&apos;t made this signal yet. Paying makes it now, from the predictions so far and its lessons on Walrus. That takes up to a minute.
          </p>
        ) : null}
        {busy || step === 'done' ? (
          <ol className="mt-4 space-y-2">
            {STEPS.map((s, i) => {
              const done = step === 'done' || i < at;
              const active = i === at;
              return (
                <li key={s.key} className={cn('flex items-center gap-2.5 text-body-sm', done ? 'text-fg-2' : active ? 'text-fg' : 'text-fg-4')}>
                  <span
                    className={cn(
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                      done ? 'bg-positive-subtle text-positive' : active ? 'bg-action text-on-action' : 'bg-subtle text-fg-4',
                    )}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  {s.label}
                  {active && s.key === 'verifying' && item.state === 'on_request' ? <span className="text-fg-3">, then 0xkafka makes its call…</span> : active ? <span className="text-fg-3">…</span> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        {err ? <p className="mt-3 text-body-sm text-negative">{err}</p> : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        {step === 'done' ? (
          <p className="text-caption text-positive">
            Paid {price} USDC over MPP
            {digest ? (
              <>
                {' · '}
                <a href={suiscanTx(digest)} target="_blank" rel="noreferrer" className="mono hover:underline">
                  tx {digest.slice(0, 8)}… ↗
                </a>
              </>
            ) : null}
          </p>
        ) : step === 'cancelled' ? (
          <p className="text-caption text-fg-3">Cancelled. Nothing was paid.</p>
        ) : (
          <>
            <p className="text-caption text-fg-4">{me.address ? 'Your wallet asks twice: approve the payment, then sign the MPP proof.' : 'Connect a Sui wallet with a little USDC to pay.'}</p>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStep('cancelled')} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Waiting for wallet…' : me.address ? `Confirm · ${price} USDC` : 'Connect wallet'}
              </Button>
            </div>
          </>
        )}
      </footer>
    </Shell>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'positive' | 'negative' | null }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-caption text-fg-3">{label}</p>
      <p className={cn('num mt-0.5 truncate text-title-3 font-semibold', tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-fg')}>{value}</p>
      <p className="truncate text-caption text-fg-4">{sub}</p>
    </div>
  );
}

/** The signal itself, with the Walrus memory behind it and the MPP receipt. */
function SignalView({ item, bought, mock }: { item: SignalItem; bought: Bought; mock: boolean }) {
  const [more, setMore] = useState(false);
  const c = callOf(bought);
  const edge = Math.round(c.edge * 100);
  const blob = bought.forecast.walrus;
  const linkBlob = blob && !mock && !blob.blob_id.startsWith('mock');
  return (
    <Shell>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Seal seed="0xkafka" letter="K" size={24} className="!ring-0" />
          <p className="truncate text-body-sm font-semibold text-fg">0xkafka&apos;s signal, {item.title}</p>
        </div>
        {bought.receipt ? (
          <span className="shrink-0 rounded-full bg-positive-subtle px-2.5 py-1 text-micro font-medium text-positive">Paid over MPP</span>
        ) : (
          <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-micro font-medium text-fg-2">Bought earlier</span>
        )}
      </header>
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        <Cell label="0xkafka says" value={c.pick} sub={`${pct(c.conf)} sure`} />
        <Cell label="Market" value={pct(c.market)} sub={`on ${c.pick}`} />
        <Cell label="Edge" value={`${edge > 0 ? '+' : edge < 0 ? '−' : ''}${Math.abs(edge)} pts`} sub="against the market" tone={edge > 0 ? 'positive' : edge < 0 ? 'negative' : null} />
      </div>
      <div className="px-4 py-3.5">
        <p className={cn('whitespace-pre-line text-body-sm text-fg-2', !more && 'line-clamp-4')}>{bought.forecast.reason}</p>
        {bought.forecast.reason.length > 260 ? (
          <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 text-caption font-medium text-fg-3 hover:text-fg">
            {more ? 'Less' : 'Read all'}
          </button>
        ) : null}
      </div>
      <LearnFromSignal marketId={item.id} mock={mock} />
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5 text-caption text-fg-3">
        {blob ? (
          linkBlob ? (
            <a href={blob.url} target="_blank" rel="noreferrer" className="text-memory hover:underline">
              Signal on Walrus <span className="mono">{blob.blob_id.slice(0, 8)}…</span> ↗
            </a>
          ) : (
            <span className="text-memory">Signal on Walrus (writing…)</span>
          )
        ) : null}
        <span>
          {bought.memory_used.recalled.length} memories · {bought.memory_used.lessons.length} lessons used
        </span>
        {bought.receipt ? (
          <a href={suiscanTx(bought.receipt.digest)} target="_blank" rel="noreferrer" className="text-money hover:underline">
            {bought.receipt.amount_usdc} USDC · MPP · <span className="mono">tx {bought.receipt.digest.slice(0, 8)}…</span> ↗
          </a>
        ) : null}
      </footer>
    </Shell>
  );
}

interface Learned {
  version: number;
  added: { n: number; kind: 'edge' | 'leak' | 'habit' | 'taste'; statement: string; replaces: number | null }[];
  retired: { n: number; statement: string; reason: string }[];
  reflected: boolean;
}

const LESSON_KIND = { edge: 'Where you do well', leak: 'Where you lose', habit: 'How you predict', taste: 'What you care about' } as const;

/**
 * "Learn from this signal": save it to your own Walrus memory, privately, and let your
 * assistant learn from it now. Shows the memory's blob once written, and what changed.
 */
function LearnFromSignal({ marketId, mock }: { marketId: string; mock: boolean }) {
  const { me, signIn } = useSession();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [blob, setBlob] = useState<string | null>(null);
  const [learned, setLearned] = useState<Learned | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const url = `/api/v1/forecast/${marketId}/learn`;

  // Saved before (a past chat, or the question page): show it as saved.
  useEffect(() => {
    if (!me.profile) return;
    let live = true;
    void fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { saved: boolean; blob: string | null } | null) => {
        if (!live || !j?.saved) return;
        setState((s) => (s === 'idle' ? 'saved' : s));
        setBlob(j.blob);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [me.profile, url]);

  // The memory gets its blob a few seconds after it is written to Walrus.
  useEffect(() => {
    if (state !== 'saved' || blob) return;
    let tries = 0;
    const t = setInterval(async () => {
      if (++tries > 40) return clearInterval(t);
      const j = (await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { blob: string | null } | null;
      if (j?.blob) {
        setBlob(j.blob);
        clearInterval(t);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [state, blob, url]);

  async function learn() {
    if (!me.profile) return signIn();
    setState('saving');
    setErr(null);
    const r = await fetch(url, { method: 'POST' }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as ({ blob: string | null; learned: Learned } & { error?: string }) | null;
    if (!r?.ok || !j) {
      setErr(j?.error ?? 'Could not save it. Try again.');
      return setState('error');
    }
    setBlob(j.blob);
    setLearned(j.learned);
    setState('saved');
  }

  return (
    <div className="border-t border-line px-4 py-3">
      {state === 'idle' || state === 'error' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="sm" variant="secondary" onClick={() => void learn()}>
            Learn from this signal
          </Button>
          <p className="min-w-0 flex-1 text-caption text-fg-3">
            {err ?? 'Saves it to your own Walrus memory. Your assistant learns from it about you, privately.'}
          </p>
        </div>
      ) : state === 'saving' ? (
        <p className="flex items-center gap-2 text-caption text-fg-2">
          <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-memory" />
          Saving to your Walrus memory, then your assistant reflects on it…
        </p>
      ) : (
        <div className="space-y-2.5">
          <p className="flex flex-wrap items-center gap-x-2 text-caption">
            <span className="font-medium text-memory">Saved to your Walrus memory</span>
            {blob && !mock ? (
              <a href={`https://walruscan.com/mainnet/blob/${blob}`} target="_blank" rel="noreferrer" className="mono text-fg-3 hover:text-memory">
                {blob.slice(0, 8)}… ↗
              </a>
            ) : (
              <span className="text-fg-4">writing to Walrus…</span>
            )}
            <span className="text-fg-4">Only you can see it.</span>
          </p>
          {learned ? (
            learned.added.length ? (
              <div className="rounded-[var(--radius-sm)] bg-memory-subtle/60 px-3 py-2.5">
                <p className="text-micro font-semibold text-memory">Your assistant learned{learned.version ? `, now v${learned.version}` : ''}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {learned.added.map((l) => (
                    <li key={l.n} className="text-body-sm text-fg">
                      <span className="text-micro font-medium text-fg-3">
                        {LESSON_KIND[l.kind]} · A{l.n}
                        {l.replaces ? ` · replaces A${l.replaces}` : ''}
                      </span>
                      <span className="block">{l.statement}</span>
                    </li>
                  ))}
                </ul>
                {learned.retired.filter((r) => !learned.added.some((a) => a.replaces === r.n)).length ? (
                  <p className="mt-1.5 text-micro text-fg-3">
                    Dropped:{' '}
                    {learned.retired
                      .filter((r) => !learned.added.some((a) => a.replaces === r.n))
                      .map((r) => `A${r.n} (${r.reason})`)
                      .join('; ')}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-caption text-fg-3">
                {learned.reflected
                  ? 'Your assistant kept its lessons for now. It will check this signal against the result and learn then.'
                  : 'Your assistant will learn from it in the background.'}
              </p>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

/** "Want me to post this prediction on your profile?" */
function Offer({ item, pick, confidence, ops, answered = null }: { item: SignalItem; pick: string; confidence: number; ops: ChatOps; answered?: 'yes' | 'no' | null }) {
  const { me, signIn } = useSession();
  const [state, setState] = useState<'ask' | 'posting' | 'done' | 'declined'>(answered === 'yes' ? 'done' : answered === 'no' ? 'declined' : 'ask');
  const [err, setErr] = useState<string | null>(null);

  async function yes() {
    if (!me.profile) {
      signIn();
      return;
    }
    setState('posting');
    setErr(null);
    try {
      const r = await fetch('/api/v1/picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ market_id: item.id, pick, confidence, take: '' }) });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? `Could not post it (${r.status})`);
      setState('done');
      ops.push(
        { role: 'user', content: 'Yes, post it' },
        {
          role: 'assistant',
          content: `Posted. ${pick} at ${confidence}% on "${item.title}" is on your profile and going to your Walrus memory. It's marked as from my signal, so it won't count toward your win rate.`,
          card: { type: 'posted', id: j.id, handle: me.profile.handle },
        },
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState('ask');
    }
  }
  function no() {
    setState('declined');
    ops.push({ role: 'user', content: 'No thanks' }, { role: 'assistant', content: 'Okay, it stays off your profile.' });
  }

  return (
    <Shell>
      <div className="px-4 py-4">
        <p className="text-body-sm font-semibold text-fg">Want me to post this prediction on your profile?</p>
        <p className="mt-1 text-body-sm text-fg-2">
          <span className="font-semibold text-fg">
            {pick} at {confidence}%
          </span>{' '}
          on {item.title}, saved on Walrus. Free.
        </p>
        <p className="mt-2 text-caption text-fg-3">It&apos;s my signal, so it won&apos;t count toward your win rate.</p>
        {err ? <p className="mt-2 text-body-sm text-negative">{err}</p> : null}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        {state === 'done' ? (
          <p className="mr-auto text-caption text-positive">Posted to your profile</p>
        ) : state === 'declined' ? (
          <p className="mr-auto text-caption text-fg-3">Not posted</p>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={no} disabled={state === 'posting'}>
              No thanks
            </Button>
            <Button size="sm" variant="primary" onClick={() => void yes()} disabled={state === 'posting'}>
              {state === 'posting' ? 'Posting…' : me.profile ? 'Yes, post it' : 'Sign in to post'}
            </Button>
          </>
        )}
      </footer>
    </Shell>
  );
}

/** A payment card from an earlier session: what was asked, and whether it was paid. */
function PastConfirm({ item, price, paid }: { item: SignalItem; price: string; paid: boolean }) {
  return (
    <Shell>
      <div className="flex items-center gap-3 px-4 py-3">
        <MarketIcon src={item.image} category={item.category} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-medium text-fg">0xkafka&apos;s signal on {item.title}</p>
          <p className="text-caption text-fg-3">{price} USDC over MPP</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-micro font-medium', paid ? 'bg-positive-subtle text-positive' : 'bg-subtle text-fg-3')}>{paid ? 'Paid' : 'Not paid'}</span>
      </div>
    </Shell>
  );
}

/** A turn that is a card, made by the app rather than the model. `past` is set for cards from an earlier session. */
export function CardView({ card, ops, past }: { card: Card; ops: ChatOps; past?: { paid: boolean; answer: 'yes' | 'no' | null } }) {
  switch (card.type) {
    case 'confirm':
      return past ? <PastConfirm item={card.item} price={card.price} paid={past.paid} /> : <Confirm item={card.item} price={card.price} rail={card.rail} ops={ops} />;
    case 'signal':
      return <SignalView item={card.item} bought={card.bought} mock={ops.mock} />;
    case 'offer':
      return <Offer item={card.item} pick={card.pick} confidence={card.confidence} ops={ops} answered={past?.answer ?? null} />;
    case 'pickform':
      return <PickForm item={card.item} />;
    case 'posted':
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button href={`/pick/${card.id}`} size="sm" variant="secondary">
            View pick
          </Button>
          <Button href={`/p/${card.handle}`} size="sm" variant="ghost">
            Your profile
          </Button>
        </div>
      );
  }
}

/**
 * The same buy flow on a question page: a button, then the MPP confirmation,
 * the signal, and the offer to post it, stacked in place.
 */
export function BuyCall({ item, price, rail, mock }: { item: SignalItem; price: string; rail: Rail; mock: boolean }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [opening, setOpening] = useState(false);
  const ops: ChatOps = { mock, push: (...turns) => setCards((c) => [...c, ...turns.flatMap((t) => (t.role === 'assistant' && t.card ? [t.card] : []))]) };

  async function reopen() {
    setOpening(true);
    const res = await fetch(`/api/v1/forecast/${item.id}`).catch(() => null);
    const j = res?.ok ? ((await res.json()) as Bought) : null;
    setOpening(false);
    if (j?.forecast) ops.push(...afterBuy(item, j));
    else setCards([{ type: 'confirm', item, price, rail }]);
  }

  if (!cards.length)
    return (
      <div className="mt-4 border-t border-line pt-4">
        {item.owned ? (
          <Button variant="secondary" className="w-full" onClick={() => void reopen()} disabled={opening}>
            {opening ? 'Opening…' : 'View the signal you bought'}
          </Button>
        ) : (
          <Button variant="primary" className="w-full" onClick={() => setCards([{ type: 'confirm', item, price, rail }])}>
            {`Buy 0xkafka's signal, ${price} USDC`}
          </Button>
        )}
        <div className="mt-2.5 flex items-center justify-between gap-2 text-caption text-fg-3">
          <span>{item.state === 'ready' ? 'Signal ready. On sale until the result.' : 'Buying it makes the signal now.'}</span>
          <MppBadge />
        </div>
      </div>
    );
  return (
    <div className="mt-4 space-y-3">
      {cards.map((c, i) => (
        <CardView key={i} card={c} ops={ops} />
      ))}
    </div>
  );
}
