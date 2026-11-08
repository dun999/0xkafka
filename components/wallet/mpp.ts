'use client';

// Every payment in the app goes over MPP, the Machine Payments Protocol: the
// server answers 402 with a challenge, the wallet pays USDC on Sui straight to
// the seller and signs a proof, and the server checks the transaction on chain
// (through Tatum's Sui gRPC) before it hands anything over.

/** Where a payment is: approving in the wallet, signing the MPP proof, or being checked on Sui. */
export type PayStep = 'wallet' | 'proof' | 'verifying';

export class NotConnected extends Error {
  constructor() {
    super('Connect your wallet to pay');
  }
}

/**
 * The wallet's signer, saying when the wallet is asked for the MPP proof and when that's done.
 * A Proxy that runs every call on the real signer: the wallet signer keeps its connection in
 * private fields (#dAppKit), which a copy or a prototype stand-in can't read.
 */
export function withSteps<S extends { signPersonalMessage(bytes: Uint8Array): Promise<{ signature: string }> }>(base: S, onStep: (s: PayStep) => void): S {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'signPersonalMessage')
        return async (bytes: Uint8Array) => {
          onStep('proof');
          const r = await target.signPersonalMessage(bytes);
          onStep('verifying');
          return r;
        };
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** Fetch a paid URL, paying over MPP with the connected wallet. */
export async function mppFetch(url: string, onStep: (s: PayStep) => void = () => {}): Promise<Response> {
  const [{ getKit }, { CurrentAccountSigner }, { sui, USDC }, { Mppx }] = await Promise.all([
    import('@/components/wallet/kit'),
    import('@mysten/dapp-kit-core'),
    import('@suimpp/mpp/client'),
    import('mppx/client'),
  ]);
  const kit = getKit();
  if (!kit.stores.$connection.get().isConnected) throw new NotConnected();

  const base = new CurrentAccountSigner(kit as unknown as ConstructorParameters<typeof CurrentAccountSigner>[0]);
  const signer = withSteps(base, onStep);

  const mppx = Mppx.create({
    polyfill: false,
    methods: [
      sui({
        client: kit.getClient(),
        signer,
        currency: USDC,
        execute: async (tx) => {
          onStep('wallet');
          const r = await kit.signAndExecuteTransaction({ transaction: tx });
          if (r.FailedTransaction) throw new Error(r.FailedTransaction.status.error?.message ?? 'Transaction failed');
          return { digest: r.Transaction.digest };
        },
      }),
    ],
  });
  return mppx.fetch(url);
}

/** A wallet or MPP error, in a sentence a person can act on. */
export function payError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(m)) return 'You cancelled in your wallet. Nothing was paid.';
  if (/insufficient|balance|No valid coins|not enough/i.test(m)) return 'Not enough USDC (or SUI for gas) in this wallet.';
  return m.replace(/^Payment transaction failed: /, '');
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const suiscanTx = (d: string) => `https://suiscan.xyz/mainnet/tx/${d}`;
