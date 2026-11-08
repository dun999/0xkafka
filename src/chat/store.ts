import { db, nowIso } from '../db/client';

// Conversations with 0xkafka, kept for the signed-in person who had them and
// readable by nobody else. The client owns the turns (text, and the cards for
// payments and picks); the server stores them as they are.

export const MAX_TURNS = 200;
export const MAX_BYTES = 400_000;
export const MAX_CHATS = 200;

export interface StoredTurn {
  role: 'user' | 'assistant';
  content: string;
  at?: string;
  [k: string]: unknown;
}

export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

export const CHAT_ID = /^c_[a-z0-9]{8,24}$/;

export function listChats(handle: string, limit = 50): ChatSummary[] {
  return db().prepare('SELECT id, title, updated_at FROM chats WHERE handle = ? ORDER BY updated_at DESC LIMIT ?').all(handle, limit) as ChatSummary[];
}

export function getChat(handle: string, id: string): { id: string; title: string; turns: StoredTurn[] } | null {
  const r = db().prepare('SELECT id, title, turns FROM chats WHERE id = ? AND handle = ?').get(id, handle) as { id: string; title: string; turns: string } | undefined;
  if (!r) return null;
  try {
    return { id: r.id, title: r.title, turns: JSON.parse(r.turns) as StoredTurn[] };
  } catch {
    return { id: r.id, title: r.title, turns: [] };
  }
}

/** Save a whole conversation. False when the id belongs to someone else. */
export function saveChat(handle: string, id: string, turns: StoredTurn[]): boolean {
  const d = db();
  const owner = d.prepare('SELECT handle FROM chats WHERE id = ?').get(id) as { handle: string } | undefined;
  if (owner && owner.handle !== handle) return false;
  const kept = turns.slice(-MAX_TURNS);
  const json = JSON.stringify(kept);
  if (json.length > MAX_BYTES) throw new Error('Conversation too long to keep; start a new one');
  const first = kept.find((t) => t.role === 'user')?.content ?? 'New chat';
  const title = first.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New chat';
  const asked = kept.filter((t) => t.role === 'user').length;
  const now = nowIso();
  if (owner) d.prepare('UPDATE chats SET title = ?, turns = ?, asked = ?, updated_at = ? WHERE id = ?').run(title, json, asked, now, id);
  else {
    const n = (d.prepare('SELECT COUNT(*) n FROM chats WHERE handle = ?').get(handle) as { n: number }).n;
    if (n >= MAX_CHATS) d.prepare('DELETE FROM chats WHERE id = (SELECT id FROM chats WHERE handle = ? ORDER BY updated_at LIMIT 1)').run(handle);
    d.prepare('INSERT INTO chats (id, handle, title, turns, asked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, handle, title, json, asked, now, now);
  }
  return true;
}

export function deleteChat(handle: string, id: string): boolean {
  return db().prepare('DELETE FROM chats WHERE id = ? AND handle = ?').run(id, handle).changes > 0;
}

/** When this person asked 0xkafka something: one timestamp per question, for streaks and badges. */
export function askedTimes(handle: string): string[] {
  const rows = db().prepare('SELECT turns FROM chats WHERE handle = ?').all(handle) as { turns: string }[];
  const out: string[] = [];
  for (const r of rows) {
    try {
      for (const t of JSON.parse(r.turns) as StoredTurn[]) if (t.role === 'user' && typeof t.at === 'string') out.push(t.at);
    } catch {
      /* skip a broken row */
    }
  }
  return out;
}
