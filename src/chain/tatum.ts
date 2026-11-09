import { ChannelCredentials } from '@grpc/grpc-js';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import {
  RpcError,
  UnaryCall,
  type ClientStreamingCall,
  type DuplexStreamingCall,
  type MethodInfo,
  type RpcOptions,
  type RpcTransport,
  type ServerStreamingCall,
} from '@protobuf-ts/runtime-rpc';
import { SUI_USDC_TYPE } from '@suimpp/mpp';
import { config } from '../config';
import { bump, db } from '../db/client';

// 0xkafka's window onto Sui. With TATUM_API_KEY set, every chain read (payment
// checks, sign-in signatures, balances) goes through Tatum's Sui gRPC gateway,
// and crypto questions use Tatum's Price API.
//
// If Tatum fails (out of credits, rate limited, bad key, down, slow), the same
// call is sent again to the public Sui fullnode, which speaks the same gRPC API,
// and Tatum is skipped for a while so later calls don't wait on it. Without a
// key, everything uses the public fullnode. The Price API has no public twin:
// when it fails, crypto questions go without price data.
//
// Both speak native gRPC over HTTP/2 (not gRPC-web), so the Sui SDK's client
// gets a grpc-js transport. Tatum's key travels as `x-api-key` metadata, added
// only to calls sent to Tatum so it never reaches the public node.

export const TATUM_GRPC_HOST = 'sui-mainnet-grpc.gateway.tatum.io:443';
export const PUBLIC_GRPC_HOST = 'fullnode.mainnet.sui.io:443';
export const USDC_TYPE = SUI_USDC_TYPE;
export const USDC_DECIMALS = 6;

/** Errors where Tatum did answer, and the public node would say the same: don't retry those. */
const ANSWER_CODES = new Set(['NOT_FOUND', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'OUT_OF_RANGE', 'ALREADY_EXISTS']);
/** Tatum refusing the key: out of credits, rate limited, or a bad key. */
const QUOTA_CODES = new Set(['RESOURCE_EXHAUSTED', 'UNAUTHENTICATED', 'PERMISSION_DENIED']);
const QUOTA_PAUSE_MS = 15 * 60_000;
const OUTAGE_PAUSE_MS = 60_000;
const TATUM_TIMEOUT_MS = 8_000;

const g = globalThis as unknown as { __suiRpc?: SuiGrpcClient; __tatumPausedUntil?: number };

/** True while Tatum is being skipped after a failure. */
export const tatumPaused = () => Date.now() < (g.__tatumPausedUntil ?? 0);

export type RpcProvider = 'tatum' | 'sui-public';
/** The provider the next chain call will use. */
export const rpcProvider = (): RpcProvider => (config.tatumKey && !tatumPaused() ? 'tatum' : 'sui-public');
export const RPC_LABEL: Record<RpcProvider, string> = { tatum: 'Tatum gRPC', 'sui-public': 'Sui public RPC' };

/** Count a chain call by provider and method, for the Ledger. */
function count(p: RpcProvider, method: string) {
  bump(`${p}.calls`);
  bump(`${p}.${method}`);
}

/**
 * Sends each call to Tatum first and, if Tatum fails, to the public node.
 * Unary calls (everything 0xkafka makes) get the fallback; streaming calls just
 * go to whichever provider is currently in use.
 */
