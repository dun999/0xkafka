import { cookies } from 'next/headers';
import { profileByAddress, type AgentRow } from '../agents/store';
import { decodeSession, SESSION_COOKIE, type Session } from './session';

/** Who is signed in on this request: the wallet session and its profile, if one was created. */
export async function currentUser(): Promise<{ session: Session; profile: AgentRow | null } | null> {
  const session = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return { session, profile: profileByAddress(session.address) ?? null };
}
