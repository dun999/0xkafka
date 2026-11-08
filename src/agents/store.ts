import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '../db/client';

// Forecasters. An agent's handle is a namespace claimed with a passcode, like a
// Yukon solver handle: the first submission claims it, later ones must match.
// A person signs in with a Sui wallet and picks a handle once.

export interface AgentRow {
  handle: string;
  display: string;
  pass_hash: string;
  sui_address: string | null;
  created_at: string;
  created_ip: string | null;
  locked_until: string | null;
  kind: 'agent' | 'human';
  bio: string | null;
  /** What unlocking one of their sealed picks costs, in USDC micro-units. */
  price_micro: number;
}

export const DEFAULT_PRICE_MICRO = 100; // 0.0001 USDC
export const MIN_PRICE_MICRO = 100; // 0.0001 USDC
export const MAX_PRICE_MICRO = 5_000_000; // 5 USDC

export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/;
/** Handles 0xkafka keeps for itself and its controls. */
const RESERVED = new Set(['0xkafka', 'kafka', 'blank', 'market', 'crowd', 'signal', 'admin', 'api', 'system', 'anonymous']);

/** "Dun" → "dun"; "My Agent" → "my-agent". Null if it can't be a handle. */
export function toHandle(namespace: string): string | null {
  const h = namespace.trim().toLowerCase().replace(/\s+/g, '-');
  return HANDLE_RE.test(h) && !RESERVED.has(h) ? h : null;
}

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, 32, SCRYPT);
  return ['s1', salt.toString('base64'), hash.toString('base64')].join('$');
}

export function checkPasscode(passcode: string, stored: string): boolean {
  if (!stored) return false; // wallet profiles have no passcode
  const [v, salt, hash] = stored.split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(passcode, Buffer.from(salt, 'base64'), want.length, SCRYPT);
  return timingSafeEqual(want, got);
}

// ---------- rate limits ----------

/** Record an event in `bucket` if fewer than `limit` happened in the window. False means over the limit. */
export function rateHit(bucket: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const d = db();
  if (rateCount(bucket, windowMs, now) >= limit) return false;
  d.prepare('INSERT INTO rate_events (bucket, at) VALUES (?, ?)').run(bucket, now);
  if (Math.random() < 0.02) d.prepare('DELETE FROM rate_events WHERE at < ?').run(now - 2 * 86_400_000);
  return true;
}

export const rateCount = (bucket: string, windowMs: number, now = Date.now()) =>
  (db().prepare('SELECT COUNT(*) n FROM rate_events WHERE bucket = ? AND at > ?').get(bucket, now - windowMs) as { n: number }).n;

// ---------- identity ----------

const HOUR = 3_600_000;
export const MAX_BAD_PASSCODES = 10;
export const NEW_NAMESPACES_PER_IP = 3;

export class AgentError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getAgent(handle: string): AgentRow | undefined {
  return db().prepare('SELECT * FROM agents WHERE handle = ?').get(handle) as AgentRow | undefined;
}

/**
 * Sign in as a namespace, claiming it if it is new.
 * Ten wrong passcodes within an hour lock the namespace for an hour.
 */
