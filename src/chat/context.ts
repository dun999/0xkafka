import { profileNs, nsName } from '../config';
import { badgesOf } from '../picks/badges';
import { db } from '../db/client';
import { agentLines, kafkaLine } from '../agents/views';
import { CATEGORIES } from '../markets/categories';
import { recall, type RecallHit } from '../memory/walrus';
import { insightsFor } from '../agents/insights';
import { assistantLessons, KIND_LABEL } from '../assistant/lessons';
import { dossierOf } from '../picks/dossier';
import { record } from '../views';

// What the chat assistant may know. The public part: resolved questions, 0xkafka's
// record, the leaderboard, and open questions as titles and times. Hidden signals and
// hidden predictions are never read here, so no prompt can get them out. Signed in,
// the person's own file and their assistant's own lessons about them. 0xkafka's
// forecasting lessons are not part of the chat: those belong to 0xkafka's signal.

const pct = (p: number | null | undefined) => (p === null || p === undefined ? '?' : `${Math.round(p * 100)}%`);
const f3 = (x: number | null | undefined) => (x === null || x === undefined ? '?' : x.toFixed(3));

/** A recalled memory, unless it is a sealed submission. */
function publicHit(h: RecallHit): boolean {
  if (h.meta.kind !== 'submission') return true;
  const s = db().prepare('SELECT status FROM submissions WHERE id = ?').get(h.meta.sub ?? '') as { status: string } | undefined;
  return !!s && s.status !== 'open';
}

/** A Walrus memory the model was given, so the answer can show where it came from. */
export interface Source {
  blob: string;
  /** The Walrus namespace it lives in. */
  ns: string;
  /** forecast, outcome, lesson, submission, result, insight, note… */
  kind: string;
  /** One line saying what it is. */
  label: string;
  /** What it is about, e.g. the question. */
  title: string;
  /** What it says, e.g. "Picked Yes at 65%" or "Resolved: Lakers". */
  detail: string;
  /** Whose memory: '0xkafka' or a forecaster's handle. */
  owner: string;
  /** Recalled by meaning for this very message (not just part of the standing context). */
  recalled?: boolean;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** A memory's first line ("anakin prediction · sports · "Q" · picked …") as a title and a detail. */
export function describeMemory(text: string): { title: string; detail: string } {
  const lines = text.split('\n');
  const first = lines[0];
  const q = /"([^"]+)"/.exec(first)?.[1] ?? null;
  const lesson = lines.find((l) => l.startsWith('Lesson: '))?.slice(8);
  const mine = /^\S+ assistant lesson (A\d+)/.exec(first);
  if (mine && lesson) return { title: lesson, detail: `Your assistant's lesson ${mine[1]}` };
  if (/^\S+ lesson /.test(first) && lesson) return { title: lesson, detail: q ? `Lesson from "${q}"` : 'Lesson' };
  if (q) {
    const after = first.slice(first.indexOf(`"${q}"`) + q.length + 2).replace(/^\s*·\s*/, '').replace(/\.$/, '').trim();
    return { title: q, detail: cap(after.replace(/^resolved:\s*/i, 'resolved: ')) };
  }
  const parts = first.split(' · ');
  const next = lines.slice(1).find((l) => l.trim() && !l.startsWith('meta:') && !l.startsWith('policy:')) ?? '';
  return { title: parts.slice(1).join(' · ') || first, detail: next.slice(0, 120) };
}

const ownerOf = (ns: string) => /\.profile\.([^.]+)$/.exec(ns)?.[1] ?? '0xkafka';

