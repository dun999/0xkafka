import { normalizeSuiAddress } from '@mysten/sui/utils';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { suiCharge, USDC } from '@suimpp/mpp';
import { Credential, Method, Receipt } from 'mppx';
import { Mppx } from 'mppx/server';
import { suiRpc } from '../chain/tatum';
import { config } from '../config';
import { db, logActivity, nowIso } from '../db/client';

// Buyers pay over MPP (the Machine Payments Protocol), in USDC on Sui: 0xkafka
// for its prediction, or a forecaster directly for unlocking their sealed pick.
// The method is @suimpp/mpp's `sui/charge`; verification is done here so every
// payment is read and checked on chain through the Sui RPC (Tatum's gRPC gateway
// when TATUM_API_KEY is set, the public fullnode otherwise):
//   - the transaction succeeded on chain
//   - USDC of at least the price reached 0xkafka's address
//   - the payer signed a proof binding this challenge to that digest
//   - the digest has never paid for anything before

/** The exact proof message @suimpp/mpp clients sign (domain suimpp.sui.payment-proof, v1). */
function proofBytes(challenge: { id: string; method: string; intent: string; request: { amount: string; currency: string; recipient: string } }, digest: string) {
  return new TextEncoder().encode(
    JSON.stringify({
      domain: 'suimpp.sui.payment-proof',
      version: 1,
      method: challenge.method,
      intent: challenge.intent,
      challengeId: challenge.id,
      amount: challenge.request.amount,
      currency: challenge.request.currency,
      recipient: challenge.request.recipient,
      digest,
    }),
  );
}

function toRaw(amount: string, decimals: number): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}

/** Verified payers by digest, so the route can record who paid for what. */
const verified = new Map<string, { sender: string; amount: string }>();

function tatumVerifiedSui(recipient: string) {
  const want = normalizeSuiAddress(recipient);
  return Method.toServer(suiCharge, {
    defaults: { currency: USDC.type, recipient },
    async verify({ credential }) {
      const digest = credential.payload.digest;
      const ch = credential.challenge;
      if (ch.request.currency !== USDC.type) throw new Error(`Unsupported currency ${ch.request.currency}`);
      if (normalizeSuiAddress(ch.request.recipient) !== want) throw new Error('Wrong recipient');
      if (db().prepare('SELECT 1 FROM used_digests WHERE digest = ?').get(digest)) {
        throw new Error(`Digest already used: ${digest}. Each payment buys one call.`);
      }

      const client = suiRpc();
      const tx = await withRetry(() =>
        client.core.getTransaction({ digest, include: { balanceChanges: true, transaction: true, effects: true } }),
      ).catch(() => {
        throw new Error(`Transaction ${digest} not found on Sui`);
      });
      const t = tx.Transaction ?? tx.FailedTransaction;
      if (!t?.status.success) throw new Error('Transaction failed on chain');
      const credit = t.balanceChanges?.find((b) => b.coinType === USDC.type && normalizeSuiAddress(b.address) === want && BigInt(b.amount) > 0n);
      if (!credit) throw new Error('No USDC reached the recipient in this transaction');
      if (BigInt(credit.amount) < toRaw(ch.request.amount, USDC.decimals)) throw new Error('Paid less than the price');

      const signer = await verifyPersonalMessageSignature(proofBytes(ch as never, digest), credential.payload.signature, { client }).catch((cause) => {
        throw new Error('Invalid payment proof signature', { cause });
      });
      const sender = t.transaction?.sender;
      if (!sender || normalizeSuiAddress(signer.toSuiAddress()) !== normalizeSuiAddress(sender)) {
        throw new Error('Proof signer is not the transaction sender');
      }

      const claimed = db().prepare('INSERT OR IGNORE INTO used_digests (digest, at) VALUES (?, ?)').run(digest, nowIso());
      if (claimed.changes === 0) throw new Error(`Digest already used: ${digest}`);
      verified.set(digest, { sender, amount: ch.request.amount });
      return Receipt.from({ method: 'sui', reference: digest, status: 'success', timestamp: new Date().toISOString() });
    },
  });
}

const g = globalThis as unknown as { __mppx?: Map<string, ReturnType<typeof make>> };
function make(recipient: string) {
  return Mppx.create({
    methods: [tatumVerifiedSui(recipient)],
    secretKey: config.mppSecret,
    realm: new URL(config.publicUrl).host,
  });
}
/** One MPP server per recipient: 0xkafka's own address, or a forecaster's. */
export function payments(recipient = config.payTo) {
  if (!recipient) throw new Error('KAFKA_SUI_ADDRESS is not set');
  const key = normalizeSuiAddress(recipient);
  g.__mppx ??= new Map();
  let p = g.__mppx.get(key);
  if (!p) g.__mppx.set(key, (p = make(key)));
  return p;
}

export type Charged =
  | { paid: false; response: Response }
  | { paid: true; digest: string; payer: string | null; withReceipt: (r: Response) => Response };

/**
 * Charge `amount` USDC for this request. Unpaid: a 402 with the MPP challenge.
 * Paid and verified: a function that attaches the Payment-Receipt to the response.
 */
export async function charge(request: Request, amount: string, description: string, recipient = config.payTo): Promise<Charged> {
  if (!recipient) throw new Error('KAFKA_SUI_ADDRESS is not set');
  const to = normalizeSuiAddress(recipient);
  const result = await payments(to).charge({ amount, description, currency: USDC.type, recipient: to })(request);
  if (result.status === 402) return { paid: false, response: result.challenge as Response };
  let digest = '';
  try {
    const cred = Credential.fromRequest<{ digest: string }>(request);
    digest = cred.payload.digest;
  } catch {
    /* receipt still valid; digest unknown */
  }
  const v = verified.get(digest);
  verified.delete(digest);
  return { paid: true, digest, payer: v?.sender ?? null, withReceipt: (r: Response) => result.withReceipt(r) as Response };
}

export function recordSale(s: { digest: string; payer: string | null; amount: string; endpoint: string; marketId?: string | null }) {
  db()
    .prepare(`INSERT OR IGNORE INTO sales (at, digest, payer, amount, protocol, endpoint, market_id) VALUES (?, ?, ?, ?, 'mpp', ?, ?)`)
    .run(nowIso(), s.digest, s.payer ? normalizeSuiAddress(s.payer) : null, s.amount, s.endpoint, s.marketId ?? null);
  logActivity('sale', `Sold ${s.endpoint} for ${s.amount} USDC`, s.digest);
}
