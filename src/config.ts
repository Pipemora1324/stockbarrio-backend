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
  // "legacy" (default): own login with bcrypt and JWT. "supabase": Supabase Auth tokens, verified here.
  authProvider: (process.env.AUTH_PROVIDER ?? '').trim().toLowerCase() || 'legacy',
  // Project URL (https://<ref>.supabase.co); the token issuer is <url>/auth/v1.
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
  // Asymmetric signing keys (recommended): https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
  supabaseJwksUrl: (process.env.SUPABASE_JWKS_URL ?? '').trim(),
  // Legacy shared secret (HS256), only when the project still signs with it.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  supabaseJwtAudience: (process.env.SUPABASE_JWT_AUDIENCE ?? '').trim() || 'authenticated',
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
  appUrl: (process.env.APP_URL ?? 'http://localhost:4200').trim().replace(/\/+$/, ''),
  // In production the links of the emails need the real address of the frontend.
  appUrlConfigured: Boolean(process.env.APP_URL?.trim()) || process.env.NODE_ENV !== 'production',
  smtpHost: (process.env.SMTP_HOST ?? '').trim(),
  smtpPort: positiveNumber(process.env.SMTP_PORT, 587),
  // true: TLS from the start (port 465). false: STARTTLS (port 587). Empty: deduced from the port.
  smtpSecure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE.trim().toLowerCase() === 'true' : positiveNumber(process.env.SMTP_PORT, 587) === 465,
  smtpUser: (process.env.SMTP_USER ?? '').trim(),
  smtpPass: process.env.SMTP_PASS ?? '',
  // Without MAIL_FROM the authenticated account is the sender (what Gmail uses anyway).
  mailFrom: (process.env.MAIL_FROM ?? '').trim(),
  // Limit to connect and send, for both transports (SMTP_TIMEOUT_MS is still read for older setups).
  mailTimeoutMs: positiveNumber(process.env.MAIL_TIMEOUT_MS ?? process.env.SMTP_TIMEOUT_MS, 10_000),
  // "smtp" (default) or "brevo-api": HTTPS for hosts that block SMTP ports, like Render Free.
  mailProvider: (process.env.MAIL_PROVIDER ?? '').trim().toLowerCase(),
  brevoApiKey: (process.env.BREVO_API_KEY ?? '').trim(),
  accountTokenTtlMinutes: 30,
};
