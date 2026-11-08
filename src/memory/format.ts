// The text of every memory 0xkafka writes to Walrus.
// Human sentences come first so recall embeds the meaning; a trailing `meta:`
// line carries the fields code needs back (ids, times), parsed by parseMeta().

const pct = (p: number) => `${Math.round(p * 100)}%`;
const f3 = (n: number) => n.toFixed(3);
const f2 = (n: number) => n.toFixed(2);

export function parseMeta(text: string): Record<string, string> {
  const line = text.split('\n').find((l) => l.startsWith('meta:'));
  if (!line) return {};
  const out: Record<string, string> = {};
  for (const part of line.slice(5).trim().split(/\s+/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/** First line of a memory without its meta, for compact display. */
export const headline = (text: string) => text.split('\n')[0];

export interface ForecastMemory {
  marketId: string;
  category: string;
  question: string;
  outcomeA: string;
  madeAt: string;
  mode: string;
  raw: number;
  /** Replay only: the same model with no memory, as a control. */
  blank: number | null;
  market: number;
  trust: number;
  calib: number;
  final: number;
  reason: string;
  recalled: number;
  lessons: number;
  agents: number;
  mind: number;
}

export function forecastText(f: ForecastMemory): string {
  const inputs = [
    f.agents ? `${f.agents} agent prediction${f.agents === 1 ? '' : 's'}` : 'no agents',
    `${f.lessons} lesson${f.lessons === 1 ? '' : 's'}`,
    `${f.recalled} past outcome${f.recalled === 1 ? '' : 's'}`,
  ].join(', ');
  return [
    `0xkafka prediction · ${f.category} · "${f.question}" · P("${f.outcomeA}") = ${pct(f.final)}.`,
    `Own view ${pct(f.raw)}${f.blank === null ? '' : ` (blank ${pct(f.blank)})`}, market ${pct(f.market)}, trust ${f2(f.trust)}, calibration ${f2(f.calib)}, final ${pct(f.final)}.`,
    `Why: ${f.reason}`,
    `Built from ${inputs}. Mind v${f.mind}.`,
    `meta: market=${f.marketId} made=${f.madeAt} category=${f.category} mode=${f.mode} mind=${f.mind}`,
  ].join('\n');
}

export interface OutcomeMemory {
  marketId: string;
  category: string;
  question: string;
  outcomeA: string;
  winner: string;
  resolvedAt: string;
  final: number;
  market: number;
  blank: number | null;
  raw: number;
  brierFinal: number;
  brierMarket: number;
  brierBlank: number | null;
  reason: string;
  mode: string;
  /** Agents who predicted this question, with whether their pick won. */
  agents?: { display: string; pick: string; confidence: number; win: boolean }[];
}

export function outcomeText(o: OutcomeMemory): string {
  const verdict =
    Math.abs(o.brierFinal - o.brierMarket) < 0.005
      ? 'I matched the market.'
      : o.brierFinal < o.brierMarket
        ? 'I beat the market.'
        : 'The market beat me.';
  const agents = o.agents ?? [];
  const right = agents.filter((a) => a.win).length;
  return [
    `0xkafka outcome · ${o.category} · "${o.question}" · resolved: ${o.winner}.`,
    `I gave "${o.outcomeA}" ${pct(o.final)} (Brier ${f3(o.brierFinal)}); the market gave ${pct(o.market)} (${f3(o.brierMarket)})${
      o.blank === null || o.brierBlank === null ? '' : `; blank gave ${pct(o.blank)} (${f3(o.brierBlank)})`
    }. ${verdict}`,
    `My own view was ${pct(o.raw)}: ${o.reason}`,
    agents.length
      ? `Agents: ${right} of ${agents.length} right. ${agents
          .slice(0, 12)
          .map((a) => `${a.display} ${a.win ? '✓' : '✗'} ${a.pick} ${pct(a.confidence)}`)
          .join('; ')}.`
      : '',
    `meta: market=${o.marketId} resolved=${o.resolvedAt} category=${o.category} mode=${o.mode}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface LessonMemory {
  id: number;
  kind: string;
  category: string | null;
  statement: string;
  version: number;
  retires?: number[];
}

export function lessonText(l: LessonMemory): string {
  return [
    `0xkafka lesson L${l.id} · ${l.category ?? 'all'} · ${l.kind}: ${l.statement}`,
    l.retires?.length ? `Replaces ${l.retires.map((r) => `L${r}`).join(', ')}.` : '',
    `meta: lesson=${l.id} kind=${l.kind} category=${l.category ?? 'all'} version=${l.version}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface MindMemory {
  version: number;
  at: string;
  nScored: number;
  policy: {
    trust: Record<string, number>;
    calib: number;
    benched: string[];
  };
  changes: string[];
}

export function mindText(m: MindMemory): string {
  const trust = Object.entries(m.policy.trust)
    .map(([c, w]) => `${c} ${f2(w)}`)
    .join(', ');
  return [
    `0xkafka mind v${m.version} · ${m.at.slice(0, 10)} · trained on ${m.nScored} scored questions.`,
    `Trust in my own view: ${trust}. Calibration ${f2(m.policy.calib)}. Benched: ${m.policy.benched.length ? m.policy.benched.join(', ') : 'none'}.`,
    m.changes.length ? `Changes: ${m.changes.join(' ')}` : 'No changes.',
    `policy: ${JSON.stringify(m.policy)}`,
    `meta: mind=${m.version} at=${m.at}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function parsePolicyLine(text: string): MindMemory['policy'] | null {
  const line = text.split('\n').find((l) => l.startsWith('policy: '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(8));
  } catch {
    return null;
  }
}

// ---------- agents ----------

export interface SubmissionMemory {
  id: string;
  handle: string;
  display: string;
  marketId: string;
  category: string;
  question: string;
  pick: string;
  confidence: number;
  pA: number;
  outcomeA: string;
  market: number | null;
  claim: string | null;
  reasons: string;
  analytics: { label: string; value: string; source?: string }[];
  model: string;
  harness: string;
  effort: string | null;
  commitment: string;
  at: string;
}

/** Written when a pick is sealed: a timestamped record on Walrus (encrypted by the relayer until it resolves). */
export function submissionText(s: SubmissionMemory): string {
  const stats = s.analytics.map((a) => `${a.label}: ${a.value}${a.source ? ` (${a.source})` : ''}`).join('; ');
  return [
    `${s.display} prediction · ${s.category} · "${s.question}" · picked "${s.pick}" at ${pct(s.confidence)}${s.claim ? ` (claim: ${s.claim})` : ''}.`,
    `${s.model === 'Human' ? 'Sealed by a person on the web' : `${s.harness} · ${s.model}${s.effort ? ` · effort ${s.effort}` : ''}`}. P("${s.outcomeA}") = ${pct(s.pA)}; market ${s.market === null ? 'unknown' : pct(s.market)} when sealed.`,
    s.reasons ? `${s.model === 'Human' ? 'Take' : 'Reasons'}: ${s.reasons}` : '',
    stats ? `Analytics: ${stats}` : '',
    `meta: kind=submission handle=${s.handle} sub=${s.id} market=${s.marketId} category=${s.category} at=${s.at} sha256=${s.commitment}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ResultMemory {
  id: string;
  handle: string;
  display: string;
  marketId: string;
  category: string;
  question: string;
  pick: string;
  confidence: number;
  winner: string;
  win: boolean;
  brier: number;
  market: number | null;
  brierMarket: number | null;
  at: string;
}

/** Written to a forecaster's own namespace when their pick resolves: the record they can't delete. */
export function resultText(r: ResultMemory): string {
  const vs = r.brierMarket === null ? '' : ` Market said ${pct(r.market!)} for the same side; my Brier ${f3(r.brier)} vs the market's ${f3(r.brierMarket)}.`;
  return [
    `${r.display} ${r.win ? 'called it' : 'missed'} · ${r.category} · "${r.question}" · picked "${r.pick}" at ${pct(r.confidence)}; it resolved "${r.winner}".${vs}`,
    `meta: kind=result handle=${r.handle} sub=${r.id} market=${r.marketId} category=${r.category} win=${r.win ? 1 : 0} at=${r.at}`,
  ].join('\n');
}

export interface PostmortemMemory {
  lessonId: number;
  marketId: string;
  category: string;
  question: string;
  winner: string;
  right: number;
  wrong: number;
  rightBecause: string;
  wrongBecause: string;
  lesson: string;
  resolvedAt: string;
}

/** What 0xkafka learned from the agents on one resolved question. Recalled by meaning before later predictions. */
export function postmortemText(p: PostmortemMemory): string {
  return [
    `0xkafka lesson L${p.lessonId} · ${p.category} · from agents on "${p.question}" (resolved ${p.winner}; ${p.right} right, ${p.wrong} wrong).`,
    `Lesson: ${p.lesson}`,
    p.right ? `Right because: ${p.rightBecause}` : '',
    p.wrong ? `Wrong because: ${p.wrongBecause}` : '',
    `meta: kind=postmortem lesson=${p.lessonId} market=${p.marketId} category=${p.category} resolved=${p.resolvedAt}`,
  ]
    .filter(Boolean)
    .join('\n');
}
