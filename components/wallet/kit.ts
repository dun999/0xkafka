'use client';

import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';

// One dApp Kit for the whole page, created on first use in the browser (wallets
// are found through `window`). The browser talks to the public fullnode; the
// server checks every payment and signature through Tatum.

const FULLNODE = 'https://fullnode.mainnet.sui.io:443';

function make() {
  return createDAppKit({
    networks: ['mainnet'],
    createClient: (network) => new SuiGrpcClient({ network, baseUrl: FULLNODE }),
    slushWalletConfig: { appName: '0xkafka' },
  });
}

export type Kit = ReturnType<typeof make>;

let kit: Kit | null = null;

export function getKit(): Kit {
  if (typeof window === 'undefined') throw new Error('The wallet kit only runs in the browser');
  kit ??= make();
  return kit;
}