const clean = (text: string) =>
  text
    .split('\n')
    .filter((l) => !l.startsWith('meta:') && !l.startsWith('policy:'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const memoryLine = (ns: string, h: RecallHit) => `[blob:${h.blob_id}] (${ns}) ${clean(h.text).slice(0, 700)}`;

const NS_KIND: Record<string, string> = { outcomes: 'outcome', lessons: 'lesson', forecasts: 'forecast', mind: 'mind', signals: 'forecast' };
const kindOf = (ns: string, h: RecallHit) => h.meta.kind ?? NS_KIND[ns.split('.').at(-1) ?? ''] ?? 'memory';

const hitSource = (ns: string, h: RecallHit): Source => ({
  blob: h.blob_id,
  ns,
  kind: kindOf(ns, h),
  label: clean(h.text).slice(0, 110),
  ...describeMemory(h.text),
  owner: ownerOf(ns),
  recalled: true,
});

export function publicSnapshot(): string {
  const d = db();
  const rec = record({ mode: 'live' });
  const replay = record({ mode: 'backtest' });
  const kafka = kafkaLine();
  const lines: string[] = [];

  lines.push("0XKAFKA'S RECORD (the house forecaster whose signal is for sale; mean Brier, lower is better; n = resolved questions)");
  lines.push(`Live: n ${rec.all.n}, 0xkafka ${f3(rec.all.kafka)}, Blank ${f3(rec.all.blank)}, market ${f3(rec.all.market)}.`);
  lines.push(`Replay (walk-forward over already-resolved questions): n ${replay.all.n}, 0xkafka ${f3(replay.all.kafka)}, Blank ${f3(replay.all.blank)}, market ${f3(replay.all.market)}.`);
  for (const c of CATEGORIES) {
    const r = replay[c];
    if (r.n) lines.push(`  ${c} (replay): n ${r.n}, 0xkafka ${f3(r.kafka)}, market ${f3(r.market)}.`);
  }
  lines.push(`0xkafka's live signals, scored like everyone's predictions: n ${kafka.n}, win rate ${pct(kafka.winRate)}, Brier ${f3(kafka.brier)}, reputation ${kafka.reputation}.`);

  lines.push('\nLEADERBOARD (agents; reputation = skill vs the market, shrunk; model and harness self-reported)');
  const top = agentLines().slice(0, 12);
  for (const a of top) {
    lines.push(
      `${a.display} (${a.namespace}): reputation ${a.reputation}, win rate ${pct(a.winRate)} over ${a.n} resolved, ${a.submissions} predictions, best at ${a.best_category ?? '—'}, ${a.harness ?? '?'} · ${a.model ?? '?'}, ${a.walrus.memories} memories in ${a.walrus.namespace}.`,
    );
  }
  if (!top.length) lines.push('No agents yet.');

  const resolved = d
    .prepare(
      `SELECT m.id, m.question, m.category, m.outcome, m.outcome_a, m.outcome_b, f.final_p, f.market_p, f.blank_p, s.brier_final, s.brier_market, f.mode
       FROM scores s JOIN forecasts f ON f.id = s.forecast_id JOIN markets m ON m.id = s.market_id
       ORDER BY s.resolved_at DESC LIMIT 15`,
    )
    .all() as { id: string; question: string; category: string; outcome: number; outcome_a: string; outcome_b: string; final_p: number; market_p: number; blank_p: number; brier_final: number; brier_market: number; mode: string }[];
  lines.push('\nRECENTLY RESOLVED (public)');
  for (const r of resolved) {
    lines.push(
      `#${r.id} ${r.category} "${r.question}" → ${r.outcome ? r.outcome_a : r.outcome_b}. 0xkafka gave "${r.outcome_a}" ${pct(r.final_p)} (Brier ${f3(r.brier_final)}), market ${pct(r.market_p)} (${f3(r.brier_market)}), Blank ${pct(r.blank_p)}. ${r.mode === 'backtest' ? '(replay)' : ''}`,
    );
  }

  const open = d
    .prepare(
      `SELECT m.id, m.question, m.event_title, m.category, m.price, COALESCE(m.start_time, m.end_date) decides,
         (SELECT COUNT(*) FROM submissions x WHERE x.market_id = m.id) subs,
         EXISTS (SELECT 1 FROM forecasts g WHERE g.market_id = m.id AND g.mode = 'live') locked
       FROM markets m WHERE m.status IN ('open','closed') AND m.source IN ('live','demand') ORDER BY decides LIMIT 25`,
    )
    .all() as { id: string; question: string; event_title: string | null; category: string; price: number | null; decides: string; subs: number; locked: number }[];
  lines.push('\nOPEN QUESTIONS (0xkafka has a sealed forecast; its numbers are NOT known to you)');
  for (const o of open) {
    lines.push(
      `#${o.id} ${o.category} ${o.event_title && o.event_title !== o.question ? `${o.event_title}: ` : ''}"${o.question}", decides ${o.decides}, Polymarket price ${pct(o.price)}, ${o.subs} agent submissions, ${o.locked ? '0xkafka has made its call' : 'no call yet'}.`,
    );
  }
  return lines.join('\n');
}

export interface Asker {
  handle: string;
  address: string;
}

/**
 * The signed-in person's own file: record, verdicts, insights, and their own sealed
 * picks. Only ever built for the owner, so it may hold what's still sealed to others.
 * Every line that comes from a Walrus memory carries its [blob:ID] tag.
 */
export function personalSnapshot(me: Asker): string | null {
  return personalFile(me)?.text ?? null;
}

export function personalFile(me: Asker): { text: string; sources: Source[] } | null {
  const d = dossierOf(me.handle, { handle: me.handle, address: me.address });
  if (!d) return null;
  const r = d.record;
  const ns = d.profile.walrus_namespace;
  const lines: string[] = [];
  const sources: Source[] = [];
  const tag = (blob: string | null, kind: string, title: string, detail: string) => {
    if (!blob) return '';
    sources.push({ blob, ns, kind, label: `${title} · ${detail}`.slice(0, 110), title, detail, owner: me.handle });
    return ` [blob:${blob}]`;
  };
  lines.push(`${d.profile.display} (@${d.profile.handle}), ${d.profile.kind === 'human' ? 'a person' : 'an agent'}, signed in with their Sui wallet. Walrus namespace ${d.profile.walrus_namespace}.`);
  const { badges, streak } = badgesOf(me.handle, me.address);
  lines.push(
    `Record: ${d.sealed.length + d.archive.length} predictions, ${r.wins} won of ${r.n} resolved (win rate ${pct(r.winRate)}), skill vs the market ${r.reputation}${d.rank ? `, #${d.rank} on the leaderboard` : ''}. Predictions copied from a bought 0xkafka signal aren't counted.`,
  );
  const c = d.calibration;
  lines.push(`Calibration: ${c.verdict}${c.says === null ? '' : ` (says ${pct(c.says)} on average, right ${pct(c.hits)})`}. Results streak: ${d.streak ? `${d.streak.n} ${d.streak.kind} in a row` : 'none'}.`);
  lines.push(
    `Daily streak: ${streak.current} day${streak.current === 1 ? '' : 's'} (best ${streak.best})${streak.current && !streak.activeToday ? ', not active yet today' : ''}. Badges earned: ${badges.filter((b) => b.done).map((b) => b.name).join(', ') || 'none yet'}. Closest next: ${badges.filter((b) => !b.done).sort((a, b) => b.progress / b.goal - a.progress / a.goal).slice(0, 2).map((b) => `${b.name} (${b.how}, ${b.progress}/${b.goal})`).join('; ') || 'all earned'}.`,
  );
  const ins = insightsFor(me.handle);
  lines.push(`Insights from their resolved picks: ${ins.length ? ins.slice(0, 5).map((i) => i.text).join(' ') : 'not enough resolved picks yet.'}`);
  lines.push('Their open predictions (hidden from everyone else until predictions close; you may discuss these with them):');
  for (const l of d.sealed.slice(0, 10)) {
    const p = l.prediction;
    lines.push(
      `  #${l.market_id} "${l.question}": ${p ? `${p.pick} at ${pct(p.confidence)}` : 'sealed'}, sealed ${l.submitted_at}.${tag(l.walrus.blob, 'submission', l.question, p ? `Your pick: ${p.pick} at ${pct(p.confidence)}` : 'Your sealed pick')}`,
    );
  }
  if (!d.sealed.length) lines.push('  none.');
  lines.push('Their latest results:');
  for (const l of d.archive.slice(0, 10)) {
    const p = l.prediction;
    lines.push(
      `  "${l.question}": ${p ? `${p.pick} at ${pct(p.confidence)}` : '?'} → ${l.result ? (l.result.win ? 'called it' : 'missed') : l.status === 'void' ? 'voided, not scored' : l.status}.${tag(l.walrus.blob, l.result ? 'result' : 'submission', l.question, `Your pick: ${p ? `${p.pick} at ${pct(p.confidence)}` : '?'}${l.result ? (l.result.win ? ', called it' : ', missed') : l.status === 'void' ? ', voided' : ''}`)}`,
    );
  }
  if (!d.archive.length) lines.push('  none yet.');
  const own = assistantLessons(me.handle);
  lines.push(
    `YOUR OWN LESSONS ABOUT THEM (v${own.version}; you learned these from their memory, and they are yours, not 0xkafka's). Use them: warn where they lose, back them where they do well, match what they care about.`,
  );
  for (const l of own.active) lines.push(`  A${l.n} (${KIND_LABEL[l.kind]}): ${l.statement} Evidence: ${l.evidence}${tag(l.blob, 'lesson', l.statement, `Your assistant's lesson A${l.n}`)}`);
  if (!own.active.length) lines.push('  none yet: you learn them as their memory grows.');
  for (const l of own.earlier.slice(0, 3)) lines.push(`  You used to hold A${l.n}: ${l.statement} Dropped: ${l.reason}`);
  lines.push('Their Walrus memory, newest first:');
  for (const m of d.remembered.filter((m) => m.kind !== 'assistant_lesson').slice(0, 8)) {
    const x = describeMemory(m.text);
    lines.push(`  ${m.kind}, ${m.at}: ${m.text.slice(0, 240)}${tag(m.blob, m.kind, x.title, x.detail)}`);
  }
  if (!d.remembered.length) lines.push('  nothing yet.');
  return { text: lines.join('\n'), sources };
}

/** A question about the asker themselves ("my latest prediction", "how am I doing"). */
export const aboutMe = (message: string) => /\b(my|me|mine|myself|i|i'm|im|i've|ive|am i)\b/i.test(message);

/**
 * Memories recalled from Walrus for this message, only where they fit the question:
 * a question about the signed-in asker recalls their own memory; anything else also
 * recalls resolved results. Any forecaster the message names is recalled too.
 * 0xkafka's forecasting lessons are never recalled into a chat.
 */
export async function recalledFor(message: string, me?: Asker | null): Promise<string[]> {
  return (await recall_(message, me)).lines;
}

export async function recall_(message: string, me?: Asker | null): Promise<{ lines: string[]; sources: Source[] }> {
  const handles = (db().prepare('SELECT handle FROM agents').all() as { handle: string }[])
    .map((a) => a.handle)
    .filter((h) => h !== me?.handle && new RegExp(`\\b${h.replace(/[-_]/g, '[-_ ]?')}\\b`, 'i').test(message))
    .slice(0, 2);
  const personal = !!me && aboutMe(message);
  const none = Promise.resolve([] as RecallHit[]);
  const [outcomes, mine, ...agents] = await Promise.all([
    personal ? none : recall('outcomes', message, { limit: 4, maxDistance: 0.7 }),
    me ? recall(profileNs(me.handle), message, { limit: 6, maxDistance: 0.85 }) : Promise.resolve([] as RecallHit[]),
    ...handles.map((h) => recall(profileNs(h), message, { limit: 4, maxDistance: 0.8 })),
  ]);
  const groups: [string, RecallHit[]][] = [
    [nsName('outcomes'), outcomes],
    // Their own memory, sealed picks included: only ever recalled for its owner.
    ...(me ? ([[nsName(profileNs(me.handle)), mine]] as [string, RecallHit[]][]) : []),
    ...agents.map((hits, i) => [nsName(profileNs(handles[i])), hits.filter(publicHit)] as [string, RecallHit[]]),
  ];
  return {
    lines: groups.flatMap(([ns, hits]) => hits.map((h) => memoryLine(ns, h))),
    sources: groups.flatMap(([ns, hits]) => hits.map((h) => hitSource(ns, h))),
  };
}
