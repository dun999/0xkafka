import Link from 'next/link';
import { chainInfo, RPC_LABEL, rpcProvider, usdcBalance } from '@/src/chain/tatum';
import { config, nsName, NAMESPACES } from '@/src/config';
import { headline } from '@/src/memory/format';
import { isMock, outboxCounts, relayerCounts } from '@/src/memory/walrus';
import { recentBlobs, salesList, stats } from '@/src/views';
import { Page, PageHeader, Section } from '@/components/app/structure';
import { BlobLink, DigestLink, Empty, MetaList, Panel, rel, short, Stat, StatStrip, usdc } from '@/components/app/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ledger' };

export default async function LedgerPage() {
  const s = stats();
  const sales = salesList(50);
  const mock = isMock();
  const out = outboxCounts();
  const [balance, chain, relayer] = await Promise.all([
    config.payTo ? usdcBalance(config.payTo) : Promise.resolve(null),
    chainInfo(),
    relayerCounts(),
  ]);
  const blobs = recentBlobs(14);
  const c = s.counters;
  const provider = rpcProvider();

  return (
    <Page>
      <PageHeader
        index="05"
        eyebrow="Ledger"
        title="Payments, memory and chain reads"
        lede={`Every signal sold, every memory and every chain read, counted as they happen. Payments are verified on chain through ${RPC_LABEL[provider]}; memories are written to Walrus Memory on mainnet.`}
        aside={
          <MetaList
            items={[
              {
                label: '0xkafka wallet',
                value: config.payTo ? (
                  <a className="u" href={`https://suiscan.xyz/mainnet/account/${config.payTo}`} target="_blank" rel="noreferrer">
                    {short(config.payTo, 8, 6)}
                  </a>
                ) : (
                  'not set'
                ),
              },
              { label: 'Sui epoch', value: chain ? chain.epoch : '—' },
              { label: 'Memory account', value: mock ? 'dev mock' : short(config.memwal.accountId ?? '', 8, 6) },
            ]}
          />
        }
      />

      <StatStrip>
        <Stat label="Signal sales" value={`${usdc(s.usdc)} USDC`} tone="usd" sub={`${s.sales} paid over MPP`} />
        <Stat label="0xkafka wallet" value={balance === null ? '—' : `${usdc(balance)} USDC`} tone="usd" sub={config.payTo ? short(config.payTo, 8, 6) : 'no address set'} />
        <Stat label="Memories written" value={s.memories} tone="mem" sub={mock ? 'dev mock, not Walrus' : `${s.memoriesQueued} queued`} />
        <Stat label="Recalls" value={s.recalls} tone="mem" sub="by meaning, before each call" />
        <Stat label={provider === 'tatum' ? 'Tatum calls' : 'Sui RPC calls'} value={provider === 'tatum' ? s.tatumCalls : s.publicRpcCalls} sub={chain ? `${RPC_LABEL[provider]} · epoch ${chain.epoch}` : 'RPC unreachable'} />
        <Stat label="Model calls" value={s.llmCalls} sub={config.llm.model.split('/').at(-1)} />
      </StatStrip>

      <Section index="01" title="Payments" aside="MPP · sui/charge · USDC on Sui mainnet">
      <Panel title="Sales" meta={`${sales.length} shown`}>
        {sales.length === 0 ? (
          <Empty>
            No sales yet. <Link href="/agents" className="u">How agents buy</Link>.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Bought</th>
                  <th>Question</th>
                  <th className="r">USDC</th>
                  <th>Payer</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((x) => (
                  <tr key={x.id}>
                    <td className="num whitespace-nowrap text-fg-3">{rel(x.at)}</td>
                    <td className="whitespace-nowrap">{x.endpoint === 'forecast' ? 'Sealed forecast' : 'On-demand forecast'}</td>
                    <td className="max-w-[340px] truncate">
                      {x.market_id ? (
                        <Link href={`/m/${x.market_id}`} className="hover:underline">
                          {x.question ?? x.market_id}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num r text-money">{x.amount}</td>
                    <td className="num text-caption text-fg-2">{x.payer ? short(x.payer, 8, 6) : '—'}</td>
                    <td>
                      <DigestLink digest={x.digest} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      </Section>

      <Section index="02" title="Memory" aside="Walrus Memory, mainnet">
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Namespaces" meta={mock ? 'dev mock' : `account ${short(config.memwal.accountId ?? '', 8, 6)}`} className="lg:col-span-5">
          <table className="tbl">
            <thead>
              <tr>
                <th>Namespace</th>
                <th className="r">Written</th>
                <th className="r">Queued</th>
                <th className="r" title="memory_count reported by the relayer">Relayer</th>
              </tr>
            </thead>
            <tbody>
              {NAMESPACES.map((n) => {
                const name = nsName(n);
                const o = out[name] ?? { done: 0, queued: 0, failed: 0 };
                return (
                  <tr key={n}>
                    <td className="num text-caption">{name}</td>
                    <td className="num r">{o.done}</td>
                    <td className="num r text-fg-3">{o.queued}</td>
                    <td className="num r text-memory">{relayer ? (relayer[name] ?? 0) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="panel-f">Writes queue in SQLite and drain to the relayer with an idempotency key each, so a retry never writes twice.</div>
        </Panel>

        <Panel title="Latest memories" className="lg:col-span-7">
          {blobs.length === 0 ? (
            <Empty>Nothing written yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {blobs.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-3 py-1.5 text-caption">
                  <span className="num w-[108px] shrink-0 truncate text-fg-3">{b.namespace}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-2" title={b.text}>
                    {headline(b.text)}
                  </span>
                  <BlobLink blob={b.blob_id} mock={mock || !!b.mock} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      </Section>

      <Section index="03" title="Chain" aside={`${RPC_LABEL[provider]}${config.tatumKey ? ' and Tatum Price API' : ''}`}>
      <Panel title="Chain calls by provider and method">
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-3 py-2.5 text-body-sm">
          {Object.entries(c)
            .filter(([k]) => /^(tatum|sui-public)\./.test(k) && !k.endsWith('.calls'))
            .map(([k, v]) => (
              <span key={k}>
                <span className="text-fg-3">{k.startsWith('tatum.') ? `Tatum ${k.slice(6)}` : `public ${k.slice(11)}`}</span> <span className="num">{v}</span>
              </span>
            ))}
          {Object.keys(c).filter((k) => /^(tatum|sui-public)\./.test(k) && !k.endsWith('.calls')).length === 0 ? <span className="text-fg-3">None yet.</span> : null}
        </div>
      </Panel>
      </Section>
    </Page>
  );
}
