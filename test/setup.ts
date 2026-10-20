import { isLocalUrl, isUsableTestDatabaseUrl } from './helpers/database-guard.js';

// Loaded before every test file (see the "test" script), before the app reads its configuration.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// Without a test database the pool points to a port where nothing listens, never to DATABASE_URL.
process.env.DATABASE_URL = isUsableTestDatabaseUrl(testDatabaseUrl) ? testDatabaseUrl : 'postgresql://127.0.0.1:1/sin_base_test';

// Real keys or services from the environment never reach the tests: each test configures simulated providers itself.
Object.assign(process.env, {
  NODE_ENV: 'test',
  AI_PROVIDER: 'local',
  OPENAI_API_KEY: '',
  AI_FALLBACK_API_KEY: '',
  SMTP_HOST: '',
  MAIL_PROVIDER: '',
  BREVO_API_KEY: '',
  ENABLE_ALERTS: 'false',
});

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (!isLocalUrl(input)) return Promise.reject(new Error(`Las pruebas no pueden salir a la red: ${new URL(String(input instanceof Request ? input.url : input)).hostname}`));
  return realFetch(input, init);
};
