import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { useMailTransport, type MailMessage } from '../src/services/mailer.js';

describe('account API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call } = context;
  let outbox: MailMessage[] = [];
  const original = { ...config };

  beforeEach(() => {
    outbox = [];
    useMailTransport(async (message) => {
      outbox.push(message);
    });
  });

  afterEach(() => {
    useMailTransport(null);
    Object.assign(config, original);
  });

  const registerCustomer = async (suffix: string, password = 'cliente12345') => {
    const email = `cuenta-${suffix}@stockbarrio.test`;
    const result = await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Ana Pérez', email, password });
    assert.equal(result.status, 201);
    return { email, password, token: result.body.token as string };
  };
  const waitForMail = async () => {
    for (let attempt = 0; attempt < 50 && !outbox.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    return outbox.at(-1)!;
  };
  const linkToken = (message: MailMessage) => /token=([\w-]+)/.exec(message.text)![1];

  it('answers the same way whether the email exists or not', async () => {
    const { email } = await registerCustomer('generico');
    const known = await call('POST', '/api/auth/forgot-password', { email });
    const unknown = await call('POST', '/api/auth/forgot-password', { email: 'nadie@stockbarrio.test' });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(known.body.message, unknown.body.message);
    const message = await waitForMail();
    assert.equal(outbox.length, 1);
    assert.equal(message.to, email);
    assert.match(message.text, /reset-password\?token=/);
  });

  it('stores only the hash of the token, uses it once and signs out old sessions', async () => {
    const { email, token: oldSession } = await registerCustomer('reset');
    await call('POST', '/api/auth/forgot-password', { email });
    const resetToken = linkToken(await waitForMail());
    const stored = await context.pool.query<{ token_hash: string }>('SELECT token_hash FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1');
    assert.notEqual(stored.rows[0].token_hash, resetToken);
    assert.equal(stored.rows[0].token_hash.length, 64);

    assert.equal((await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'corta' })).status, 400);
    const reset = await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'nuevaClave2026' });
    assert.equal(reset.status, 200);
    assert.equal((await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'otraClave2026' })).status, 400, 'single use');
    assert.equal((await call('GET', '/api/auth/me', undefined, oldSession)).status, 401, 'old sessions are closed');
    assert.equal((await call('POST', '/api/auth/login', { email, password: 'nuevaClave2026' })).status, 200);
  });

  it('rejects expired reset links', async () => {
    const { email } = await registerCustomer('vencido');
    await call('POST', '/api/auth/forgot-password', { email });
    const resetToken = linkToken(await waitForMail());
    await context.pool.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'`);
    const result = await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'nuevaClave2026' });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /no es válido o ya venció/);
  });

  it('tells that email is not configured in production without SMTP', async () => {
    useMailTransport(null);
    Object.assign(config, { nodeEnv: 'production', smtpHost: '' });
    const result = await call('POST', '/api/auth/forgot-password', { email: 'alguien@stockbarrio.test' });
    assert.equal(result.status, 503);
    assert.match(result.body.message, /no está configurado/);
  });

  it('updates the name and the password, keeping only the current session', async () => {
    const { token, email } = await registerCustomer('perfil');
    const named = await call('PATCH', '/api/account/name', { name: 'Ana María Pérez' }, token);
    assert.equal(named.body.user.name, 'Ana María Pérez');
    assert.equal((await call('PATCH', '/api/account/name', { name: 'Ana 2' }, token)).status, 400);

    assert.equal((await call('POST', '/api/account/password', { currentPassword: 'equivocada1', newPassword: 'nuevaClave2026' }, token)).status, 400);
    const changed = await call('POST', '/api/account/password', { currentPassword: 'cliente12345', newPassword: 'nuevaClave2026' }, token);
    assert.equal(changed.status, 200);
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 401, 'the old token stops working');
    assert.equal((await call('GET', '/api/auth/me', undefined, changed.body.token)).status, 200, 'the new token keeps the user signed in');
    assert.equal((await call('POST', '/api/auth/login', { email, password: 'nuevaClave2026' })).status, 200);
  });

  it('changes the email only after confirming the new address', async () => {
    const { token, password } = await registerCustomer('correo');
    await registerCustomer('ocupado');
    assert.equal((await call('POST', '/api/account/email', { newEmail: 'cuenta-ocupado@stockbarrio.test', currentPassword: password }, token)).status, 409);
    const requested = await call('POST', '/api/account/email', { newEmail: 'Nuevo.Correo@stockbarrio.test', currentPassword: password }, token);
    assert.equal(requested.status, 200);
    await waitForMail();
    const confirmation = outbox.find((message) => message.to === 'nuevo.correo@stockbarrio.test')!;
    assert.ok(outbox.some((message) => message.to === 'cuenta-correo@stockbarrio.test' && /pidió cambiar el correo/.test(message.text)), 'the old address is warned');
    const profile = await call('GET', '/api/account', undefined, token);
    assert.deepEqual([profile.body.data.email, profile.body.data.pendingEmail], ['cuenta-correo@stockbarrio.test', 'nuevo.correo@stockbarrio.test']);

    const confirmed = await call('POST', '/api/account/email/confirm', { token: linkToken(confirmation) });
    assert.equal(confirmed.status, 200);
    assert.equal((await call('POST', '/api/auth/login', { email: 'nuevo.correo@stockbarrio.test', password })).status, 200);
    assert.equal((await call('POST', '/api/account/email/confirm', { token: linkToken(confirmation) })).status, 400);
  });
});
