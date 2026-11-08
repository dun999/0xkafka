import { MemWal, MemWalMock } from '@mysten-incubation/memwal';
import { config, nsName, NAMESPACES, type MemNamespace } from '../config';
import { bump, db, logActivity, nowIso } from '../db/client';
import { parseMeta } from './format';

// Walrus Memory is 0xkafka's memory. Writes go through an outbox in SQLite so a
// slow relayer or a restart never loses one, and an idempotency key means a
// retry never writes one twice.

type Client = MemWal | MemWalMock;
const g = globalThis as unknown as { __memwal?: Client };

export const isMock = () => config.memwal.mock;

export function memwal(): Client {
  if (g.__memwal) return g.__memwal;
  if (!isMock() && (!config.memwal.key || !config.memwal.accountId)) throw new Error('MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID are required (Walrus Memory, mainnet)');
  const client: Client = isMock()
    ? MemWalMock.create({ namespace: nsName('forecasts') })
    : MemWal.create({
        key: config.memwal.key!,
        accountId: config.memwal.accountId!,
        serverUrl: config.memwal.serverUrl,
        namespace: nsName('forecasts'),
        recallTimeoutMs: 30_000,
      });
  g.__memwal = client;
  return client;
}

export function walruscanBlob(blobId: string) {
  return `https://walruscan.com/mainnet/blob/${blobId}`;
}

/** Queue a memory. Returns the outbox id; an existing id for the same key is reused. */
export function enqueueMemory(ns: MemNamespace, text: string, idem: string): number {
  const d = db();
  const key = `${config.ns}:${idem}`;
  d.prepare(
    `INSERT INTO memories (namespace, text, idem, mock, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(idem) DO NOTHING`,
  ).run(nsName(ns), text, key, isMock() ? 1 : 0, nowIso());
  return (d.prepare('SELECT id FROM memories WHERE idem = ?').get(key) as { id: number }).id;
}

interface MemRow {
  id: number;
  namespace: string;
  text: string;
  idem: string;
  status: string;
  job_id: string | null;
  attempts: number;
}

const MAX_IN_FLIGHT = Number(process.env.WALRUS_IN_FLIGHT ?? 8);

/** One pass over the outbox: submit pending writes, then poll submitted jobs. */
export async function drainOnce(): Promise<{ submitted: number; done: number; failed: number }> {
  const d = db();
  const client = memwal();
  let submitted = 0;
  let done = 0;
  let failed = 0;

  const inFlight = (d.prepare(`SELECT COUNT(*) n FROM memories WHERE status = 'submitted'`).get() as { n: number }).n;
  const pending = d
    .prepare(`SELECT * FROM memories WHERE status = 'pending' AND attempts < 6 ORDER BY id LIMIT ?`)
    .all(Math.max(0, MAX_IN_FLIGHT - inFlight)) as MemRow[];

  for (const m of pending) {
    try {
      const r = await client.rememberAsync(m.text, m.namespace, { idempotencyKey: m.idem });
      d.prepare(`UPDATE memories SET status = 'submitted', job_id = ?, attempts = attempts + 1 WHERE id = ?`).run(r.job_id, m.id);
      submitted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      d.prepare(`UPDATE memories SET attempts = attempts + 1, error = ? WHERE id = ?`).run(msg.slice(0, 300), m.id);
      if (/429|rate/i.test(msg)) break;
    }
  }

  const waiting = d.prepare(`SELECT * FROM memories WHERE status = 'submitted' ORDER BY id LIMIT 40`).all() as MemRow[];
  for (const m of waiting) {
    try {
      const s = await client.getRememberStatus(m.job_id!);
      if (s.status === 'done' && s.blob_id) {
        d.prepare(`UPDATE memories SET status = 'done', blob_id = ?, done_at = ?, error = NULL WHERE id = ?`).run(s.blob_id, nowIso(), m.id);
        bump('walrus.writes');
        logActivity('memory', `Stored in ${m.namespace}`, s.blob_id);
        done++;
      } else if (s.status === 'failed' || s.status === 'not_found') {
        d.prepare(`UPDATE memories SET status = ?, error = ? WHERE id = ?`).run(
          m.attempts >= 6 ? 'failed' : 'pending',
          (s.error ?? s.status).slice(0, 300),
          m.id,
        );
        failed++;
      }
    } catch (e) {
      d.prepare(`UPDATE memories SET error = ? WHERE id = ?`).run(String(e).slice(0, 300), m.id);
    }
  }
  return { submitted, done, failed };
}

/** Drain until nothing is pending or submitted. Used by the backtest between days. */
export async function flushMemories(timeoutMs = 10 * 60_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    await drainOnce();
    const left = (db().prepare(`SELECT COUNT(*) n FROM memories WHERE status IN ('pending','submitted') AND attempts < 6`).get() as { n: number }).n;
    if (left === 0) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Walrus outbox still has ${left} writes after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, isMock() ? 10 : 2500));
  }
}

export interface RecallHit {
  blob_id: string;
  text: string;
  distance: number;
  created_at?: string;
  meta: Record<string, string>;
}

export async function recall(
  ns: MemNamespace,
  query: string,
  opts: { limit?: number; maxDistance?: number; sort?: 'relevance' | 'recent' } = {},
): Promise<RecallHit[]> {
  try {
    const r = await memwal().recall({
      query,
      namespace: nsName(ns),
      limit: opts.limit ?? 5,
      maxDistance: opts.maxDistance,
      sort: opts.sort,
    });
    bump('walrus.recalls');
    return r.results.map((x) => ({ ...x, meta: parseMeta(x.text) }));
  } catch (e) {
    logActivity('error', `Recall from ${nsName(ns)} failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

export function blobOf(memoryId: number | null | undefined): string | null {
  if (!memoryId) return null;
  const r = db().prepare('SELECT blob_id FROM memories WHERE id = ?').get(memoryId) as { blob_id: string | null } | undefined;
  return r?.blob_id ?? null;
}

export function outboxCounts() {
  const rows = db()
    .prepare(`SELECT namespace, status, COUNT(*) n FROM memories GROUP BY namespace, status`)
    .all() as { namespace: string; status: string; n: number }[];
  const out: Record<string, { done: number; queued: number; failed: number }> = {};
  for (const n of NAMESPACES) out[nsName(n)] = { done: 0, queued: 0, failed: 0 };
  for (const r of rows) {
    const o = (out[r.namespace] ??= { done: 0, queued: 0, failed: 0 });
    if (r.status === 'done') o.done += r.n;
    else if (r.status === 'failed') o.failed += r.n;
    else o.queued += r.n;
  }
  return out;
}

/** Live counts from the relayer, for the Proof panel. */
export async function relayerCounts(): Promise<Record<string, number> | null> {
  if (isMock()) return null;
  try {
    const r = await memwal().listNamespaces({ limit: 100 });
    const out: Record<string, number> = {};
    for (const n of r.namespaces) if (n.name.startsWith(`${config.ns}.`)) out[n.name] = n.memory_count;
    return out;
  } catch {
    return null;
  }
}
