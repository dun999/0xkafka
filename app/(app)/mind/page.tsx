import { CATEGORIES, CATEGORY_LABEL } from '@/src/markets/categories';
import { isMock } from '@/src/memory/walrus';
import { learningCurve, lessons, minds, record, reliability, stats, trustHistory } from '@/src/views';
import { MiniLine, Reliability, TrustBar } from '@/components/app/charts';
import { LearningCurve } from '@/components/app/LearningCurve';
import { Page, PageHeader, Section } from '@/components/app/structure';
import { BlobLink, day, Delta, Empty, f3, MetaList, Panel } from '@/components/app/ui';

export const dynamic = 'force-dynamic';

const WINDOW = 30;

export const metadata = { title: 'Mind' };

export default function MindPage() {
  const s = stats();
  const curve = learningCurve(WINDOW);
  const rec = record();
  const recLive = record({ mode: 'live' });
  const hist = trustHistory();
  const rel = reliability();
  const ls = lessons();
  const ms = minds();
  const mock = isMock();
  const policy = s.mind.policy;

  return (
    <Page>
      <PageHeader
        index="04"
        eyebrow="Mind"
        title={`Mind v${s.mind.version}`}
        lede="Two kinds of number fitted from 0xkafka's record: how far to trust its own view in each category, and how much to sharpen or soften what it says. Nothing here is written by the model. Each version is a memory on Walrus, and every forecast records the version it used."
        aside={
          <MetaList
            items={[
              { label: 'Trained on', value: `${s.mind.nScored} results` },
              { label: 'Calibration', value: `×${policy.calib.toFixed(2)}` },
              { label: 'Benched', value: policy.benched.length ? policy.benched.join(', ') : 'none' },
              { label: 'On Walrus', value: ms[0] ? <BlobLink blob={ms[0].blob} mock={mock} /> : '—' },
            ]}
          />
        }
      />

      <Section index="01" title="Performance" aside={`${s.scored} scored questions`}>
      <Panel title="Learning curve">
        <LearningCurve data={curve} window={WINDOW} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Record by category" meta="mean Brier · lower is better" className="lg:col-span-7">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="r">n</th>
                  <th className="r">0xkafka</th>
                  <th className="r">Blank</th>
                  <th className="r">Market</th>
                  <th className="r" title="0xkafka minus Blank: what memory bought">Memory effect</th>
                  <th className="r" title="0xkafka minus market">vs market</th>
                </tr>
              </thead>
              <tbody>
                {[...CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], r: rec[c] })), { key: 'all', label: 'All', r: rec.all }].map(({ key, label, r }) => (
                  <tr key={key} className={key === 'all' ? 'font-medium' : ''}>
                    <td>{label}</td>
                    <td className="num r text-fg-3">{r.n}</td>
                    <td className="num r">{f3(r.kafka)}</td>
                    <td className="num r text-fg-3">{f3(r.blank)}</td>
                    <td className="num r text-fg-3">{f3(r.market)}</td>
                    <td className="r">
                      <Delta v={r.kafka !== null && r.blank !== null ? r.kafka - r.blank : null} />
                    </td>
                    <td className="r">
                      <Delta v={r.kafka !== null && r.market !== null ? r.kafka - r.market : null} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-f">
            Live only: {recLive.all.n} scored{recLive.all.n ? ` · 0xkafka ${f3(recLive.all.kafka)} · Blank ${f3(recLive.all.blank)} · Market ${f3(recLive.all.market)}` : ''}. The rest is the
            walk-forward replay.
          </div>
        </Panel>

        <Panel title="Calibration" meta={`in force: ${policy.calib.toFixed(2)}`} className="lg:col-span-5">
          <div className="flex flex-wrap items-start gap-4 px-3 py-3">
            <Reliability kafka={rel.kafka} blank={rel.blank} />
            <div className="min-w-[140px] flex-1 space-y-2 text-body-sm text-fg-2">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 bg-viz-1" /> 0xkafka
                <span className="ml-2 inline-block h-2 w-2 bg-viz-2" /> Blank
              </div>
              <p>Each dot is a band of forecasts: what was said against how often it happened. On the diagonal is perfect.</p>
              <p>
                {policy.calib === 1
                  ? 'No adjustment in force: none beat leaving forecasts as they are.'
                  : policy.calib < 1
                    ? `0xkafka was too confident, so it softens every forecast (×${policy.calib.toFixed(2)} on log-odds).`
                    : `0xkafka was too timid, so it sharpens every forecast (×${policy.calib.toFixed(2)} on log-odds).`}
              </p>
            </div>
          </div>
        </Panel>
      </div>
      </Section>

      <Section index="02" title="Policy" aside="what the record changed">
      <Panel title="Trust in my own view" meta="0 = copy the market · 1 = ignore it · tick = start (0.50)">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Category</th>
                <th className="w-[34%]">Trust now</th>
                <th className="r">Value</th>
                <th>Across versions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => (
                <tr key={c}>
                  <td>{CATEGORY_LABEL[c]}</td>
                  <td>
                    <TrustBar value={policy.trust[c]} />
                  </td>
                  <td className="num r">{policy.trust[c].toFixed(2)}</td>
                  <td>
                    <MiniLine values={[0.5, ...hist.map((h) => h.trust[c])]} />
                  </td>
                  <td className="text-caption">{policy.benched.includes(c) ? <span className="text-negative">benched: not covering new questions</span> : <span className="text-fg-3">covering</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      </Section>

      <Section index="03" title="Memory" aside="lessons and versions, each a Walrus memory">
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Lessons" meta={`${ls.filter((l) => l.status === 'active').length} active · ${ls.filter((l) => l.status !== 'active').length} retired`} className="lg:col-span-7">
          {ls.length === 0 ? (
            <Empty>No lessons yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {ls.map((l) => (
                <li key={l.id} className="px-3 py-2">
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-3 text-micro text-fg-3">
                    <span className="num text-fg-2">L{l.id}</span>
                    <span>{l.kind}</span>
                    {l.category ? <span>{l.category}</span> : null}
                    <span>
                      v{l.born_version}
                      {l.retired_version ? `–v${l.retired_version}` : ''}
                    </span>
                    {l.retired_reason ? <span>retired: {l.retired_reason}</span> : null}
                    <span className="ml-auto">
                      <BlobLink blob={l.blob} mock={mock} />
                    </span>
                  </div>
                  <p className={`text-body-sm leading-snug ${l.status === 'active' ? '' : 'retired'}`}>{l.statement}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Versions" meta="each one a Walrus memory" className="lg:col-span-5">
          {ms.length === 0 ? (
            <Empty>0xkafka reflects after every 10 scored questions.</Empty>
          ) : (
            <ol className="max-h-[760px] divide-y divide-line overflow-y-auto">
              {ms.map((m) => (
                <li key={m.version} className="px-3 py-2">
                  <div className="mb-1 flex items-center gap-3 text-caption">
                    <span className="num font-medium">v{m.version}</span>
                    <span className="text-fg-3">{day(m.simTime)}</span>
                    <span className="text-fg-3">trained on {m.nScored}</span>
                    <span className="ml-auto">
                      <BlobLink blob={m.blob} mock={mock} />
                    </span>
                  </div>
                  <ul className="space-y-0.5 text-caption text-fg-2">
                    {m.diff.map((d, i) => (
                      <li key={i} className={d.startsWith('Retired') ? 'text-fg-3' : ''}>
                        <span className="num mr-1.5 text-fg-4">{d.startsWith('Retired') ? '−' : '+'}</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      </Section>
    </Page>
  );
}
