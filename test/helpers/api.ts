import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before } from 'node:test';

// Integration tests need a disposable database whose name ends in "_test": it is wiped before each file.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
export const integrationSkip = testDatabaseUrl && /_test(\?.*)?$/.test(testDatabaseUrl) ? false : 'TEST_DATABASE_URL no está definida o no termina en _test';

export interface TestContext {
  pool: typeof import('../../src/database.js').pool;
  call: (method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: Record<string, any> }>;
  registerStore: (suffix: string, extra?: Record<string, unknown>) => Promise<{ token: string; user: { id: string; storeId: string; role: string } }>;
}

export const useTestApi = (): TestContext => {
  let server: Server | undefined;
  let baseUrl = '';
  const context = {} as TestContext;

  context.call = async (method, path, body, token) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = await import('../../src/database.js');
    context.pool = database.pool;
    await context.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const { migrate } = await import('../../src/migrate.js');
    await migrate();
    const { app } = await import('../../src/app.js');
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    await context.pool?.end();
  });

  return context;
};
