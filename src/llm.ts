import OpenAI from 'openai';
import { z } from 'zod';
import { config, devMock } from './config';
import { bump } from './db/client';

// DeepSeek V4 on Boundless, through the OpenAI-compatible API.

let client: OpenAI | null = null;
function llm(): OpenAI {
  if (!config.llm.apiKey) throw new Error('LLM_API_KEY is not set');
  client ??= new OpenAI({ baseURL: config.llm.baseURL, apiKey: config.llm.apiKey, timeout: 120_000, maxRetries: 2 });
  return client;
}

export const ForecastAnswer = z.object({
  p: z.number().min(0).max(1),
  reason: z.string().min(1),
});
export type ForecastAnswer = z.infer<typeof ForecastAnswer>;

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(text.slice(start, end + 1));
}

let jsonModeWorks = true;

/**
 * DEV ONLY (LLM_MOCK=1): a deterministic stand-in so the UI can be built
 * without an API key. It reads the model probability from the prompt when one
 * is given and otherwise returns a hash of the question. Never used in production.
 */
function mockAnswer(user: string): ForecastAnswer {
  const model = user.match(/gives P\(A\) ≈ (\d+)%/);
  let h = 0;
  for (const ch of user) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const noise = ((h % 1000) / 1000 - 0.5) * 0.5;
  const base = model ? Number(model[1]) / 100 : 0.5;
  const memoryNudge = user.includes('From your memory') ? -0.03 : 0;
  return { p: Math.min(0.95, Math.max(0.05, base + noise + memoryNudge)), reason: 'Mock answer for local development.' };
}

export async function askForecast(system: string, user: string): Promise<ForecastAnswer> {
  if (devMock('LLM_MOCK')) return mockAnswer(user);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await llm().chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // DeepSeek V4 reasons before it answers; on a full prompt that alone can take ~2k tokens.
        max_tokens: attempt === 0 ? 8000 : 16000,
        ...(jsonModeWorks ? { response_format: { type: 'json_object' as const } } : {}),
      });
      bump('llm.calls');
      const choice = res.choices[0];
      const text = choice?.message?.content ?? '';
      if (!text.trim()) throw new Error(`empty reply (finish ${choice?.finish_reason ?? '?'}, ${res.usage?.completion_tokens ?? '?'} tokens)`);
      const parsed = ForecastAnswer.parse(extractJson(text));
      // Models sometimes answer in percent.
      const p = parsed.p > 1 ? parsed.p / 100 : parsed.p;
      return { p: Math.min(0.99, Math.max(0.01, p)), reason: parsed.reason.replace(/\s+/g, ' ').trim().slice(0, 400) };
    } catch (e) {
      lastErr = e;
      if (e instanceof OpenAI.BadRequestError && jsonModeWorks) jsonModeWorks = false;
    }
  }
  throw lastErr;
}

/** One JSON answer checked against `schema`, with the same retries as forecasts. Used for post-mortems. */
export async function askJson<T>(system: string, user: string, schema: z.ZodType<T>, mock: () => T): Promise<T> {
  if (devMock('LLM_MOCK')) return mock();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await llm().chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: attempt === 0 ? 8000 : 16000,
        ...(jsonModeWorks ? { response_format: { type: 'json_object' as const } } : {}),
      });
      bump('llm.calls');
      const choice = res.choices[0];
      const text = choice?.message?.content ?? '';
      if (!text.trim()) throw new Error(`empty reply (finish ${choice?.finish_reason ?? '?'}, ${res.usage?.completion_tokens ?? '?'} tokens)`);
      return schema.parse(extractJson(text));
    } catch (e) {
      lastErr = e;
      if (e instanceof OpenAI.BadRequestError && jsonModeWorks) jsonModeWorks = false;
    }
  }
  throw lastErr;
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Streamed chat on the same model (Ask 0xkafka). Yields text as it arrives. */
// Reasoning tokens count toward max_tokens but stream separately, so the cap is generous.
export async function* chatStream(messages: ChatMessage[], maxTokens = 6000): AsyncGenerator<string> {
  if (devMock('LLM_MOCK')) {
    const ctx = messages[0]?.content ?? '';
    const blob = ctx.match(/\[blob:([A-Za-z0-9_-]+)\]/)?.[1];
    yield `Mock answer for local development. I answer from my public record only${blob ? `, for example [blob:${blob}]` : ''}.`;
    return;
  }
  const stream = await llm().chat.completions.create({ model: config.llm.model, messages, max_tokens: maxTokens, temperature: 0.3, stream: true });
  bump('llm.calls');
  bump('llm.chat');
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content;
    if (t) yield t;
  }
}