export function signIn(
  namespace: string,
  passcode: string,
  ip: string,
  now = new Date(),
  opts: { create?: boolean } = {},
): { agent: AgentRow; created: boolean } {
  const handle = toHandle(namespace);
  if (!handle) throw new AgentError(400, 'namespace must be 2–24 letters, digits, "-" or "_" (e.g. "Dun"), and not a reserved name');
  if (passcode.length < 4) throw new AgentError(400, 'passcode must be at least 4 characters');
  const d = db();
  const agent = getAgent(handle);

  if (!agent) {
    if (opts.create === false) throw new AgentError(404, `No namespace "${namespace}" yet. It is claimed by its first submission.`);
    if (!rateHit(`ns-new:${ip}`, NEW_NAMESPACES_PER_IP, 24 * HOUR, now.getTime())) {
      throw new AgentError(429, `At most ${NEW_NAMESPACES_PER_IP} new namespaces per day from one address`);
    }
    const row: AgentRow = {
      handle,
      display: namespace.trim().slice(0, 24),
      pass_hash: hashPasscode(passcode),
      sui_address: null,
      created_at: now.toISOString(),
      created_ip: ip,
      locked_until: null,
      kind: 'agent',
      bio: null,
      price_micro: DEFAULT_PRICE_MICRO,
    };
    insertProfile(row);
    return { agent: row, created: true };
  }
  if (agent.kind === 'human') throw new AgentError(401, `"${agent.display}" belongs to a person who signs in with a wallet, not a passcode.`);

  if (agent.locked_until && agent.locked_until > now.toISOString()) {
    throw new AgentError(423, `Namespace "${agent.display}" is locked after too many wrong passcodes, until ${agent.locked_until}`);
  }
  if (!checkPasscode(passcode, agent.pass_hash)) {
    if (!rateHit(`bad-pass:${handle}`, MAX_BAD_PASSCODES - 1, HOUR, now.getTime())) {
      const until = new Date(now.getTime() + HOUR).toISOString();
      d.prepare('UPDATE agents SET locked_until = ? WHERE handle = ?').run(until, handle);
      throw new AgentError(423, `Too many wrong passcodes. Namespace "${agent.display}" is locked until ${until}`);
    }
    throw new AgentError(401, `Wrong passcode for namespace "${agent.display}". A namespace belongs to whoever submitted under it first.`);
  }
  return { agent, created: false };
}

function insertProfile(row: AgentRow) {
  db()
    .prepare(
      `INSERT INTO agents (handle, display, pass_hash, sui_address, created_at, created_ip, locked_until, kind, bio, price_micro)
       VALUES (@handle, @display, @pass_hash, @sui_address, @created_at, @created_ip, @locked_until, @kind, @bio, @price_micro)`,
    )
    .run(row);
}

// ---------- people (wallet sign-in) ----------

export const profileByAddress = (address: string) =>
  db().prepare(`SELECT * FROM agents WHERE kind = 'human' AND sui_address = ?`).get(address.toLowerCase()) as AgentRow | undefined;

/** A signed-in wallet picks its handle once. The handle is also its Walrus namespace. */
export function createHumanProfile(address: string, name: string, ip: string, now = new Date()): AgentRow {
  if (profileByAddress(address)) throw new AgentError(409, 'This wallet already has a profile.');
  const handle = toHandle(name);
  if (!handle) throw new AgentError(400, 'A handle is 2–24 letters, digits, "-" or "_", and not a reserved name.');
  if (getAgent(handle)) throw new AgentError(409, `"${handle}" is taken. Try another.`);
  if (!rateHit(`ns-new:${ip}`, NEW_NAMESPACES_PER_IP, 24 * HOUR, now.getTime())) {
    throw new AgentError(429, `At most ${NEW_NAMESPACES_PER_IP} new profiles per day from one address`);
  }
  const row: AgentRow = {
    handle,
    display: name.trim().slice(0, 24),
    pass_hash: '',
    sui_address: address.toLowerCase(),
    created_at: now.toISOString(),
    created_ip: ip,
    locked_until: null,
    kind: 'human',
    bio: null,
    price_micro: DEFAULT_PRICE_MICRO,
  };
  insertProfile(row);
  return row;
}

export function updateProfile(handle: string, patch: { bio?: string | null; price_micro?: number }) {
  if (patch.price_micro !== undefined) {
    if (!Number.isInteger(patch.price_micro) || patch.price_micro < MIN_PRICE_MICRO || patch.price_micro > MAX_PRICE_MICRO) {
      throw new AgentError(400, `Price must be between ${MIN_PRICE_MICRO / 1e6} and ${MAX_PRICE_MICRO / 1e6} USDC`);
    }
    db().prepare('UPDATE agents SET price_micro = ? WHERE handle = ?').run(patch.price_micro, handle);
  }
  if (patch.bio !== undefined) db().prepare('UPDATE agents SET bio = ? WHERE handle = ?').run(patch.bio?.trim().slice(0, 160) || null, handle);
}

export const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

export function setSuiAddress(handle: string, address: string) {
  if (!SUI_ADDRESS_RE.test(address)) throw new AgentError(400, 'sui_address must be a 0x-prefixed, 64-hex-digit Sui address');
  db().prepare('UPDATE agents SET sui_address = ? WHERE handle = ?').run(address.toLowerCase(), handle);
}

/** The caller's address for rate limits: first hop of X-Forwarded-For (set by our proxy), else a fixed bucket. */
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'direct';
}
