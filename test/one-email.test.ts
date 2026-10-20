import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalEmail, emailTakenMessage, hasPlusAlias, plusAliasMessage } from '../src/validation.js';

describe('canonicalEmail', () => {
  it('reduces Gmail variants to one mailbox: dots, +tag, googlemail.com, letter case and spaces', () => {
    for (const email of ['ana.perez@gmail.com', ' ANA.PEREZ@GMAIL.COM ', 'anaperez@gmail.com', 'a.n.a.perez@googlemail.com', 'ana.perez+tienda@gmail.com'])
      assert.equal(canonicalEmail(email), 'anaperez@gmail.com', email);
  });

  it('only lowercases other providers, where dots are part of the address', () => {
    assert.equal(canonicalEmail(' Ana.Perez@Correo.CO '), 'ana.perez@correo.co');
    assert.notEqual(canonicalEmail('ana.perez@correo.co'), canonicalEmail('anaperez@correo.co'));
  });

  it('finds "+" only in the local part', () => {
    assert.equal(hasPlusAlias('ana+x@correo.co'), true);
    assert.equal(hasPlusAlias('ana@correo.co'), false);
  });
});

describe('one email, one account', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call } = context;
  const customer = (email: string) => ({ accountType: 'customer', name: 'Ana Pérez', email, password: 'cliente12345' });
  const store = (email: string, storeName: string) => ({ name: 'Ana Pérez', email, password: 'tienda12345', storeName, neighborhood: 'Bosa', address: 'Calle 1 # 2-3' });

  it('rejects the same email twice, in any letter case, with the same message', async () => {
    assert.equal((await call('POST', '/api/auth/register', customer('ana.perez@gmail.com'))).status, 201);
    for (const email of ['ana.perez@gmail.com', '  ANA.PEREZ@GMAIL.COM ']) {
      const again = await call('POST', '/api/auth/register', customer(email));
      assert.equal(again.status, 409, email);
      assert.equal(again.body.message, emailTakenMessage);
    }
  });

  it('rejects Gmail variants with dots or googlemail.com, also for stores', async () => {
    for (const email of ['anaperez@gmail.com', 'a.n.a.perez@googlemail.com']) {
      const variant = await call('POST', '/api/auth/register', customer(email));
      assert.equal(variant.status, 409, email);
      assert.equal(variant.body.message, emailTakenMessage);
    }
    const asStore = await call('POST', '/api/auth/register', store('a.na.pe.rez@gmail.com', 'Tienda Ana Variante'));
    assert.equal(asStore.status, 409);
    const accounts = await context.pool.query(`SELECT count(*)::int AS count FROM users WHERE email LIKE '%@g%mail.com'`);
    assert.equal(accounts.rows[0].count, 1);
  });

  it('does not accept "+" aliases for new accounts', async () => {
    const plus = await call('POST', '/api/auth/register', customer('ana+compras@correo.co'));
    assert.equal(plus.status, 400);
    assert.equal(plus.body.message, plusAliasMessage);
  });

  it('keeps logging in and recovering older accounts saved with "+"', async () => {
    await context.pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Vieja', 'vieja+x@correo.co', '!', 'customer')`);
    const login = await call('POST', '/api/auth/login', { email: 'vieja+x@correo.co', password: 'x' });
    assert.equal(login.status, 401, 'the format is accepted, only the password fails');
    const forgot = await call('POST', '/api/auth/forgot-password', { email: 'vieja+x@correo.co' });
    assert.notEqual(forgot.status, 400);
  });

  it('answers the sign up check: free, taken (also for dot variants) or with "+"', async () => {
    context.clientIp = '10.0.0.21';
    assert.deepEqual((await call('POST', '/api/auth/check-email', { email: 'nueva@correo.co' })).body, { available: true });
    const taken = await call('POST', '/api/auth/check-email', { email: ' A.N.A.PEREZ@googlemail.com' });
    assert.deepEqual([taken.status, taken.body], [200, { available: false, message: emailTakenMessage }]);
    const plus = await call('POST', '/api/auth/check-email', { email: 'ana+x@gmail.com' });
    assert.deepEqual([plus.status, plus.body.message], [400, plusAliasMessage]);
    assert.equal((await call('POST', '/api/auth/check-email', { email: 'no-es-correo' })).status, 400);
  });

  it('limits the checks per IP so nobody can test emails in bulk', async () => {
    context.clientIp = '10.0.0.22';
    const statuses: number[] = [];
    for (let index = 0; index < 11; index++) statuses.push((await call('POST', '/api/auth/check-email', { email: `persona${index}@correo.co` })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
    context.clientIp = undefined;
  });
});
