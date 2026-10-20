import type { ZodType } from 'zod';
import { config } from '../config.js';

export type ProviderName = 'principal' | 'respaldo';

export interface LlmTarget {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult<T> {
  data: T;
  provider: ProviderName;
  model: string;
}

interface Limits {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number;
}

interface Usage {
  minuteStart: number;
  minuteRequests: number;
  minuteTokens: number;
  day: string;
  dayRequests: number;
  dayTokens: number;
  blockedUntil: number;
}

const minuteMs = 60_000;
const serverErrorPauseMs = 30_000;
const defaultRateLimitPauseMs = 60_000;

// Cadena ordenada: todos los modelos del proveedor principal y luego los del respaldo. Con AI_PROVIDER=local no se llama a nada.
export const modelChain = (): LlmTarget[] => {
  if (config.aiProvider === 'local') return [];
  const targets: LlmTarget[] = [];
  if (config.openAiApiKey) {
    const models = config.aiModels.length ? config.aiModels : [config.openAiModel];
    for (const model of models) targets.push({ provider: 'principal', apiKey: config.openAiApiKey, baseUrl: config.openAiBaseUrl, model });
  }
  if (config.aiFallbackApiKey && config.aiFallbackBaseUrl) {
    const models = config.aiFallbackModels.length ? config.aiFallbackModels : config.aiFallbackModel ? [config.aiFallbackModel] : [];
    for (const model of models) targets.push({ provider: 'respaldo', apiKey: config.aiFallbackApiKey, baseUrl: config.aiFallbackBaseUrl, model });
  }
  return targets;
};

export const isLlmEnabled = () => modelChain().length > 0;

const limitsFor = (provider: ProviderName): Limits =>
  provider === 'principal'
    ? { requestsPerMinute: config.aiRequestsPerMinute, requestsPerDay: config.aiRequestsPerDay, tokensPerMinute: config.aiTokensPerMinute, tokensPerDay: config.aiTokensPerDay }
    : { requestsPerMinute: config.aiFallbackRequestsPerMinute, requestsPerDay: config.aiFallbackRequestsPerDay, tokensPerMinute: config.aiFallbackTokensPerMinute, tokensPerDay: config.aiFallbackTokensPerDay };

// Uso por proveedor y modelo, en memoria. Los contadores diarios siguen el día UTC, como los cupos de los proveedores.
const usage = new Map<string, Usage>();
const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const nextUtcMidnight = (now: number) => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
};

const usageOf = (target: LlmTarget, now: number): Usage => {
  const key = `${target.provider}:${target.model}`;
  let current = usage.get(key);
  if (!current) {
    current = { minuteStart: now, minuteRequests: 0, minuteTokens: 0, day: utcDay(now), dayRequests: 0, dayTokens: 0, blockedUntil: 0 };
    usage.set(key, current);
  }
  if (now - current.minuteStart >= minuteMs) Object.assign(current, { minuteStart: now, minuteRequests: 0, minuteTokens: 0 });
  if (current.day !== utcDay(now)) Object.assign(current, { day: utcDay(now), dayRequests: 0, dayTokens: 0 });
  return current;
};

export const resetModelUsage = () => usage.clear();

// Cuenta aproximada de tokens (unos 4 caracteres por token en texto en español y JSON), suficiente para dejar margen.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
export const estimatePromptTokens = (messages: ChatTurn[]) => messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0);

// Si este modelo puede recibir una petición más de este tamaño sin pasarse de sus presupuestos.
export const hasBudget = (target: LlmTarget, tokens: number, now = Date.now()) => {
  const current = usageOf(target, now);
  const limits = limitsFor(target.provider);
  return (
    current.blockedUntil <= now &&
    current.minuteRequests < limits.requestsPerMinute &&
    current.dayRequests < limits.requestsPerDay &&
    current.minuteTokens + tokens <= limits.tokensPerMinute &&
    current.dayTokens + tokens <= limits.tokensPerDay
  );
};

const addTokens = (target: LlmTarget, tokens: number, now: number) => {
  const current = usageOf(target, now);
  current.minuteTokens += tokens;
  current.dayTokens += tokens;
};

// Se cuenta antes de llamar, con la estimación: una petición que falla también gastó parte del cupo.
const record = (target: LlmTarget, tokens: number, now: number) => {
  const current = usageOf(target, now);
  current.minuteRequests++;
  current.dayRequests++;
  addTokens(target, tokens, now);
};

// Retry-After puede venir en segundos o como fecha HTTP.
const retryAfterMs = (header: string | null, now: number) => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
};

