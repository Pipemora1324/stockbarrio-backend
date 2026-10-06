import 'dotenv/config';

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
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 8000),
};
