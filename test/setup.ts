import { isLocalUrl, isUsableTestDatabaseUrl } from './helpers/database-guard.js';

// Se carga antes de cada archivo de pruebas (ver el script "test"), antes de que la app lea su configuración.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// Sin una base de pruebas, el pool apunta a un puerto donde no hay nada, nunca a DATABASE_URL.
process.env.DATABASE_URL = isUsableTestDatabaseUrl(testDatabaseUrl) ? testDatabaseUrl : 'postgresql://127.0.0.1:1/sin_base_test';

// Las claves o servicios reales del entorno nunca llegan a las pruebas: cada prueba configura sus proveedores simulados.
Object.assign(process.env, {
  NODE_ENV: 'test',
  AI_PROVIDER: 'local',
  OPENAI_API_KEY: '',
  AI_FALLBACK_API_KEY: '',
  SMTP_HOST: '',
  MAIL_PROVIDER: '',
  BREVO_API_KEY: '',
  AUTH_PROVIDER: 'legacy',
  SUPABASE_URL: '',
  SUPABASE_JWKS_URL: '',
  SUPABASE_JWT_SECRET: '',
});

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (!isLocalUrl(input)) return Promise.reject(new Error(`Las pruebas no pueden salir a la red: ${new URL(String(input instanceof Request ? input.url : input)).hostname}`));
  return realFetch(input, init);
};