// Un 429 por cupo diario bloquea el modelo hasta el día siguiente; si no, hasta Retry-After o un minuto.
export const pauseAfterRateLimit = (headers: Headers, body: string, now = Date.now()) => {
  const fromHeader = retryAfterMs(headers.get('retry-after'), now);
  const daily = headers.get('x-ratelimit-remaining-requests') === '0' || /per day|daily|RPD|TPD|requests per day|tokens per day/i.test(body);
  if (daily) return Math.max(fromHeader ?? 0, nextUtcMidnight(now) - now);
  return fromHeader ?? defaultRateLimitPauseMs;
};

const block = (target: LlmTarget, pauseMs: number, reason: string, now: number) => {
  usageOf(target, now).blockedUntil = now + pauseMs;
  // Solo el nombre del proveedor, el modelo y el tiempo: nunca la clave ni la petición.
  console.warn(`IA: ${target.provider}/${target.model} en pausa ${Math.round(pauseMs / 1000)} s (${reason}).`);
};

// El razonamiento mínimo que acepta cada familia de modelos, y las opciones que lo dejan fuera de la respuesta.
export const reasoningOptions = (model: string): Record<string, unknown> => {
  if (/gpt-oss/i.test(model)) return { reasoning_effort: 'low', include_reasoning: false };
  if (/qwen/i.test(model)) return { reasoning_effort: 'none', reasoning_format: 'hidden' };
  if (/gemini-2\.5/i.test(model)) return { reasoning_effort: 'low' };
  return {};
};

// El razonamiento interno nunca se muestra: se quita cualquier bloque <think> antes de leer el JSON.
export const stripReasoning = (content: string) => content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/^[\s\S]*<\/think(?:ing)?>/i, '');

// A veces los modelos envuelven el JSON en ```json o le agregan una frase: se toma solo el objeto exterior.
export const extractJson = (content: string): unknown => {
  const clean = stripReasoning(content);
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('La respuesta no trae JSON.');
  return JSON.parse(clean.slice(start, end + 1));
};

const callModel = async (target: LlmTarget, messages: ChatTurn[], maxTokens: number, estimated: number): Promise<string | null> => {
  const now = Date.now();
  record(target, estimated, now);
  let response: Response;
  try {
    response = await fetch(`${target.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: target.model, temperature: 0.2, max_tokens: maxTokens, messages, ...reasoningOptions(target.model) }),
      signal: AbortSignal.timeout(config.aiTimeoutMs),
    });
  } catch {
    return null;
  }
  if (response.status === 429) {
    block(target, pauseAfterRateLimit(response.headers, await response.text().catch(() => '')), 'cupo agotado', Date.now());
    return null;
  }
  if (response.status >= 500) {
    block(target, retryAfterMs(response.headers.get('retry-after'), Date.now()) ?? serverErrorPauseMs, `error ${response.status}`, Date.now());
    return null;
  }
  if (!response.ok) return null;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
  // Se reemplaza la estimación por la cuenta real cuando el proveedor la informa.
  const real = data.usage?.total_tokens;
  if (real && real > estimated) addTokens(target, real - estimated, Date.now());
  return data.choices?.[0]?.message?.content ?? null;
};

// Prueba cada modelo de la cadena en orden y devuelve la primera respuesta que pasa el esquema; null si fallan todos,
// para que quien llama use las reglas locales. Los prompts que pasan del tamaño máximo ni se envían.
export const requestChatJson = async <T>(messages: ChatTurn[], schema: ZodType<T>, maxTokens = config.aiMaxTokens): Promise<LlmResult<T> | null> => {
  const promptTokens = estimatePromptTokens(messages);
  if (promptTokens > config.aiMaxPromptTokens) return null;
  const estimated = promptTokens + maxTokens;
  for (const target of modelChain()) {
    if (!hasBudget(target, estimated)) continue;
    try {
      const content = await callModel(target, messages, maxTokens, estimated);
      if (!content) continue;
      const parsed = schema.safeParse(extractJson(content));
      if (parsed.success) return { data: parsed.data, provider: target.provider, model: target.model };
    } catch {
      // Respuesta inválida: se prueba el siguiente modelo.
    }
  }
  return null;
};

// Ayuda de una sola llamada: un prompt de sistema más un JSON como mensaje del usuario.
export const requestJson = async <T>(systemPrompt: string, payload: unknown, schema: ZodType<T>, maxTokens = config.aiMaxTokens): Promise<T | null> =>
  (await requestChatJson([{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(payload) }], schema, maxTokens))?.data ?? null;
