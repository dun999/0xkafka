import { NextResponse } from 'next/server';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { currentUser } from '@/src/auth/current';
import { config } from '@/src/config';
import { CATEGORIES, type Category } from '@/src/markets/categories';
import { kafkaRecord, signalList } from '@/src/picks/signals';

export const dynamic = 'force-dynamic';

/**
 * Questions 0xkafka sells its call on, with its record: free to list.
 *   ?category=sports  ?q=lakers  ?id=<market id>
 *   ?for=pick         open questions you can still seal your own pick on
 * Buying one is GET /api/v1/forecast/<id>, paid over MPP (USDC on Sui).
 */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const c = u.get('category');
  const category = c && (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : null;
  const me = await currentUser();
  const items = signalList({
    category,
    q: u.get('q'),
    id: u.get('id'),
    address: me?.session.address ?? null,
    handle: me?.profile?.handle ?? null,
    picksOnly: u.get('for') === 'pick',
    limit: Math.min(12, Number(u.get('limit')) || 6),
  });
  return NextResponse.json({
    price_usdc: config.prices.signal,
    rail: { protocol: 'MPP', name: 'Machine Payments Protocol', network: 'Sui mainnet', currency: 'USDC', pay_to: config.payTo ? normalizeSuiAddress(config.payTo) : null },
    record: kafkaRecord(category),
    signals: items,
  });
}
