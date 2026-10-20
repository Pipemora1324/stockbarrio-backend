import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { createToken } from '../src/services/auth.js';

describe('authentication API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;

  const registerCustomer = async (suffix: string, extra: Record<string, unknown> = {}) => {
    const result = await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Luis Gómez', email: `auth-${suffix}@stockbarrio.test`, password: 'cliente12345', ...extra });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body as { token: string; user: { id: string; email: string; role: string } };
  };

  it('signs in with any letter case and answers the same for a wrong password or an unknown email', async () => {
    await registerCustomer('login');
    const ok = await call('POST', '/api/auth/login', { email: '  AUTH-Login@StockBarrio.test ', password: 'cliente12345' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.role, 'customer');
    assert.equal(ok.body.user.passwordHash, undefined);

    const wrongPassword = await call('POST', '/api/auth/login', { email: 'auth-login@stockbarrio.test', password: 'cliente12346' });
    const unknownEmail = await call('POST', '/api/auth/login', { email: 'nadie@stockbarrio.test', password: 'cliente12345' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.message, unknownEmail.body.message, 'it does not tell which accounts exist');
    assert.equal((await call('POST', '/api/auth/login', { email: 'auth-login@stockbarrio.test' })).status, 400);
  });

  it('treats a broken stored hash as a failed login, not as a server error', async () => {
    await context.pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Semilla', 'semilla@stockbarrio.test', 'hash-roto', 'admin')`);
    const result = await call('POST', '/api/auth/login', { email: 'semilla@stockbarrio.test', password: 'cualquiera1' });
    assert.equal(result.status, 401);
  });

  it('never lets a public registration choose its role or reuse an email', async () => {
    const customer = await registerCustomer('rol', { role: 'admin' });
    assert.equal(customer.user.role, 'customer');
    const store = await registerStore('rol', { role: 'admin', accountType: 'store' });
    assert.equal(store.user.role, 'store');
    const roles = await context.pool.query<{ role: string }>(`SELECT role FROM users WHERE email LIKE '%-rol@stockbarrio.test'`);
    assert.deepEqual(roles.rows.map((row) => row.role).sort(), ['customer', 'store']);

    const repeated = await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Otra Persona', email: 'AUTH-ROL@stockbarrio.test', password: 'cliente12345' });
    assert.equal(repeated.status, 409);
    const sameStore = await call('POST', '/api/auth/register', { name: 'Otra Dueña', email: 'otra-rol@stockbarrio.test', password: 'tienda12345', storeName: 'tienda ROL', neighborhood: 'chapinero', address: 'Calle 9 # 9-9' });
    assert.equal(sameStore.status, 409);
    assert.match(sameStore.body.message, /Ya existe una tienda con este nombre/);
  });

  it('rejects expired tokens and tokens signed with another secret', async () => {
    const { user } = await registerCustomer('jwt');
    const expired = jwt.sign({ ...user, tv: 0 }, config.jwtSecret, { expiresIn: -10 });
    const forged = jwt.sign({ ...user, role: 'admin', tv: 0 }, 'otro-secreto', { expiresIn: '1h' });
    for (const token of [expired, forged]) {
      const result = await call('GET', '/api/auth/me', undefined, token);
      assert.equal(result.status, 401);
      assert.match(result.body.message, /inválido o caducó/);
    }
    assert.equal((await call('GET', '/api/auth/me')).status, 401, 'no token at all');
  });

  it('closes sessions issued before the token version changed, and sessions of deleted accounts', async () => {
    const { token, user } = await registerCustomer('version');
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 200);
    await context.pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);
    const stale = await call('GET', '/api/auth/me', undefined, token);
    assert.equal(stale.status, 401);
    assert.match(stale.body.message, /Vuelve a iniciar sesión/);

    const fresh = await call('POST', '/api/auth/login', { email: user.email, password: 'cliente12345' });
    assert.equal(JSON.parse(Buffer.from(fresh.body.token.split('.')[1], 'base64url').toString()).tv, 1);
    assert.equal((await call('GET', '/api/auth/me', undefined, fresh.body.token)).status, 200);

    await context.pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    assert.equal((await call('GET', '/api/auth/me', undefined, fresh.body.token)).status, 401);
  });

  it('keeps tokens issued before token versions existed working while the version is 0', async () => {
    const { user } = await registerCustomer('legado');
    const legacy = jwt.sign({ id: user.id, name: 'Luis Gómez', email: user.email, role: 'customer' }, config.jwtSecret, { expiresIn: '1h' });
    assert.equal((await call('GET', '/api/auth/me', undefined, legacy)).status, 200);
  });

  it('keeps product and store management only for accounts that own a store', async () => {
    const customer = await registerCustomer('permisos');
    const product = { name: 'Arroz 1 kg', category: 'Despensa', price: 3500, stock: 4, expirationDate: '2099-01-01' };
    const asCustomer = await call('POST', '/api/products', product, customer.token);
    assert.equal(asCustomer.status, 403);
    assert.match(asCustomer.body.message, /Solo las tiendas/);
    assert.equal((await call('GET', '/api/products/mine', undefined, customer.token)).status, 403);
    assert.equal((await call('GET', '/api/stores/mine', undefined, customer.token)).status, 403);

    // A store account whose store row is missing cannot act on behalf of any store.
    const orphan = await context.pool.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, role) VALUES ('Sin Tienda', 'sintienda@stockbarrio.test', 'x', 'store') RETURNING id`);
    const orphanToken = createToken({ id: orphan.rows[0].id, name: 'Sin Tienda', email: 'sintienda@stockbarrio.test', role: 'store' });
    const result = await call('POST', '/api/products', product, orphanToken);
    assert.equal(result.status, 403);
    assert.match(result.body.message, /no tiene una tienda asociada/);
  });

  it('lets the chat ignore an invalid token instead of failing', async () => {
    const result = await call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'hola' }] }, 'token-falso');
    assert.equal(result.status, 200);
  });
});
