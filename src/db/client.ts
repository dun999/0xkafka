import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

// SQLite is a cache and a work queue. Every row that mirrors a memory keeps
// the outbox id, and the outbox row keeps the Walrus blob id.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  event_slug TEXT,
  event_title TEXT,
  question TEXT NOT NULL,
  rules TEXT,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  outcome_a TEXT NOT NULL,
  outcome_b TEXT NOT NULL,
  yes_token TEXT,
  end_date TEXT,
  start_time TEXT,
  volume REAL,
  image TEXT,
  price REAL,
  price_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  outcome INTEGER,
  closed_at TEXT,
  source TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS markets_status ON markets(status);

CREATE TABLE IF NOT EXISTS forecasts (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  mode TEXT NOT NULL,
  made_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mind_version INTEGER NOT NULL,
  market_p REAL NOT NULL,
  blank_raw REAL,
  blank_p REAL,
  raw_p REAL NOT NULL,
  trust REAL NOT NULL,
  blend_p REAL NOT NULL,
  calib REAL NOT NULL,
  final_p REAL NOT NULL,
  reason TEXT NOT NULL,
  blank_reason TEXT,
  recalled TEXT NOT NULL DEFAULT '[]',
  context TEXT,
  model TEXT,
  memory_id INTEGER,
  agents TEXT NOT NULL DEFAULT '[]',
  lessons_used TEXT NOT NULL DEFAULT '[]',
  UNIQUE(market_id, mode)
);

CREATE TABLE IF NOT EXISTS scores (
  forecast_id TEXT PRIMARY KEY REFERENCES forecasts(id),
  market_id TEXT NOT NULL,
  category TEXT NOT NULL,
  mode TEXT NOT NULL,
  outcome INTEGER NOT NULL,
  resolved_at TEXT NOT NULL,
  brier_final REAL NOT NULL,
  brier_raw REAL NOT NULL,
  brier_blank REAL,
  brier_market REAL NOT NULL,
  memory_id INTEGER,
  scored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  category TEXT,
  statement TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  born_version INTEGER NOT NULL,
  retired_version INTEGER,
  retired_reason TEXT,
  created_at TEXT NOT NULL,
  memory_id INTEGER
);

CREATE TABLE IF NOT EXISTS minds (
  version INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  sim_time TEXT NOT NULL,
  policy TEXT NOT NULL,
  diff TEXT NOT NULL,
  n_scored INTEGER NOT NULL,
  stats TEXT NOT NULL DEFAULT '{}',
  memory_id INTEGER
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  text TEXT NOT NULL,
  idem TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  job_id TEXT,
  blob_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  mock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS memories_status ON memories(status);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  payer TEXT,
  amount TEXT NOT NULL,
  protocol TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  market_id TEXT
);

CREATE TABLE IF NOT EXISTS used_digests (
  digest TEXT PRIMARY KEY,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  ref TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Forecasters. An agent claims its handle with a passcode (pass_hash); a person
-- signs in with a Sui wallet (kind 'human', pass_hash '', sui_address set).
-- price_micro is what unlocking one of their sealed picks costs, in USDC micro-units.
CREATE TABLE IF NOT EXISTS agents (
  handle TEXT PRIMARY KEY,
  display TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  sui_address TEXT,
  created_at TEXT NOT NULL,
  created_ip TEXT,
  locked_until TEXT,
  kind TEXT NOT NULL DEFAULT 'agent',
  bio TEXT,
  price_micro INTEGER NOT NULL DEFAULT 100
);

-- One sealed prediction per agent per question. "canonical" is the exact JSON
-- whose sha256 is "commitment"; both are revealed when the question resolves.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL REFERENCES agents(handle),
  market_id TEXT NOT NULL REFERENCES markets(id),
  category TEXT NOT NULL,
  pick TEXT NOT NULL,
  pick_a INTEGER NOT NULL,
  confidence REAL NOT NULL,
  p_a REAL NOT NULL,
  claim TEXT,
  reasons TEXT NOT NULL,
  analytics TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  model_key TEXT NOT NULL,
  harness TEXT NOT NULL,
  effort TEXT,
  market_p REAL,
  commitment TEXT NOT NULL,
  canonical TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  memory_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  outcome INTEGER,
  win INTEGER,
  brier REAL,
  brier_market REAL,
  scored_at TEXT,
  scored_memory_id INTEGER,
  UNIQUE(handle, market_id)
);
CREATE INDEX IF NOT EXISTS submissions_market ON submissions(market_id);
CREATE INDEX IF NOT EXISTS submissions_handle ON submissions(handle);

-- The 0xkafka signal: committed at lock, sold until the question resolves.
-- Each signal sale credits agents by their weight in that signal.
CREATE TABLE IF NOT EXISTS earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_digest TEXT NOT NULL,
  handle TEXT NOT NULL,
  market_id TEXT NOT NULL,
  micro INTEGER NOT NULL,
  at TEXT NOT NULL,
  payout_id INTEGER,
  UNIQUE(sale_digest, handle)
);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  digest TEXT,
  status TEXT NOT NULL,
  total_micro INTEGER NOT NULL,
  recipients TEXT NOT NULL,
  error TEXT
);

-- A buyer unlocked a sealed pick between lock and resolution, paying its author directly.
CREATE TABLE IF NOT EXISTS unlocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  seller TEXT NOT NULL,
  buyer TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  micro INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unlocks_buyer ON unlocks(buyer, submission_id);
CREATE INDEX IF NOT EXISTS unlocks_seller ON unlocks(seller);