export class FallbackTransport implements RpcTransport {
  constructor(
    private readonly tatum: RpcTransport,
    private readonly backup: RpcTransport,
    private readonly key: string,
  ) {}

  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    // The backup's defaults carry no key; the key is added per Tatum call below.
    return this.backup.mergeOptions(options);
  }

  private tatumOptions(options: RpcOptions): RpcOptions {
    return { ...options, meta: { ...options.meta, 'x-api-key': this.key }, timeout: options.timeout ?? TATUM_TIMEOUT_MS };
  }

  unary<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): UnaryCall<I, O> {
    if (tatumPaused()) {
      count('sui-public', method.name);
      return this.backup.unary(method, input, options);
    }
    const finished = (async () => {
      try {
        count('tatum', method.name);
        return await this.tatum.unary(method, input, this.tatumOptions(options));
      } catch (err) {
        const code = err instanceof RpcError ? err.code : 'UNKNOWN';
        if (ANSWER_CODES.has(code)) throw err;
        const pause = QUOTA_CODES.has(code) ? QUOTA_PAUSE_MS : OUTAGE_PAUSE_MS;
        g.__tatumPausedUntil = Date.now() + pause;
        bump('tatum.fallbacks');
        console.warn(`[rpc] Tatum ${method.name} failed (${code}); using the public Sui node for ${pause / 60_000} min`);
        count('sui-public', method.name);
        return await this.backup.unary(method, input, options);
      }
    })();
    // Like protobuf-ts's own Deferred: callers often read only `response`, so mark
    // the other parts as handled or a failed call would crash Node with an unhandled rejection.
    const part = <T>(pick: (c: Awaited<typeof finished>) => T): Promise<T> => {
      const p = finished.then(pick);
      p.catch(() => {});
      return p;
    };
    return new UnaryCall(method, options.meta ?? {}, input, part((c) => c.headers), part((c) => c.response), part((c) => c.status), part((c) => c.trailers));
  }

  serverStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): ServerStreamingCall<I, O> {
    return tatumPaused() ? this.backup.serverStreaming(method, input, options) : this.tatum.serverStreaming(method, input, this.tatumOptions(options));
  }

  clientStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): ClientStreamingCall<I, O> {
    return tatumPaused() ? this.backup.clientStreaming(method, options) : this.tatum.clientStreaming(method, this.tatumOptions(options));
  }

  duplex<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): DuplexStreamingCall<I, O> {
    return tatumPaused() ? this.backup.duplex(method, options) : this.tatum.duplex(method, this.tatumOptions(options));
  }
}

/** A public-node transport that only counts calls, used when there is no Tatum key. */
class PublicTransport implements RpcTransport {
  constructor(private readonly inner: RpcTransport) {}
  mergeOptions(options?: Partial<RpcOptions>) {
    return this.inner.mergeOptions(options);
  }
  unary<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions) {
    count('sui-public', method.name);
    return this.inner.unary(method, input, options);
  }
  serverStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions) {
    return this.inner.serverStreaming(method, input, options);
  }
  clientStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions) {
    return this.inner.clientStreaming(method, options);
  }
  duplex<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions) {
    return this.inner.duplex(method, options);
  }
}

const grpc = (host: string) => new GrpcTransport({ host, channelCredentials: ChannelCredentials.createSsl() });

/** The Sui client every chain call goes through: Tatum with the public fullnode behind it, or the public fullnode alone. */
export function suiRpc(): SuiGrpcClient {
  if (g.__suiRpc) return g.__suiRpc;
  const key = config.tatumKey;
  const transport = key ? new FallbackTransport(grpc(TATUM_GRPC_HOST), grpc(PUBLIC_GRPC_HOST), key) : new PublicTransport(grpc(PUBLIC_GRPC_HOST));
  g.__suiRpc = new SuiGrpcClient({ network: 'mainnet', transport });
  return g.__suiRpc;
}

export async function usdcBalance(owner: string): Promise<number | null> {
  try {
    const r = await suiRpc().core.getBalance({ owner, coinType: USDC_TYPE });
    return Number(r.balance.balance) / 10 ** USDC_DECIMALS;
  } catch {
    return null;
  }
}

export async function chainInfo(): Promise<{ epoch: string; checkpoint: string } | null> {
  try {
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

const gp = globalThis as unknown as { __pricePausedUntil?: number };

async function priceGet(url: string): Promise<unknown> {
  if (!config.tatumKey) throw new Error('TATUM_API_KEY is not set');
  const cached = db().prepare('SELECT v FROM kv WHERE k = ?').get(`price:${url}`) as { v: string } | undefined;
  if (cached) return JSON.parse(cached.v);
  if (Date.now() < (gp.__pricePausedUntil ?? 0)) throw new Error('Tatum price API paused after a refusal');
  const res = await fetch(url, { headers: { 'x-api-key': config.tatumKey }, signal: AbortSignal.timeout(20_000) });
  bump('tatum.calls');
  bump('tatum.PriceAPI');
  if (!res.ok) {
    // Out of credits, rate limited or a bad key: stop asking for a while.
    if ([401, 402, 403, 429].includes(res.status)) gp.__pricePausedUntil = Date.now() + QUOTA_PAUSE_MS;
    throw new Error(`Tatum price API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
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
