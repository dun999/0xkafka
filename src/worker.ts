// 0xkafka's long-running loop. The web app serves pages, takes agents'
// submissions and sells predictions; this process lists questions, predicts at
// lock, resolves and scores, learns from the agents, lets each person's assistant
// learn from their memory, and drains the Walrus outbox.

import { config } from './config';
import { logActivity } from './db/client';
import { resolvePending, scan } from './agent/live';
import { learnPending } from './agent/postmortem';
import { predictPending } from './agent/predict';
import { drainOnce, isMock } from './memory/walrus';
import { learnAssistants } from './assistant/lessons';

const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[${name}]`, e);
      logActivity('error', `${name}: ${e instanceof Error ? e.message : e}`);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
};

console.log(`[kafka] worker up · memory ${isMock() ? 'MOCK' : 'Walrus mainnet'} · model ${config.llm.model}`);
logActivity('worker', 'Worker started');

const timers = [
  every(5_000, 'walrus', drainOnce),
  every(15 * 60_000, 'scan', () => scan()),
  every(60_000, 'predict', () => predictPending()),
  every(5 * 60_000, 'resolve', () => resolvePending()),
  every(5 * 60_000, 'learn', () => learnPending()),
  // Each person's assistant reflects on their own memory once it has grown.
  every(60_000, 'assistants', () => learnAssistants()),
];

const stop = () => {
  timers.forEach(clearInterval);
  console.log('[kafka] worker stopped');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
