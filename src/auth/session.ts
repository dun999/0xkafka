import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { suiRpc } from '../chain/tatum';
import { config } from '../config';

// Sign in with a Sui wallet. Nothing is stored before the signature comes back:
// the nonce is an HMAC over (address, time), so the server can rebuild and check
// the exact message the wallet signed. The session is an HMAC-signed cookie.

export const SESSION_COOKIE = 'kafka_session';
export const NONCE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_S = 30 * 86_400;

function key(): string {
  const k = process.env.SESSION_SECRET || config.mppSecret;
  if (!k || k.length < 32) throw new Error('Set SESSION_SECRET (or MPP_SECRET_KEY) to a random string of 32+ characters');
  return k;
}
const mac = (data: string) => createHmac('sha256', key()).update(data).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

/** The exact text the wallet shows and signs. */
export function signInMessage(address: string, issuedAt: string): string {
  const a = normalizeSuiAddress(address);
  return [
    'Sign in to 0xkafka',
    '',
    'This proves you own this wallet. It costs nothing and moves no funds.',
    '',
    `Address: ${a}`,
    `Nonce: ${mac(`signin|${a}|${issuedAt}`).slice(0, 22)}`,
    `Issued: ${issuedAt}`,
  ].join('\n');
}

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Check a signed sign-in message. Returns the normalised address. */
export async function verifySignIn(input: { address: string; issuedAt: string; signature: string }, now = Date.now()): Promise<string> {
  if (!SUI_ADDRESS_RE.test(input.address)) throw new AuthError(400, 'address must be a 0x-prefixed, 64-hex-digit Sui address');
  const t = Date.parse(input.issuedAt);
  if (!Number.isFinite(t) || now - t > NONCE_TTL_MS || t - now > 60_000) throw new AuthError(401, 'This sign-in request expired. Try again.');
  const address = normalizeSuiAddress(input.address);
  const message = new TextEncoder().encode(signInMessage(address, input.issuedAt));
  await verifyPersonalMessageSignature(message, input.signature, { client: suiRpc(), address }).catch(() => {
    throw new AuthError(401, 'The signature does not match this wallet.');
  });
  return address;
}

export interface Session {
  /** Normalised Sui address. */
  address: string;
  /** Unix seconds. */
  exp: number;
}

export function encodeSession(address: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ address: normalizeSuiAddress(address), exp: Math.floor(now / 1000) + SESSION_TTL_S } satisfies Session)).toString(
    'base64url',
  );
  return `${body}.${mac(`session|${body}`)}`;
}

export function decodeSession(token: string | undefined | null, now = Date.now()): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, mac(`session|${body}`))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
    if (typeof s.address !== 'string' || typeof s.exp !== 'number' || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

export const sessionCookie = (token: string) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.publicUrl.startsWith('https://'),
  path: '/',
  maxAge: SESSION_TTL_S,
});
