// Wake 0xkafka from Walrus: rebuild the current mind (policy) from the latest
// `0xkafka.mind` memory: trust, calibration, benched categories, and the crowd
// policy (weight on the agents, each agent's weight, model priors). Run it on an
// empty database to show that Walrus, not SQLite, is where 0xkafka's mind lives.

import { db, nowIso } from '../src/db/client';
import { parseMeta, parsePolicyLine } from '../src/memory/format';
import { recall } from '../src/memory/walrus';
import { currentMind } from '../src/agent/mind';

const hits = await recall('mind', '0xkafka mind latest policy trust calibration', { limit: 50, sort: 'recent' });
const minds = hits
  .map((h) => ({ h, v: Number(parseMeta(h.text).mind), policy: parsePolicyLine(h.text) }))
  .filter((x) => x.v > 0 && x.policy)
  .sort((a, b) => b.v - a.v);

if (!minds.length) {
  console.log('No mind found on Walrus yet. 0xkafka starts fresh.');
  process.exit(0);
}
const top = minds[0];
const local = currentMind();
console.log(`Walrus has mind v${top.v} (blob ${top.h.blob_id}). Local cache has v${local.version}.`);
if (local.version >= top.v) {
  console.log('Local cache is current.');
  process.exit(0);
}
db()
  .prepare(`INSERT OR REPLACE INTO minds (version, created_at, sim_time, policy, diff, n_scored, stats) VALUES (?, ?, ?, ?, ?, ?, '{}')`)
  .run(top.v, nowIso(), parseMeta(top.h.text).at ?? nowIso(), JSON.stringify(top.policy), JSON.stringify(['Restored from Walrus.']), 0);
console.log(`Restored mind v${top.v} from Walrus:`, top.policy);
