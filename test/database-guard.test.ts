import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../src/config.js';
import { isLocalUrl, isUsableTestDatabaseUrl } from './helpers/database-guard.js';

describe('test database guard', () => {
  it('accepts only databases whose name ends in _test', () => {
    assert.equal(isUsableTestDatabaseUrl('postgresql://stock@localhost:5544/stock_barrios_test'), true);
    assert.equal(isUsableTestDatabaseUrl('postgresql://stock@localhost:5544/stock_barrios_test?sslmode=disable'), true);
    assert.equal(isUsableTestDatabaseUrl('postgresql://stock@localhost:5544/stock_barrios'), false);
    assert.equal(isUsableTestDatabaseUrl('postgresql://stock@localhost:5544/stock_test_copia'), false);
    assert.equal(isUsableTestDatabaseUrl(undefined), false);
    assert.equal(isUsableTestDatabaseUrl(''), false);
  });

  it('refuses any Supabase URL, even one that ends in _test', () => {
    for (const url of [
      'postgresql://postgres:clave@db.abcdefgh.supabase.co:5432/postgres',
      'postgresql://postgres.abcdefgh:clave@aws-0-us-east-1.pooler.supabase.com:6543/stock_test',
      'postgresql://postgres:clave@DB.ABC.SUPABASE.CO:5432/x_test',
    ])
      assert.throws(() => isUsableTestDatabaseUrl(url), /nunca se conectan a la base de producción/);
  });

  it('never leaves the pool pointing to DATABASE_URL or a real provider key', () => {
    assert.match(config.databaseUrl, /_test(\?.*)?$/);
    assert.equal(config.aiProvider, 'local');
    assert.equal(config.openAiApiKey, '');
    assert.equal(config.aiFallbackApiKey, '');
    assert.equal(config.smtpHost, '');
  });

  it('blocks requests outside localhost', async () => {
    assert.equal(isLocalUrl('http://127.0.0.1:3000/api/health'), true);
    assert.equal(isLocalUrl('https://api.groq.com/openai/v1/chat/completions'), false);
    await assert.rejects(fetch('https://api.groq.com/openai/v1/models'), /no pueden salir a la red/);
  });
});
