import 'dotenv/config';

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

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
  aiMaxTokens: positiveNumber(process.env.AI_MAX_TOKENS, 700),
  aiCacheTtlMs: positiveNumber(process.env.AI_CACHE_TTL_MS, 60_000),
  chatRatePerMinute: positiveNumber(process.env.CHAT_RATE_PER_MINUTE, 10),
  chatRatePerDay: positiveNumber(process.env.CHAT_RATE_PER_DAY, 100),
  // Maximum in-app notifications a customer can receive per day (Bogota time), to avoid spam.
  notificationsDailyLimit: Math.max(1, Number(process.env.NOTIFICATIONS_DAILY_LIMIT ?? 10)),
};
