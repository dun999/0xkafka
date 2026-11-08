import { ChannelCredentials } from '@grpc/grpc-js';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SUI_USDC_TYPE } from '@suimpp/mpp';
import { config } from '../config';
import { bump, db } from '../db/client';

// 0xkafka's window onto Sui. With TATUM_API_KEY set, every payment is verified
// through Tatum's Sui gRPC gateway and crypto questions use Tatum's Price API.
// Without a key it falls back to the public Sui fullnode (same gRPC API), and
// crypto questions go without price data.
//
// Both speak native gRPC over HTTP/2 (not gRPC-web), so the Sui SDK's client
// gets a grpc-js transport; Tatum's key travels as `x-api-key` metadata.

export const TATUM_GRPC_HOST = 'sui-mainnet-grpc.gateway.tatum.io:443';
export const PUBLIC_GRPC_HOST = 'fullnode.mainnet.sui.io:443';
export const USDC_TYPE = SUI_USDC_TYPE;
export const USDC_DECIMALS = 6;

export type RpcProvider = 'tatum' | 'sui-public';
export const rpcProvider = (): RpcProvider => (config.tatumKey ? 'tatum' : 'sui-public');
export const RPC_LABEL: Record<RpcProvider, string> = { tatum: 'Tatum gRPC', 'sui-public': 'Sui public RPC' };

const g = globalThis as unknown as { __suiRpc?: SuiGrpcClient };

/** The Sui client every chain call goes through: Tatum when keyed, the public fullnode otherwise. */
export function suiRpc(): SuiGrpcClient {
  if (g.__suiRpc) return g.__suiRpc;
  const tatum = rpcProvider() === 'tatum';
  const transport = new GrpcTransport({
    host: tatum ? TATUM_GRPC_HOST : PUBLIC_GRPC_HOST,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: tatum ? { 'x-api-key': config.tatumKey! } : {},
  });
  g.__suiRpc = new SuiGrpcClient({ network: 'mainnet', transport });
  return g.__suiRpc;
}

/** Count a chain call by provider and method, for the Ledger. */
export function rpcCall(method: string) {
  const p = rpcProvider();
  bump(`${p}.calls`);
  bump(`${p}.${method}`);
}

export async function usdcBalance(owner: string): Promise<number | null> {
  try {
    rpcCall('GetBalance');
    const r = await suiRpc().core.getBalance({ owner, coinType: USDC_TYPE });
    return Number(r.balance.balance) / 10 ** USDC_DECIMALS;
  } catch {
    return null;
  }
}

export async function chainInfo(): Promise<{ epoch: string; checkpoint: string } | null> {
  try {
    rpcCall('GetServiceInfo');
    const r = await suiRpc().ledgerService.getServiceInfo({});
    return { epoch: String(r.response.epoch ?? ''), checkpoint: String(r.response.checkpointHeight ?? '') };
  } catch {
    return null;
  }
}

// ---------- Price API ----------

const PRICE_API = 'https://api.tatum.io/v4/data/rate/symbol';

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  openTime?: number | string;
  closeTime?: number | string;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : NaN;
}

function toCandle(x: Record<string, unknown>): Candle {
  return { open: num(x.open), high: num(x.high), low: num(x.low), close: num(x.close), volume: num(x.volume), openTime: x.openTime as number, closeTime: x.closeTime as number };
}

async function priceGet(url: string): Promise<unknown> {
  if (!config.tatumKey) throw new Error('TATUM_API_KEY is not set');
  const cached = db().prepare('SELECT v FROM kv WHERE k = ?').get(`price:${url}`) as { v: string } | undefined;
  if (cached) return JSON.parse(cached.v);
  const res = await fetch(url, { headers: { 'x-api-key': config.tatumKey }, signal: AbortSignal.timeout(20_000) });
  bump('tatum.calls');
  bump('tatum.PriceAPI');
  if (!res.ok) throw new Error(`Tatum price API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  db().prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run(`price:${url}`, JSON.stringify(body));
  return body;
}

/** Up to 50 candles starting at `from`. Historical requests are cached forever; recent ones per hour. */
export async function candles(symbol: string, from: Date, count: number, interval: '1h' | '1d'): Promise<Candle[]> {
  const fromIso = new Date(Math.floor(from.getTime() / 3_600_000) * 3_600_000).toISOString();
  const p = new URLSearchParams({ symbol, timeFrom: fromIso, numberOfCandles: String(count), interval });
  const body = await priceGet(`${PRICE_API}/OHLCV/batch?${p}`);
  const arr = Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? []);
  return (arr as Record<string, unknown>[]).map(toCandle).filter((c) => Number.isFinite(c.close));
}

/** The candle containing `at` (1h interval). */
export async function priceAtTime(symbol: string, at: Date): Promise<number | null> {
  const hour = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
  const p = new URLSearchParams({ symbol, time: hour.toISOString(), interval: '1h' });
  const body = (await priceGet(`${PRICE_API}/OHLCV?${p}`)) as Record<string, unknown>;
  const c = toCandle(body);
  return Number.isFinite(c.close) ? c.close : null;
}