-- What 0xkafka remembers about a forecaster: facts from chat and insights from
-- their record. Each is also a memory in their Walrus namespace.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL REFERENCES agents(handle),
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  memory_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(handle, kind, key)
);

-- Sliding-window rate limits (submissions, new namespaces, wrong passcodes, chat).
CREATE TABLE IF NOT EXISTS rate_events (
  bucket TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_bucket ON rate_events(bucket, at);
`;

const g = globalThis as unknown as { __kafkaDb?: Database.Database };

export function db(): Database.Database {
  if (g.__kafkaDb) return g.__kafkaDb;
  const file = path.resolve(config.dbPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.pragma('busy_timeout = 5000');
  d.pragma('foreign_keys = ON');
  d.exec(SCHEMA);
  migrate(d);
  g.__kafkaDb = d;
  return d;
}

/**
 * Bring an older database up to the current schema. Live predictions have no
 * Blank control, so those columns became nullable; predictions record the agents
 * and lessons they used; agent submissions are public, so "sealed/revealed"
 * became "open/scored".
 */
function migrate(d: Database.Database) {
  const cols = d.prepare('PRAGMA table_info(forecasts)').all() as { name: string; notnull: number }[];
  if (cols.find((c) => c.name === 'blank_raw')?.notnull) {
    const keep = cols.map((c) => c.name).join(', ');
    const scoreCols = (d.prepare('PRAGMA table_info(scores)').all() as { name: string }[]).map((c) => c.name).join(', ');
    d.pragma('foreign_keys = OFF');
    d.transaction(() => {
      d.exec('ALTER TABLE forecasts RENAME TO forecasts_old; ALTER TABLE scores RENAME TO scores_old;');
      d.exec(SCHEMA);
      d.exec(`INSERT INTO forecasts (${keep}) SELECT ${keep} FROM forecasts_old; INSERT INTO scores (${scoreCols}) SELECT ${scoreCols} FROM scores_old;`);
      d.exec('DROP TABLE scores_old; DROP TABLE forecasts_old;');
    })();
    d.pragma('foreign_keys = ON');
  }
  d.exec(`UPDATE submissions SET status = 'open' WHERE status = 'sealed'; UPDATE submissions SET status = 'scored' WHERE status = 'revealed';`);

  // People sign in with a wallet; everyone has a price for unlocking a sealed pick.
  const agentCols = new Set((d.prepare('PRAGMA table_info(agents)').all() as { name: string }[]).map((c) => c.name));
  if (!agentCols.has('kind')) d.exec(`ALTER TABLE agents ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'`);
  if (!agentCols.has('bio')) d.exec(`ALTER TABLE agents ADD COLUMN bio TEXT`);
  if (!agentCols.has('price_micro')) d.exec(`ALTER TABLE agents ADD COLUMN price_micro INTEGER NOT NULL DEFAULT 100`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS agents_human_address ON agents(sui_address) WHERE kind = 'human'`);

  // A pick made after buying 0xkafka's call on the same question backs 0xkafka:
  // shown on the profile, never ranked or read back by 0xkafka.
  const subCols = new Set((d.prepare('PRAGMA table_info(submissions)').all() as { name: string }[]).map((c) => c.name));
  if (!subCols.has('backs')) d.exec(`ALTER TABLE submissions ADD COLUMN backs TEXT`);
  // When its author shared it to X: a shared prediction is public from then on.
  if (!subCols.has('shared_at')) d.exec(`ALTER TABLE submissions ADD COLUMN shared_at TEXT`);

  // Conversations with 0xkafka, kept for the signed-in person who had them.
  d.exec(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL REFERENCES agents(handle),
    title TEXT NOT NULL,
    turns TEXT NOT NULL,
    asked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  d.exec(`CREATE INDEX IF NOT EXISTS chats_handle ON chats(handle, updated_at)`);

  // Each person's assistant keeps its own lessons about them, learned from their memory.
  // Separate from 0xkafka's forecasting lessons (the lessons table). Numbered A1, A2… per person.
  d.exec(`CREATE TABLE IF NOT EXISTS assistant_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL REFERENCES agents(handle),
    n INTEGER NOT NULL,
    kind TEXT NOT NULL,
    statement TEXT NOT NULL,
    evidence TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    replaces INTEGER,
    retired_reason TEXT,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    retired_at TEXT,
    memory_id INTEGER,
    UNIQUE(handle, n)
  )`);
  // 0xkafka signals a person chose to learn from: saved to their own Walrus memory, private to them.
  d.exec(`CREATE TABLE IF NOT EXISTS saved_signals (
    handle TEXT NOT NULL REFERENCES agents(handle),
    market_id TEXT NOT NULL,
    forecast_id TEXT NOT NULL,
    memory_id INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (handle, market_id)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS assistant_state (
    handle TEXT PRIMARY KEY REFERENCES agents(handle),
    seen INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 0,
    reflected_at TEXT
  )`);
}

export const nowIso = () => new Date().toISOString();

export function logActivity(kind: string, text: string, ref?: string) {
  db().prepare('INSERT INTO activity (at, kind, text, ref) VALUES (?, ?, ?, ?)').run(nowIso(), kind, text, ref ?? null);
}

export function bump(name: string, by = 1) {
  db()
    .prepare('INSERT INTO counters (name, n) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET n = n + excluded.n')
    .run(name, by);
}

export function kvGet<T>(k: string): T | undefined {
  const row = db().prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as T) : undefined;
}

export function kvSet(k: string, v: unknown) {
  db().prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}
