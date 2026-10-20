import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before } from 'node:test';
import { isUsableTestDatabaseUrl } from './database-guard.js';

// Las pruebas de integración necesitan una base desechable cuyo nombre termine en "_test": se vacía antes de cada archivo.
// Importa esta ayuda primero en cada archivo de pruebas, para que el pool se cree con la base de pruebas.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const usableTestUrl = isUsableTestDatabaseUrl(testDatabaseUrl);
if (usableTestUrl) process.env.DATABASE_URL = testDatabaseUrl;
export const integrationSkip = usableTestUrl ? false : 'TEST_DATABASE_URL no está definida o no termina en _test';

export interface TestContext {
  pool: typeof import('../../src/database.js').pool;
  // IP del visitante enviada por la cabecera del proxy de confianza, para que cada prueba tenga sus propios límites.
  clientIp?: string;
  baseUrl: string;
  call: (method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: Record<string, any> }>;
  registerStore: (suffix: string, extra?: Record<string, unknown>) => Promise<{ token: string; user: { id: string; storeId: string; role: string } }>;
}

export const useTestApi = (): TestContext => {
  let server: Server | undefined;
  const context = {} as TestContext;

  context.call = async (method, path, body, token) => {
    const response = await fetch(`${context.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(context.clientIp ? { 'X-Forwarded-For': context.clientIp } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };

  context.registerStore = async (suffix, extra = {}) => {
    const result = await context.call('POST', '/api/auth/register', {
      name: `Dueña ${suffix}`,
      email: `tienda-${suffix}@stockbarrio.test`,
      password: 'tienda12345',
      storeName: `Tienda ${suffix}`,
      neighborhood: 'Chapinero',
      address: 'Calle 1 # 2-3',
      ...extra,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body as { token: string; user: { id: string; storeId: string; role: string } };
  };

  before(async () => {
    const database = await import('../../src/database.js');
    context.pool = database.pool;
    const { rows } = await context.pool.query<{ name: string }>('SELECT current_database() AS name');
    assert.match(rows[0].name, /_test$/, 'Los tests solo pueden vaciar una base cuyo nombre termine en _test.');
    await context.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const { migrate } = await import('../../src/migrate.js');
    await migrate();
    const { app } = await import('../../src/app.js');
    server = app.listen(0);
    context.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    await context.pool?.end();
  });

  return context;
};
