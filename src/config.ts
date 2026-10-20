import 'dotenv/config';

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// "a, b , c" -> ['a', 'b', 'c']; los valores vacíos se descartan.
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
  // "legacy" (por defecto): login propio con bcrypt y JWT. "supabase": tokens de Supabase Auth, verificados aquí.
  authProvider: (process.env.AUTH_PROVIDER ?? '').trim().toLowerCase() || 'legacy',
  // URL del proyecto (https://<ref>.supabase.co); el emisor de los tokens es <url>/auth/v1.
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
  // Claves de firma asimétricas (recomendado): https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
  supabaseJwksUrl: (process.env.SUPABASE_JWKS_URL ?? '').trim(),
  // Secreto compartido antiguo (HS256), solo si el proyecto todavía firma con él.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  supabaseJwtAudience: (process.env.SUPABASE_JWT_AUDIENCE ?? '').trim() || 'authenticated',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
  aiProvider: process.env.AI_PROVIDER ?? 'local',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  aiTimeoutMs: positiveNumber(process.env.AI_TIMEOUT_MS, 8000),
  // Segundo proveedor opcional compatible con OpenAI, para cuando el principal falla (429, 5xx, tiempo agotado o respuesta inválida).
  aiFallbackApiKey: process.env.AI_FALLBACK_API_KEY ?? '',
  aiFallbackModel: process.env.AI_FALLBACK_MODEL ?? '',
  aiFallbackBaseUrl: process.env.AI_FALLBACK_BASE_URL ?? '',
  // Cadenas ordenadas de modelos. Los planes gratuitos limitan cada modelo por separado, así que cuando uno se agota se usa el siguiente.
  aiModels: parseList(process.env.AI_MODELS),
  aiFallbackModels: parseList(process.env.AI_FALLBACK_MODELS),
  aiMaxTokens: positiveNumber(process.env.AI_MAX_TOKENS, 300),
  aiMaxPromptTokens: positiveNumber(process.env.AI_MAX_PROMPT_TOKENS, 700),
  // Presupuestos por modelo guardados en memoria, un poco por debajo de los límites gratuitos de cada proveedor.
  aiRequestsPerMinute: positiveNumber(process.env.AI_REQUESTS_PER_MINUTE, 28),
  aiRequestsPerDay: positiveNumber(process.env.AI_REQUESTS_PER_DAY, 950),
  aiTokensPerMinute: positiveNumber(process.env.AI_TOKENS_PER_MINUTE, 7000),
  aiTokensPerDay: positiveNumber(process.env.AI_TOKENS_PER_DAY, 150_000),
  aiFallbackRequestsPerMinute: positiveNumber(process.env.AI_FALLBACK_REQUESTS_PER_MINUTE, 5),
  aiFallbackRequestsPerDay: positiveNumber(process.env.AI_FALLBACK_REQUESTS_PER_DAY, 20),
  aiFallbackTokensPerMinute: positiveNumber(process.env.AI_FALLBACK_TOKENS_PER_MINUTE, 7000),
  aiFallbackTokensPerDay: positiveNumber(process.env.AI_FALLBACK_TOKENS_PER_DAY, 150_000),
  // Mensajes que de verdad usan el modelo, por usuario (o por IP para visitantes). Por encima del límite el chat responde con reglas.
  aiChatPerMinute: positiveNumber(process.env.AI_CHAT_PER_MINUTE, 5),
  aiChatPerDay: positiveNumber(process.env.AI_CHAT_PER_DAY, 30),
  aiCacheTtlMs: positiveNumber(process.env.AI_CACHE_TTL_MS, 60_000),
  chatRatePerMinute: positiveNumber(process.env.CHAT_RATE_PER_MINUTE, 10),
  chatRatePerDay: positiveNumber(process.env.CHAT_RATE_PER_DAY, 100),
  // Dirección pública del frontend, con la que se arman los enlaces de los correos.
  appUrl: (process.env.APP_URL ?? 'http://localhost:4200').trim().replace(/\/+$/, ''),
  // En producción los enlaces de los correos necesitan la dirección real del frontend.
  appUrlConfigured: Boolean(process.env.APP_URL?.trim()) || process.env.NODE_ENV !== 'production',
  smtpHost: (process.env.SMTP_HOST ?? '').trim(),
  smtpPort: positiveNumber(process.env.SMTP_PORT, 587),
  // true: TLS desde el inicio (puerto 465). false: STARTTLS (puerto 587). Vacío: se deduce del puerto.
  smtpSecure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE.trim().toLowerCase() === 'true' : positiveNumber(process.env.SMTP_PORT, 587) === 465,
  smtpUser: (process.env.SMTP_USER ?? '').trim(),
  smtpPass: process.env.SMTP_PASS ?? '',
  // Sin MAIL_FROM el remitente es la cuenta autenticada (lo que Gmail usa de todos modos).
  mailFrom: (process.env.MAIL_FROM ?? '').trim(),
  // Límite para conectar y enviar, con los dos transportes (SMTP_TIMEOUT_MS se sigue leyendo por configuraciones viejas).
  mailTimeoutMs: positiveNumber(process.env.MAIL_TIMEOUT_MS ?? process.env.SMTP_TIMEOUT_MS, 10_000),
  // "smtp" (por defecto) o "brevo-api": HTTPS para servidores que bloquean los puertos SMTP, como Render Free.
  mailProvider: (process.env.MAIL_PROVIDER ?? '').trim().toLowerCase(),
  brevoApiKey: (process.env.BREVO_API_KEY ?? '').trim(),
  accountTokenTtlMinutes: 30,
};
