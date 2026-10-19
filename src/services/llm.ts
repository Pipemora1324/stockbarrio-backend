import type { ZodType } from 'zod';
import { config } from '../config.js';

export interface LlmProvider {
  name: 'principal' | 'respaldo';
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult<T> {
  data: T;
  provider: LlmProvider['name'];
}

// Main provider first, then the optional fallback. With AI_PROVIDER=local (the default) nothing is called.
export const activeProviders = (): LlmProvider[] => {
  if (config.aiProvider === 'local') return [];
  const providers: LlmProvider[] = [];
  if (config.openAiApiKey) providers.push({ name: 'principal', apiKey: config.openAiApiKey, model: config.openAiModel, baseUrl: config.openAiBaseUrl });
  if (config.aiFallbackApiKey && config.aiFallbackModel && config.aiFallbackBaseUrl) {
    providers.push({ name: 'respaldo', apiKey: config.aiFallbackApiKey, model: config.aiFallbackModel, baseUrl: config.aiFallbackBaseUrl });
  }
  return providers;
};

export const isLlmEnabled = () => activeProviders().length > 0;

// Models sometimes wrap JSON in ```json fences or add a sentence around it: keep only the outer object.
export const extractJson = (content: string): unknown => {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('La respuesta no trae JSON.');
  return JSON.parse(content.slice(start, end + 1));
};

const callProvider = async (provider: LlmProvider, messages: ChatTurn[], maxTokens: number): Promise<string | null> => {
  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.model, temperature: 0.2, max_tokens: maxTokens, messages }),
    signal: AbortSignal.timeout(config.aiTimeoutMs),
  });
  // 429 (quota) and 5xx (provider down) are expected now and then: the caller just moves to the next provider.
  if (!response.ok) return null;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
};

// Asks each provider in order for a JSON answer validated with the schema. Any failure (network, timeout, HTTP error,
// invalid JSON or wrong shape) moves on to the next one; when all fail it returns null so callers use local rules.
export const requestChatJson = async <T>(messages: ChatTurn[], schema: ZodType<T>, maxTokens = config.aiMaxTokens): Promise<LlmResult<T> | null> => {
  for (const provider of activeProviders()) {
    try {
      const content = await callProvider(provider, messages, maxTokens);
      if (!content) continue;
      const parsed = schema.safeParse(extractJson(content));
      if (parsed.success) return { data: parsed.data, provider: provider.name };
    } catch {
      // Try the next provider.
    }
  }
  return null;
};

// Single-shot helper: a system prompt plus a JSON payload as the user message.
export const requestJson = async <T>(systemPrompt: string, payload: unknown, schema: ZodType<T>): Promise<T | null> =>
  (await requestChatJson([{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(payload) }], schema))?.data ?? null;
