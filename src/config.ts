import 'dotenv/config';

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// "a, b , c" -> ['a', 'b', 'c']; empty values are dropped.
const parseList = (value: string | undefined) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

const requiredInProduction = (name: string): string => {
  const value = process.env[name];
  if (process.env.NODE_ENV === 'production' && !value) throw new Error(`La variable de entorno ${name} es obligatoria en producción.`);
  return value ?? '';
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://stock:stock@localhost:5432/stock_barrios',
  jwtSecret: requiredInProduction('JWT_SECRET') || 'desarrollo-local-cambio-obligatorio',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
  aiProvider: process.env.AI_PROVIDER ?? 'local',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  aiTimeoutMs: positiveNumber(process.env.AI_TIMEOUT_MS, 8000),
  // Optional second OpenAI-compatible provider, used when the main one fails (429, 5xx, timeout or invalid answer).
  aiFallbackApiKey: process.env.AI_FALLBACK_API_KEY ?? '',
  aiFallbackModel: process.env.AI_FALLBACK_MODEL ?? '',
  aiFallbackBaseUrl: process.env.AI_FALLBACK_BASE_URL ?? '',
  // Ordered model chains. Free tiers limit each model separately, so when one runs out the next one is used.
  aiModels: parseList(process.env.AI_MODELS),
  aiFallbackModels: parseList(process.env.AI_FALLBACK_MODELS),
  aiMaxTokens: positiveNumber(process.env.AI_MAX_TOKENS, 300),
  aiMaxPromptTokens: positiveNumber(process.env.AI_MAX_PROMPT_TOKENS, 700),
  // Per-model budgets kept in memory, a little under each provider's free limits.
  aiRequestsPerMinute: positiveNumber(process.env.AI_REQUESTS_PER_MINUTE, 28),
  aiRequestsPerDay: positiveNumber(process.env.AI_REQUESTS_PER_DAY, 950),
  aiTokensPerMinute: positiveNumber(process.env.AI_TOKENS_PER_MINUTE, 7000),
  aiTokensPerDay: positiveNumber(process.env.AI_TOKENS_PER_DAY, 150_000),
  aiFallbackRequestsPerMinute: positiveNumber(process.env.AI_FALLBACK_REQUESTS_PER_MINUTE, 5),
  aiFallbackRequestsPerDay: positiveNumber(process.env.AI_FALLBACK_REQUESTS_PER_DAY, 20),
  aiFallbackTokensPerMinute: positiveNumber(process.env.AI_FALLBACK_TOKENS_PER_MINUTE, 7000),
  aiFallbackTokensPerDay: positiveNumber(process.env.AI_FALLBACK_TOKENS_PER_DAY, 150_000),
  // Messages that actually use the model, per user (or per IP for visitors). Over the limit the chat answers with rules.
  aiChatPerMinute: positiveNumber(process.env.AI_CHAT_PER_MINUTE, 5),
  aiChatPerDay: positiveNumber(process.env.AI_CHAT_PER_DAY, 30),
  aiCacheTtlMs: positiveNumber(process.env.AI_CACHE_TTL_MS, 60_000),
  chatRatePerMinute: positiveNumber(process.env.CHAT_RATE_PER_MINUTE, 10),
  chatRatePerDay: positiveNumber(process.env.CHAT_RATE_PER_DAY, 100),
  // Public address of the frontend, used to build the links sent by email.
  appUrl: (process.env.APP_URL ?? 'http://localhost:4200').replace(/\/+$/, ''),
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: positiveNumber(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'StockBarrio <no-responder@stockbarrio.local>',
  accountTokenTtlMinutes: 30,
  // Maximum in-app notifications a customer can receive per day (Bogota time), to avoid spam.
  notificationsDailyLimit: Math.max(1, Number(process.env.NOTIFICATIONS_DAILY_LIMIT ?? 10)),
};
