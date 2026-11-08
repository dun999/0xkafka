// Every setting is read on use, so `next build` works without secrets.

const env = (k: string) => {
  const v = process.env[k];
  return v && v.trim() !== '' ? v.trim() : undefined;
};

/** A dev-only stand-in, switched on explicitly. Refused outright in production so the live product can't fake memory or forecasts. */
export function devMock(flag: 'MEMWAL_MOCK' | 'LLM_MOCK'): boolean {
  if (env(flag) !== '1') return false;
  if (process.env.NODE_ENV === 'production') throw new Error(`${flag}=1 is not allowed in production`);
  return true;
}

export const config = {
  get dbPath() {
    return env('KAFKA_DB') ?? './data/kafka.db';
  },
  get ns() {
    return env('KAFKA_NS') ?? '0xkafka';
  },
  memwal: {
    get key() {
      return env('MEMWAL_PRIVATE_KEY');
    },
    get accountId() {
      return env('MEMWAL_ACCOUNT_ID');
    },
    get serverUrl() {
      return env('MEMWAL_SERVER_URL') ?? 'https://relayer.memory.walrus.xyz';
    },
    /** Local development only, and only when asked. Production never mocks; missing keys fail loudly. */
    get mock() {
      return devMock('MEMWAL_MOCK');
    },
  },
  get tatumKey() {
    return env('TATUM_API_KEY');
  },
  llm: {
    get baseURL() {
      return env('LLM_BASE_URL') ?? 'https://api.inference.boundless.network/v1';
    },
    get apiKey() {
      return env('LLM_API_KEY');
    },
    get model() {
      return env('LLM_MODEL') ?? 'deepseek/deepseek-v4-flash-0731';
    },
  },
  get payTo() {
    return env('KAFKA_SUI_ADDRESS');
  },
  get mppSecret() {
    return env('MPP_SECRET_KEY');
  },
  get publicUrl() {
    return env('PUBLIC_URL') ?? 'https://0xkafka.xyz';
  },
  prices: {
    signal: '0.005',
    onDemand: '0.005',
  },
};

export const NAMESPACES = ['forecasts', 'outcomes', 'lessons', 'mind', 'signals'] as const;
export type Namespace = (typeof NAMESPACES)[number];
/** Every forecaster (person or agent) remembers in its own namespace: `0xkafka.profile.<handle>`. */
export type ProfileNamespace = `profile.${string}`;
export type MemNamespace = Namespace | ProfileNamespace;
export const nsName = (n: MemNamespace) => `${config.ns}.${n}`;
export const profileNs = (handle: string): ProfileNamespace => `profile.${handle}`;
